Auth.initialize().then(() => {
if (!Auth.guard('user')) return;
startClock(); bindNetwork();
addEventListener('resqcoord:error', event => toast('Firebase: ' + (event.detail?.message || 'save failed')));

const me = () => Auth.current();
const STATUSES = ['Standby', 'En route', 'On site'];
const TITLES = {
  dashboard: ['My Dashboard', 'Field team view'],
  mission:   ['My Mission', 'Assigned mission'],
  messages:  ['Messages', 'Secure channel to command and team'],
  report:    ['Report Incident', 'File an incident from the field'],
  settings:  ['User Settings', 'Profile, alerts and privacy']
};
let map, meMarker, routeLayer, geofenceLayer, lastRoute, gpsId = null, walkTimer = null, view = 'dashboard', badge = ['STARTING…', true], lastRouteRefresh = 0, routeRequestId = 0, geofenceState = null, renderedMissionId = null, renderedMissionGeometry = '';

/* ---------- data helpers ---------- */
const myMission = () => DB.all('missions').find(m => m.teamId === me().teamId && m.status !== 'Closed');
const minsLeft = () => Math.max(0, Math.round((new Date(me().nextCheckin) - Date.now()) / 60000));
const teamMsgs = () => DB.all('messages').filter(x => x.teamId === me().teamId || x.teamId === 'ALL').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const msgHtml = x => `<div class="bubble ${x.senderId === me().id ? 'mine' : ''}"><small>${esc(x.senderName)} · ${hhmm(x.createdAt)}</small><p>${esc(x.text)}</p></div>`;
function sendMsg(text) { const u = me(); DB.insert('messages', { teamId: u.teamId, senderId: u.id, senderName: u.name, role: 'user', text }); }

function raiseSOS(note) {
  const u = me(), t = DB.get('teams', u.teamId);
  DB.insert('sos', { teamId: u.teamId, senderId: u.id, senderName: u.name, note, lat: u.lat ?? t?.lat, lng: u.lng ?? t?.lng, status: 'Active' });
  if (u.teamId) DB.update('teams', u.teamId, { status: 'SOS' });
  sendMsg('🚨 SOS ALERT: ' + note);
  toast('SOS sent to the command center');
}

/* ---------- location, GPS, map ---------- */
function setBadge(text, ok) { badge = [text, ok]; const b = $('#gpsBadge'); if (b) { b.textContent = text; b.className = 'pill ' + (ok ? 'ok' : 'warn'); } }

function setLocation(ll, acc = 0) {
  const u = me();
  DB.update('users', u.id, { lat: ll[0], lng: ll[1], acc, lastSeen: new Date().toISOString() });
  if (u.sharing !== false && u.teamId) DB.update('teams', u.teamId, { lat: ll[0], lng: ll[1] });   // admin sees the team move
  if (meMarker) meMarker.setLatLng(ll);
  if (map && !myMission() && !map.getBounds().contains(ll)) map.panTo(ll);
  updateGeofence(ll, acc);
  if (map) drawRoute();
  const a = $('#lat'), b = $('#lng');
  if (a && document.activeElement !== a && document.activeElement !== b) { a.value = ll[0].toFixed(5); b.value = ll[1].toFixed(5); }
}

function startGPS() {
  stopGPS(); setBadge('SEARCHING GPS…', true);
  gpsId = MapKit.gps(
    (ll, acc) => { setLocation(ll, acc); setBadge('GPS LOCKED ±' + Math.round(acc) + ' m', true); },
    msg => { setBadge('GPS UNAVAILABLE', false); toast('GPS: ' + msg + ' — use Set location or click the map'); });
}
function stopGPS() { if (gpsId !== null) { navigator.geolocation.clearWatch(gpsId); gpsId = null; } }

function manual(ll) {           // change location by hand
  stopGPS(); clearInterval(walkTimer);
  DB.update('users', me().id, { locMode: 'manual' });
  setBadge('MANUAL LOCATION', true);
  setLocation(ll);
}

function walk() {               // simulate walking along the route (tracking demo)
  if (!lastRoute) return toast('No route yet');
  stopGPS(); clearInterval(walkTimer);
  DB.update('users', me().id, { locMode: 'manual' }); setBadge('SIMULATED WALK', true);
  const pts = lastRoute.coords, step = Math.max(1, Math.floor(pts.length / 60)); let i = 0;
  walkTimer = setInterval(() => {
    if (i >= pts.length) { clearInterval(walkTimer); return toast('Arrived at the target'); }
    setLocation(pts[i]); i += step;
  }, 1000);
}

function initMap() {
  const u = me(), t = DB.get('teams', u.teamId), m = myMission();
  const start = u.lat ? [u.lat, u.lng] : (t ? [t.lat, t.lng] : MapKit.CENTER);
  const center = m ? [m.lat, m.lng] : start;
  map = MapKit.create('map', center, 15);
  meMarker = L.marker(start, { icon: MapKit.icon('YOU', MapKit.MISSION_COLOR), zIndexOffset: 1000 }).addTo(map);
  if (m) {
    const radius = MapKit.geofenceRadius(m);
    const target = [m.lat, m.lng];
    geofenceLayer = L.circle(target, {
      radius, color: MapKit.MISSION_COLOR, weight: 2, dashArray: '7 7', fillColor: MapKit.MISSION_COLOR, fillOpacity: .12
    }).addTo(map).bindPopup(`<b>${esc(m.name)}</b><br>Mission boundary · ${radius} m radius`);
    L.marker(target, { icon: MapKit.icon('TARGET', '#ef4444') }).addTo(map).bindPopup(esc(m.name));
  }
  if (!u.lat) setLocation(start);
  map.on('click', e => { manual([e.latlng.lat, e.latlng.lng]); toast('Location changed'); });
  drawRoute(!m);
  updateGeofence(start, Number(u.acc) || 0);
}

function updateGeofence(ll, accuracy = 0) {
  const status = $('#geofenceInfo'), m = myMission();
  if (!m) {
    if (status) {
      status.className = 'geofence-status';
      status.textContent = 'No active mission geofence assigned.';
    }
    geofenceState = null;
    return;
  }
  const radius = MapKit.geofenceRadius(m);
  const meters = MapKit.distance(ll, [m.lat, m.lng]) * 1000;
  const uncertainty = Math.max(0, accuracy);
  const inside = meters + uncertainty <= radius;
  const outside = meters - uncertainty > radius;
  if (status) {
    status.className = 'geofence-status ' + (inside ? 'inside' : outside ? 'outside' : 'uncertain');
    status.textContent = inside
      ? `Inside mission geofence · ${Math.round(meters)} m from target / ${radius} m boundary`
      : outside
        ? `WARNING: You are outside the mission geofence · ${Math.round(meters)} m from target / ${radius} m boundary`
        : `Near the geofence boundary · GPS accuracy ±${Math.round(uncertainty)} m`;
  }
  if (outside && geofenceState !== false) {
    toast('WARNING: You are outside the mission geofence');
  } else if (inside && geofenceState === false) {
    toast('You are back inside the mission geofence');
  }
  if (inside || outside) {
    geofenceState = inside;
  }
}

function drawRoute(fit = false) {
  const m = myMission(), u = me();
  if (!m || !map) return;
  const from = [u.lat ?? MapKit.CENTER[0], u.lng ?? MapKit.CENTER[1]], to = [m.lat, m.lng];
  const activeMap = map, missionId = m.id;
  const render = r => {
    if (map !== activeMap || myMission()?.id !== missionId) return;
    lastRoute = r;
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = MapKit.routeLayer(r.coords, r.online).addTo(map);
    if (fit) map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    const info = $('#routeInfo');
    if (info) info.textContent = `${r.online ? 'Live road route' : 'Offline GPS route (straight line)'} · ${r.km.toFixed(2)} km · about ${Math.round(r.min)} min`;
  };
  const connected = navigator.onLine;
  if (!connected || !lastRoute || !lastRoute.online) render(MapKit.directRoute(from, to));
  if (!connected || Date.now() - lastRouteRefresh < 30000) return;
  lastRouteRefresh = Date.now();
  const requestId = ++routeRequestId;
  MapKit.route(from, to).then(r => { if (requestId === routeRequestId) render(r); });
}
function destroyMap() {
  clearInterval(walkTimer);
  if (map) { map.remove(); map = null; }
  meMarker = null; routeLayer = null; geofenceLayer = null; lastRoute = null; geofenceState = null; lastRouteRefresh = 0; routeRequestId++;
}

function refreshRouteForNetwork() {
  lastRouteRefresh = 0;
  routeRequestId++;
  if (map) drawRoute();
}

addEventListener('online', refreshRouteForNetwork);
addEventListener('offline', refreshRouteForNetwork);

/* ---------- screens ---------- */
const VIEWS = {
  dashboard() {
    const u = me(), m = myMission(), t = DB.get('teams', u.teamId);
    return `
    <div class="cards three">
      <div class="card kpi"><small>My status</small><h3 id="stat">${esc(u.status)}</h3><p class="muted">Tap to update status</p><button class="btn small" id="btnStatus">Update status</button></div>
      <div class="card kpi"><small>Next check-in</small><h3 id="chk">${hhmm(u.nextCheckin)}</h3><p class="muted" id="chkLeft">${minsLeft()} min from now</p><button class="btn small primary" id="btnCheckin">Check in</button></div>
      <div class="card kpi"><small>${esc(t?.name || 'No team')}</small><h3>${t?.members ?? 0}</h3><p class="muted">members deployed</p></div>
    </div>
    <div class="split">
      <div class="card">
        <div class="card-h"><b>My location</b><span class="pill" id="gpsBadge"></span></div>
        <div id="map" class="map"></div>
        <div class="row wrap"><input id="lat" placeholder="Latitude"><input id="lng" placeholder="Longitude">
          <button class="btn small" id="btnSet">Set location</button><button class="btn small" id="btnGps">Use GPS</button>
          <button class="btn small primary" id="btnWalk">Simulate walk to target</button></div>
        <p id="geofenceInfo" class="geofence-status" role="status" aria-live="assertive">Waiting for GPS location…</p>
        <p class="muted small" id="routeInfo">GPS works without mobile data; map tiles and road routes may need internet. Offline location updates stay on this device until connection returns.</p>
      </div>
      <div class="card">
        <div class="card-h"><b>Assigned mission</b><span class="pill">${esc(m?.status || 'NONE')}</span></div>
        ${m ? `<h3>${esc(m.name)}</h3><p>${esc(m.brief)}</p><p class="muted">Mission lead: ${esc(m.lead)}</p>` : '<p class="muted">No mission assigned yet. Command will assign your team.</p>'}
        <div class="card-h" style="margin-top:14px"><b>Messages from command</b><span class="pill live">LIVE</span></div>
        <div id="latestMsgs"></div>
        <div class="card-h" style="margin-top:14px"><b>My team</b><span class="pill">${esc(t?.status || 'UNASSIGNED')}</span></div>
        <div class="line"><span><b>${esc(t?.name || 'No team assigned')}</b><br><small class="muted">${esc(t?.note || 'Waiting for team information')}</small></span><b>${t?.members ?? 0}<small class="muted"> members</small></b></div>
      </div>
    </div>`;
  },

  mission() {
    const m = myMission();
    if (!m) return '<div class="card"><p>No mission assigned to your team yet.</p></div>';
    return `
    <div class="cards three">
      <div class="card kpi"><small>Mission ID</small><h3>${esc(m.id)}</h3><p class="muted">Priority: ${esc(m.priority)} · ${esc(m.type)}</p></div>
      <div class="card kpi"><small>Elapsed time</small><h3 id="elapsed">–</h3><p class="muted">Dispatched ${hhmm(m.createdAt)}</p></div>
      <div class="card kpi"><small>Geofence radius</small><h3>${MapKit.geofenceRadius(m)} m</h3><p class="muted">${esc(m.sector)} · centered on mission target</p></div>
    </div>
    <div class="split">
      <div class="card">
        <div class="card-h"><b>Mission briefing</b><span class="pill">${esc(m.status)}</span></div>
        <dl><dt>Mission</dt><dd>${esc(m.name)}</dd><dt>Briefing</dt><dd>${esc(m.brief)}</dd><dt>Mission lead</dt><dd>${esc(m.lead)}</dd></dl>
        <div class="card-h"><b>Mission timeline</b></div>
        <ul class="timeline">${(m.timeline || []).map(t => `<li><b>${esc(t.t)}</b>${esc(t.e)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <div class="card-h"><b>Assigned sector · ${esc(m.sector)}</b></div>
        <div id="map" class="map"></div>
        <p id="geofenceInfo" class="geofence-status" role="status" aria-live="assertive">Waiting for GPS location…</p>
        <p class="muted small" id="routeInfo"></p>
      </div>
    </div>`;
  },

  messages() {
    return `<div class="card">
      <div class="card-h"><b>Command Center</b><span class="pill live">LIVE</span></div>
      <div id="thread" class="thread"></div>
      <div class="row wrap">${['Copy', 'On site', 'En route', 'Need assistance', 'Request medic'].map(q => `<button class="btn small quick">${q}</button>`).join('')}</div>
      <div class="row"><input id="mText" placeholder="Message Command Center…"><button class="btn primary" id="btnSend">➤</button></div>
    </div>`;
  },

  report() {
    const u = me(), m = myMission(), t = DB.get('teams', u.teamId);
    const recent = DB.all('incidents').filter(i => i.teamId === u.teamId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    return `
    <div class="split">
      <div class="card">
        <div class="card-h"><b>New incident report</b><span class="pill">DRAFT</span></div>
        <label>Incident type</label><div class="chips" id="cType" data-opts="Injured person,Hazard,Missing person,Equipment,Weather"></div>
        <label>Severity</label><div class="chips" id="cSev" data-opts="Low,Medium,High,Critical"></div>
        <label>Location (auto)</label><input id="rLoc" readonly>
        <label>Description</label><textarea id="rDesc" rows="5" placeholder="What happened?"></textarea>
        <div class="row"><button class="btn primary" id="btnSubmit">Submit report</button><button class="btn" id="btnDraft">Save draft</button><button class="btn ghost" id="btnCancel">Cancel</button></div>
      </div>
      <div class="card">
        <div class="card-h"><b>Auto-attached</b></div>
        <dl><dt>Reporter</dt><dd>${esc(u.name)} · Field Responder</dd><dt>Team</dt><dd>${esc(t?.name || '—')}</dd><dt>Mission</dt><dd>${esc(m?.id || '—')}</dd><dt>Time</dt><dd>${hhmm(new Date())} PHT (automatic)</dd></dl>
        <p class="muted small">High severity notifies the duty commander at once. Critical severity also raises an SOS alert.</p>
        <div class="card-h" style="margin-top:12px"><b>Recent reports · ${esc(t?.name || '')}</b></div>
        ${recent.map(i => `<div class="line"><span>${esc(i.type)} · ${esc(i.severity)}</span><span class="pill">${esc(i.status)}</span></div>`).join('') || '<p class="muted">No reports yet.</p>'}
      </div>
    </div>`;
  },

  settings() {
    const u = me(), t = DB.get('teams', u.teamId);
    return `
    <div class="split">
      <div class="card"><div class="card-h"><b>Profile</b></div>
        <label>Name</label><input id="sName" value="${esc(u.name)}">
        <label>Contact</label><input id="sPhone" value="${esc(u.phone || '')}" placeholder="+63 9xx xxx xxxx">
        <dl><dt>Responder ID</dt><dd>${esc(u.responderId)}</dd><dt>Team</dt><dd>${esc(t?.name || '—')}</dd><dt>Email</dt><dd>${esc(u.email)}</dd></dl>
        <button class="btn primary" id="btnSave">Save profile</button></div>
      <div class="card"><div class="card-h"><b>Location &amp; privacy</b></div>
        <label class="switch-row"><input type="checkbox" id="sShare" ${u.sharing !== false ? 'checked' : ''}> Share location with command</label>
        <label>Location mode</label>
        <select id="sMode"><option value="gps">Real GPS</option><option value="manual">Manual (enter coordinates / click map)</option></select>
        <p class="muted small">Visible to: command center and my team.</p>
        <button class="btn danger" id="btnOut" style="margin-top:12px">Log out</button></div>
    </div>`;
  }
};

/* ---------- button wiring for each screen ---------- */
const BIND = {
  dashboard() {
    initMap(); setBadge(...badge);
    $('#latestMsgs').innerHTML = teamMsgs().slice(-3).map(msgHtml).join('') || '<p class="muted">No messages yet.</p>';
    $('#btnStatus').onclick = () => {
      const u = me(), next = STATUSES[(STATUSES.indexOf(u.status) + 1) % STATUSES.length];
      DB.update('users', u.id, { status: next }); if (u.teamId) DB.update('teams', u.teamId, { status: next });
      $('#stat').textContent = next; toast('Status: ' + next);
    };
    $('#btnCheckin').onclick = () => {
      const n = new Date(Date.now() + 15 * 60000).toISOString();
      DB.update('users', me().id, { nextCheckin: n }); $('#chk').textContent = hhmm(n); sendMsg('Check-in: all OK'); toast('Checked in');
    };
    $('#btnSet').onclick = () => {
      const la = parseFloat($('#lat').value), lo = parseFloat($('#lng').value);
      if (isNaN(la) || isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return toast('Enter a valid latitude and longitude');
      manual([la, lo]); map.setView([la, lo]); toast('Location changed');
    };
    $('#btnGps').onclick = () => { DB.update('users', me().id, { locMode: 'gps' }); startGPS(); };
    $('#btnWalk').onclick = walk;
  },

  mission() {
    const m = myMission(); if (!m) return;
    initMap();
    const tick = () => { const e = $('#elapsed'); if (!e) return clearInterval(timer); const mins = Math.floor((Date.now() - new Date(m.createdAt)) / 60000); e.textContent = `${Math.floor(mins / 60)}h ${mins % 60}m`; };
    const timer = setInterval(tick, 1000); tick();
  },

  messages() {
    renderThread();
    const send = () => { const v = $('#mText').value.trim(); if (!v) return; sendMsg(v); $('#mText').value = ''; renderThread(); };
    $('#btnSend').onclick = send; $('#mText').onkeydown = e => e.key === 'Enter' && send();
    $$('.quick').forEach(b => b.onclick = () => { sendMsg(b.textContent); renderThread(); });
  },

  report() {
    const u = me(), getType = chips('cType', 'Injured person'), getSev = chips('cSev', 'Medium');
    $('#rLoc').value = u.lat ? `${u.lat.toFixed(4)}° N, ${u.lng.toFixed(4)}° E · GPS` : 'Location not available yet';
    const draft = JSON.parse(localStorage.getItem('rq_draft_' + u.id) || 'null'); if (draft) $('#rDesc').value = draft.desc;
    $('#btnSubmit').onclick = () => {
      const desc = $('#rDesc').value.trim(); if (!desc) return toast('Please add a description');
      const uu = me(), m = myMission(), sev = getSev();
      const inc = DB.insert('incidents', { type: getType(), severity: sev, desc, reporterId: uu.id, reporterName: uu.name, teamId: uu.teamId, missionId: m?.id || '', lat: uu.lat, lng: uu.lng, status: 'Open' });
      if (sev === 'Critical') raiseSOS('Critical incident: ' + getType());
      localStorage.removeItem('rq_draft_' + u.id); toast('Report submitted (' + inc.id + ')'); show('report');
    };
    $('#btnDraft').onclick = () => { localStorage.setItem('rq_draft_' + u.id, JSON.stringify({ desc: $('#rDesc').value })); toast('Draft saved'); };
    $('#btnCancel').onclick = () => show('dashboard');
  },

  settings() {
    $('#sMode').value = me().locMode || 'gps';
    $('#btnSave').onclick = () => { DB.update('users', me().id, { name: $('#sName').value.trim() || me().name, phone: $('#sPhone').value.trim() }); $('#userName').textContent = me().name; toast('Profile saved'); };
    $('#sShare').onchange = e => { DB.update('users', me().id, { sharing: e.target.checked }); toast(e.target.checked ? 'Sharing location with command' : 'Location sharing off'); };
    $('#sMode').onchange = e => { DB.update('users', me().id, { locMode: e.target.value }); e.target.value === 'gps' ? startGPS() : (stopGPS(), setBadge('MANUAL LOCATION', true)); };
    $('#btnOut').onclick = Auth.logout;
  }
};

function renderThread() { const t = $('#thread'); if (!t) return; t.innerHTML = teamMsgs().map(msgHtml).join(''); t.scrollTop = t.scrollHeight; }

function show(v) {
  view = v; destroyMap();
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  $('#title').textContent = TITLES[v][0]; $('#sub').textContent = TITLES[v][1];
  $('#view').innerHTML = VIEWS[v]();
  renderedMissionId = myMission()?.id || null;
  renderedMissionGeometry = missionGeometry(myMission());
  BIND[v]();
}

function missionGeometry(mission) {
  return mission ? `${mission.lat}:${mission.lng}:${MapKit.geofenceRadius(mission)}` : '';
}

function syncMissionView() {
  if (!['dashboard', 'mission'].includes(view)) return;
  const mission = myMission(), id = mission?.id || null;
  if (id !== renderedMissionId || missionGeometry(mission) !== renderedMissionGeometry) show(view);
}

/* ---------- start ---------- */
const u0 = me(), team0 = DB.get('teams', u0.teamId);
$('#userName').textContent = u0.name;
$('#userRole').textContent = 'Field Responder · ' + (team0?.name || 'No team');
$$('#nav a').forEach(a => a.onclick = () => show(a.dataset.view));
$('#qReport').onclick = () => show('report');
$('#qSos').onclick = () => { if (confirm('Send an SOS alert to the command center?')) raiseSOS('Responder needs immediate help'); };
$('#logout').onclick = Auth.logout;

DB.onChange(() => {
  if (view === 'messages') renderThread();
  syncMissionView();
});
setInterval(() => { const l = $('#chkLeft'); if (l) l.textContent = minsLeft() + ' min from now'; }, 15000);

if (u0.locMode === 'manual') setBadge('MANUAL LOCATION', true); else startGPS();
show('dashboard');
}).catch(error => {
  console.error('Firebase initialization failed:', error);
  const toastElement = document.getElementById('toast');
  if (toastElement) { toastElement.textContent = error.message || 'Could not connect to Firebase.'; toastElement.classList.add('show'); }
});