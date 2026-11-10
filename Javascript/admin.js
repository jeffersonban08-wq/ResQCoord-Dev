Auth.initialize().then(() => {
if (!Auth.guard('admin')) return;
startClock(); bindNetwork();
addEventListener('resqcoord:error', event => toast('Firebase: ' + (event.detail?.message || 'save failed')));

const ME = () => Auth.current();
const TITLES = {
  dashboard: ['Admin Dashboard', 'Live deployment monitoring'],
  map:       ['Live Map', 'Real-time team positions · Mt. Lantin operational area'],
  missions:  ['Missions', 'Plan, assign and track missions'],
  personnel: ['Personnel', 'Registered field responders'],
  resources: ['Resources', 'Vehicles, equipment and supplies'],
  incidents: ['Incidents', 'Reports filed from the field'],
  reports:   ['Reports', 'Summaries and exports'],
  users:     ['User Management', 'Accounts and access'],
  settings:  ['Settings', 'System and profile']
};
let view = 'dashboard', map = null, markers = {}, respMarkers = {}, sosMarkers = {}, missionBoundaries = {}, missionMarkers = {}, routeLayer = null, filter = 'All', search = '';

/* ---------- small helpers ---------- */
const teamName = id => DB.get('teams', id)?.name || '—';
const pill = (t, c = '') => `<span class="pill ${c}">${esc(t)}</span>`;
const sevCls = s => ({ Low: 'ok', Medium: 'warn', High: 'bad', Critical: 'bad' }[s] || '');
const initials = n => n.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase();
const teamOptions = sel => DB.all('teams').map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
const table = (heads, rows) => `<div class="tablewrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;
const tr = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const overdueUsers = () => DB.all('users').filter(u => u.role === 'user' && u.nextCheckin && new Date(u.nextCheckin) < Date.now() && u.status !== 'Standby');

/* ---------- map ---------- */
function initMap() {
  map = MapKit.create('map', MapKit.CENTER, 14);
  drawTeams();
  const s = $('#search'); if (s) s.oninput = () => { search = s.value.toLowerCase(); drawTeams(); };
  $$('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('[data-f]').forEach(x => x.classList.toggle('primary', x === b)); drawTeams(); });
}
function destroyMap() { if (map) { map.remove(); map = null; } markers = {}; respMarkers = {}; sosMarkers = {}; missionBoundaries = {}; missionMarkers = {}; routeLayer = null; }
function withMap(fn) { if (map) return fn(); show('map'); setTimeout(fn, 250); }

function drawTeams() {
  if (!map) return;
  DB.all('teams').forEach(t => {
    const hide = (filter !== 'All' && t.status !== filter) || (search && !(t.name + ' ' + (t.note || '')).toLowerCase().includes(search));
    if (hide) { if (markers[t.id]) { map.removeLayer(markers[t.id]); delete markers[t.id]; } return; }
    const ico = MapKit.icon(initials(t.name), MapKit.COLORS[t.status] || '#64748b', t.status === 'SOS');
    if (!markers[t.id]) markers[t.id] = L.marker([t.lat, t.lng], { icon: ico }).addTo(map);
    markers[t.id].setLatLng([t.lat, t.lng]).setIcon(ico)
      .bindPopup(`<div class="map-popup"><b>${esc(t.name)}</b><span>${t.members} personnel · ${esc(t.status)}</span><small>${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</small></div>`);
  });
  const visibleResponders = DB.all('users').filter(u => u.role === 'user' && Number.isFinite(u.lat) && Number.isFinite(u.lng) && u.sharing !== false);
  Object.keys(respMarkers).forEach(id => {
    if (!visibleResponders.some(u => u.id === id)) { map.removeLayer(respMarkers[id]); delete respMarkers[id]; }
  });
  visibleResponders.forEach(u => {
    const ico = MapKit.icon(initials(u.name), '#0ea5e9');
    respMarkers[u.id] ||= L.marker([u.lat, u.lng], { icon: ico }).addTo(map);
    respMarkers[u.id].setLatLng([u.lat, u.lng]).setIcon(ico)
      .bindPopup(`<div class="map-popup"><b>${esc(u.name)}</b><span>Field responder · ${esc(u.status || 'Standby')}</span><small>${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}</small></div>`);
  });
  const active = DB.all('sos').filter(s => s.status === 'Active');
  Object.keys(sosMarkers).forEach(id => { if (!active.find(s => s.id === id)) { map.removeLayer(sosMarkers[id]); delete sosMarkers[id]; } });
  active.forEach(s => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
    sosMarkers[s.id] ||= L.marker([s.lat, s.lng], { icon: MapKit.icon('SOS', '#ef4444', true), zIndexOffset: 900 }).addTo(map);
    sosMarkers[s.id].setLatLng([s.lat, s.lng]).bindPopup(`<div class="map-popup map-popup-alert"><b>Active SOS</b><span>${esc(teamName(s.teamId))}</span><small>${esc(s.note || 'Assistance requested')}</small></div>`);
  });
  const missionsWithLocations = DB.all('missions').filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  Object.keys(missionBoundaries).forEach(id => {
    if (!missionsWithLocations.some(m => m.id === id)) {
      map.removeLayer(missionBoundaries[id]);
      map.removeLayer(missionMarkers[id]);
      delete missionBoundaries[id];
      delete missionMarkers[id];
    }
  });
  missionsWithLocations.forEach(m => {
    const radius = MapKit.geofenceRadius(m);
    missionBoundaries[m.id] ||= L.circle([m.lat, m.lng], {
      radius, color: MapKit.MISSION_COLOR, weight: 2, dashArray: '7 7', fillColor: MapKit.MISSION_COLOR, fillOpacity: .12
    }).addTo(map);
    missionBoundaries[m.id].setLatLng([m.lat, m.lng]).setRadius(radius)
      .bindPopup(`<div class="map-popup"><b>Mission boundary</b><span>${esc(m.name)}</span><small>${radius} m radius</small></div>`);
    missionMarkers[m.id] ||= L.marker([m.lat, m.lng], { icon: MapKit.icon('TARGET', '#ef4444') }).addTo(map);
    missionMarkers[m.id].setLatLng([m.lat, m.lng])
      .bindPopup(`<div class="map-popup"><b>${esc(m.name)}</b><span>Mission target · geofence center</span><small>${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</small></div>`);
  });
}

async function drawRoute(from, to, label, center = null) {
  const activeMap = map;
  const r = await MapKit.route(from, to);
  if (!activeMap || map !== activeMap) return;
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = MapKit.routeLayer(r.coords, r.online).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] });
  if (center) map.panTo(center);
  const el = $('#routeInfo');
  if (el) el.textContent = `${label}: ${r.km.toFixed(2)} km · about ${Math.round(r.min)} min${r.online ? '' : ' (straight line, offline)'}`;
  toast('Route drawn');
}

/* ---------- reusable HTML pieces ---------- */
function kpis() {
  const T = DB.all('teams'), M = DB.all('missions').filter(m => m.status !== 'Closed'), I = DB.all('incidents').filter(i => i.status !== 'Resolved');
  const k = (t, v, s) => `<div class="card kpi"><small>${t}</small><h3>${v}</h3><p class="muted">${s}</p></div>`;
  return k('Deployed personnel', T.reduce((a, t) => a + t.members, 0), `${T.length} teams in the field`)
       + k('Active missions', M.length, `${M.filter(m => ['High', 'Critical'].includes(m.priority)).length} high priority`)
       + k('Teams reporting', `${T.length} / ${T.length}`, `${overdueUsers().length} check-in overdue`)
       + k('Open incidents', I.length, `${I.filter(i => i.severity === 'Critical').length} critical`);
}
const roster = () => DB.all('teams').map(t => `<div class="line"><span><i class="dot" style="background:${MapKit.COLORS[t.status] || '#64748b'}"></i><b>${esc(t.name)}</b><br><small class="muted">${t.members} · ${esc(t.status)}</small></span>
  <span><button class="btn small" data-act="track" data-id="${t.id}">Track</button> <button class="btn small" data-act="route" data-id="${t.id}">Route</button> <button class="btn small" data-act="msg" data-id="${t.id}">Message</button></span></div>`).join('');

function alerts() {
  const sos = DB.all('sos').filter(s => s.status === 'Active').map(s => `<div class="alert bad"><b>SOS · ${esc(teamName(s.teamId))}</b><br><small>${hhmm(s.createdAt)} · ${esc(s.note)}</small>
    <div class="row"><button class="btn small primary" data-act="assign" data-id="${s.id}">Assign nearest team</button><button class="btn small" data-act="sosTrack" data-id="${s.id}">Locate</button><button class="btn small" data-act="sosResolve" data-id="${s.id}">Resolve</button></div></div>`);
  const od = overdueUsers().map(u => `<div class="alert warn"><b>Check-in overdue · ${esc(u.name)}</b><br><small>Due ${hhmm(u.nextCheckin)} · ${esc(teamName(u.teamId))}</small></div>`);
  return sos.concat(od).join('') || '<p class="muted">No active alerts.</p>';
}
const inbox = () => DB.all('messages').filter(m => m.role === 'user').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  .map(m => `<div class="line"><span><b>${esc(m.senderName)}</b> <small class="muted">· ${esc(teamName(m.teamId))} · ${hhmm(m.createdAt)}</small><br>${esc(m.text)}</span></div>`).join('') || '<p class="muted">No messages from the field yet.</p>';

/* ---------- table builders (re-rendered live) ---------- */
const tblMissions = () => table(['ID', 'Mission', 'Type', 'Priority', 'Team', 'Sector', 'Status', ''], DB.all('missions').map(m => {
  return tr([esc(m.id), esc(m.name), esc(m.type), pill(m.priority, ['High', 'Critical'].includes(m.priority) ? 'bad' : 'warn'), esc(teamName(m.teamId)), esc(m.sector), pill(m.status),
    `<button class="btn small" data-act="mmap" data-id="${m.id}">Route</button> <button class="btn small" data-act="mtoggle" data-id="${m.id}">${m.status === 'Closed' ? 'Reopen' : 'Close'}</button> <button class="btn small danger" data-act="mdel" data-id="${m.id}">Delete</button>`]);
}));

const tblPersonnel = () => table(['Name', 'ID', 'Team', 'Status', 'Location', 'Last seen', 'Sharing', ''], DB.all('users').filter(u => u.role === 'user').map(u =>
  tr([esc(u.name), esc(u.responderId), `<select data-change="reassign" data-id="${u.id}">${teamOptions(u.teamId)}</select>`, pill(u.status), u.lat ? `${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}` : '—',
    u.lastSeen ? hhmm(u.lastSeen) : '—', u.sharing === false ? 'Off' : 'On', u.lat ? `<button class="btn small" data-act="utrack" data-id="${u.id}">Track</button>` : ''])));

const tblResources = () => table(['Resource', 'Type', 'Qty', 'Status', 'Assigned team', ''], DB.all('resources').map(r =>
  tr([esc(r.name), esc(r.type), r.qty, pill(r.status, r.status === 'Available' ? 'ok' : 'warn'), esc(teamName(r.teamId)),
    `<button class="btn small" data-act="rtoggle" data-id="${r.id}">${r.status === 'Available' ? 'Deploy' : 'Return'}</button> <button class="btn small danger" data-act="rdel" data-id="${r.id}">Delete</button>`])));

const tblIncidents = () => table(['Time', 'Type', 'Severity', 'Reporter', 'Team', 'Description', 'Status', ''], DB.all('incidents').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(i =>
  tr([hhmm(i.createdAt), esc(i.type), pill(i.severity, sevCls(i.severity)), esc(i.reporterName), esc(teamName(i.teamId)), esc(i.desc), pill(i.status),
    [['Acknowledged', 'Acknowledge'], ['Escalated', 'Escalate'], ['Resolved', 'Resolve']].map(([s, l]) => `<button class="btn small" data-act="istat" data-id="${i.id}" data-s="${s}">${l}</button>`).join(' ')
    + (i.lat ? ` <button class="btn small" data-act="itrack" data-id="${i.id}">Map</button>` : '')])));

const tblUsers = () => table(['Name', 'Email', 'Role', 'Organization / Team', 'Created', ''], DB.all('users').map(u =>
  tr([esc(u.name), esc(u.email), pill(u.role === 'admin' ? 'Admin' : 'Responder', u.role === 'admin' ? 'bad' : 'ok'), esc(u.role === 'admin' ? u.org : teamName(u.teamId)), new Date(u.createdAt).toLocaleDateString('en-PH'),
    u.id === ME().id ? '<small class="muted">You</small>' : `<button class="btn small" data-act="upw" data-id="${u.id}">Reset password</button> <button class="btn small danger" data-act="udel" data-id="${u.id}">Revoke access</button>`])));

const TABLES = { missions: tblMissions, personnel: tblPersonnel, resources: tblResources, incidents: tblIncidents, users: tblUsers };

/* ---------- screens ---------- */
const VIEWS = {
  dashboard: () => `
    <div class="cards four" id="kpis">${kpis()}</div>
    <div class="split wide">
      <div class="card"><div class="card-h"><b>Live deployment map · Mt. Lantin operational area</b><span class="pill live">LIVE</span></div>
        <div id="map" class="map tall"></div>
      </div>
      <div class="col">
        <div class="card"><div class="card-h"><b>Deployed personnel</b></div><div id="roster">${roster()}</div></div>
        <div class="card"><div class="card-h"><b>Alerts</b></div><div id="alerts">${alerts()}</div></div>
        <div class="card"><div class="card-h"><b>Messages from the field</b></div><div id="inbox">${inbox()}</div></div>
      </div>
    </div>`,
  map: () => `
    <div class="toolbar"><input id="search" placeholder="Search team, unit or location">
      ${['All', 'On site', 'En route', 'Standby', 'SOS'].map(f => `<button class="btn small ${f === filter ? 'primary' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
    <div class="split wide">
      <div class="card map-card">
        <div class="map-card-heading"><div><b>Live operations map</b><small>Mt. Lantin · Team and responder positions</small></div><span class="pill live">LIVE UPDATES</span></div>
        <div id="map" class="map tall"></div><p class="muted small map-footnote" id="routeInfo">Choose Track or Route on a team to view its position. Locations update automatically.</p>
      </div>
      <div class="card"><div class="card-h"><b>Teams in field</b></div><div id="roster">${roster()}</div><div class="card-h" style="margin-top:14px"><b>Alerts</b></div><div id="alerts">${alerts()}</div></div>
    </div>`,
  missions:  () => `<div class="row end" style="margin:0 0 12px"><button class="btn primary" id="btnNew">+ New Mission</button></div><div class="card" id="tbl">${tblMissions()}</div>`,
  personnel: () => `<div class="card" id="tbl">${tblPersonnel()}</div>`,
  resources: () => `<div class="card"><div class="card-h"><b>Add resource</b></div><div class="row wrap">
      <input id="rName" placeholder="Name e.g. Rescue boat"><select id="rType"><option>Vehicle</option><option>Equipment</option><option>Medical</option><option>Supplies</option></select>
      <input id="rQty" type="number" min="1" value="1"><select id="rTeam"><option value="">Unassigned</option>${teamOptions()}</select><button class="btn primary" id="btnAddRes">Add</button></div></div>
      <div class="card" style="margin-top:14px" id="tbl">${tblResources()}</div>`,
  incidents: () => `<div class="card" id="tbl">${tblIncidents()}</div>`,
  users:     () => `<div class="card" id="tbl">${tblUsers()}</div>`,
  reports() {
    const I = DB.all('incidents'), M = DB.all('missions');
    const by = (a, k) => a.reduce((o, x) => (o[x[k]] = (o[x[k]] || 0) + 1, o), {});
    const box = (t, o) => `<div class="card"><div class="card-h"><b>${t}</b></div>${Object.entries(o).map(([k, v]) => `<div class="line"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<p class="muted">No data</p>'}</div>`;
    return `<div class="row" style="margin:0 0 14px"><button class="btn primary" id="expInc">Export incidents (CSV)</button><button class="btn" id="expMis">Export missions (CSV)</button><button class="btn" id="btnPrint">Print</button></div>
      <div class="cards three">${box('Incidents by type', by(I, 'type'))}${box('Incidents by severity', by(I, 'severity'))}${box('Missions by status', by(M, 'status'))}</div>`;
  },
  settings: () => `<div class="split">
      <div class="card"><div class="card-h"><b>Profile</b></div><label>Name</label><input id="aName" value="${esc(ME().name)}"><label>Organization</label><input id="aOrg" value="${esc(ME().org || '')}">
        <div class="row"><button class="btn primary" id="btnSaveA">Save</button></div></div>
      <div class="card"><div class="card-h"><b>System</b></div>
        <label class="switch-row"><input type="checkbox" id="sSim" ${localStorage.getItem('rq_sim') !== '0' ? 'checked' : ''}> Simulate movement of teams that have no live responder</label>
        <div class="row"><button class="btn danger" id="btnReset">Reset sample data (keeps accounts)</button><button class="btn" id="btnOutA">Log out</button></div></div></div>`
};

/* ---------- screen-specific buttons ---------- */
const BIND = {
  dashboard: initMap,
  map: initMap,
  missions() { $('#btnNew').onclick = newMission; },
  resources() {
    $('#btnAddRes').onclick = () => {
      const name = $('#rName').value.trim(); if (!name) return toast('Enter a resource name');
      DB.insert('resources', { name, type: $('#rType').value, qty: parseInt($('#rQty').value) || 1, status: 'Available', teamId: $('#rTeam').value });
      $('#rName').value = ''; toast('Resource added'); live();
    };
  },
  reports() {
    $('#expInc').onclick = () => csv('incidents.csv', DB.all('incidents').map(i => ({ id: i.id, time: i.createdAt, type: i.type, severity: i.severity, reporter: i.reporterName, team: teamName(i.teamId), status: i.status, description: i.desc, lat: i.lat, lng: i.lng })));
    $('#expMis').onclick = () => csv('missions.csv', DB.all('missions').map(m => ({ id: m.id, name: m.name, type: m.type, priority: m.priority, team: teamName(m.teamId), sector: m.sector, status: m.status })));
    $('#btnPrint').onclick = () => print();
  },
  settings() {
    $('#btnSaveA').onclick = () => { DB.update('users', ME().id, { name: $('#aName').value.trim() || ME().name, org: $('#aOrg').value.trim() }); $('#adminName').textContent = ME().name; toast('Saved'); };
    $('#sSim').onchange = e => localStorage.setItem('rq_sim', e.target.checked ? '1' : '0');
    $('#btnReset').onclick = async () => {
      if (!confirm('Replace all missions, reports, messages, resources, team status and SOS data with the sample data? User accounts will be kept.')) return;
      try { await DB.reset(); toast('Sample data restored'); live(); }
      catch (error) { toast('Reset failed: ' + error.message); }
    };
    $('#btnOutA').onclick = Auth.logout;
  }
};

function csv(name, rows) {
  if (!rows.length) return toast('Nothing to export');
  const keys = Object.keys(rows[0]);
  const body = [keys.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = name; a.click();
}

/* ---------- dialogs ---------- */
function composeMsg(teamId, urgent = false) {
  modal(urgent ? '🚨 SOS Alert to all teams' : teamId === 'ALL' ? 'Broadcast to all teams' : 'Message ' + esc(teamName(teamId)),
    '<textarea id="mmText" rows="4" placeholder="Type message…"></textarea>',
    () => {
      const v = $('#mmText').value.trim(); if (!v) { toast('Type a message'); return false; }
      DB.insert('messages', { teamId, senderId: ME().id, senderName: 'Command Center', role: 'admin', text: (urgent ? '🚨 ALERT: ' : '') + v });
      toast('Message sent');
    }, 'Send');
}

function newMission() {
  let target = [...MapKit.CENTER];
  let geofenceRadius = MapKit.DEFAULT_GEOFENCE_RADIUS;
  modal('New Mission', `
    <label>Mission name</label><input id="nName" placeholder="e.g. Mt. Lantin Rescue">
    <div class="grid2">
      <div><label>Type</label><select id="nType"><option>Mountain SAR</option><option>Maritime SAR</option><option>Medical evacuation</option><option>Disaster response</option></select></div>
      <div><label>Priority</label><select id="nPri"><option>Medium</option><option>High</option><option>Critical</option><option>Low</option></select></div>
      <div><label>Assign team</label><select id="nTeam">${teamOptions()}</select></div>
      <div><label>Sector</label><input id="nSector" value="N-2"></div>
    </div>
    <label>Briefing</label><textarea id="nBrief" rows="2" placeholder="Subjects, last seen, hazards…"></textarea>
    <label>Mission geofence radius (meters)</label><input id="nGeofence" type="number" min="50" max="10000" step="50" value="${geofenceRadius}">
    <label>Mission target (also the center of the geofence; click the map to set)</label><div id="pickMap" class="map small"></div>
    <p class="muted small" id="pickInfo">${target[0].toFixed(5)}, ${target[1].toFixed(5)}</p>`,
    () => {
      const name = $('#nName').value.trim(); if (!name) { toast('Enter a mission name'); return false; }
      geofenceRadius = Number($('#nGeofence').value);
      if (!Number.isFinite(geofenceRadius) || geofenceRadius < 50 || geofenceRadius > 10000) {
        toast('Geofence radius must be between 50 and 10,000 meters'); return false;
      }
      const team = $('#nTeam').value;
      DB.insert('missions', {
        id: 'MSN-2026-' + String(DB.all('missions').length + 14).padStart(3, '0'),
        name, type: $('#nType').value, priority: $('#nPri').value, teamId: team, sector: $('#nSector').value.trim() || 'N-1',
        brief: $('#nBrief').value.trim() || '—', lead: ME().name, lat: target[0], lng: target[1], geofenceRadius, status: 'In progress',
        timeline: [{ t: hhmm(new Date()), e: 'Mission dispatched' }]
      });
      if (team) {
        DB.update('teams', team, { status: 'En route', target });
        DB.insert('messages', { teamId: team, senderId: ME().id, senderName: 'Command Center', role: 'admin', text: 'New mission assigned: ' + name });
      }
      toast('Mission created'); live();
    }, 'Create mission');
  setTimeout(() => {
    const pm = MapKit.create('pickMap', target, 13), mk = L.marker(target, { icon: MapKit.icon('TARGET', '#ef4444') }).addTo(pm);
    const boundary = L.circle(target, { radius: geofenceRadius, color: MapKit.MISSION_COLOR, weight: 2, dashArray: '7 7', fillColor: MapKit.MISSION_COLOR, fillOpacity: .12 }).addTo(pm);
    const updateBoundary = () => {
      const radius = Number($('#nGeofence').value);
      if (Number.isFinite(radius) && radius >= 50 && radius <= 10000) { geofenceRadius = radius; boundary.setRadius(radius); }
    };
    $('#nGeofence').oninput = updateBoundary;
    pm.on('click', e => {
      const point = [e.latlng.lat, e.latlng.lng];
      target = point;
      mk.setLatLng(target); boundary.setLatLng(target);
      $('#pickInfo').textContent = target[0].toFixed(5) + ', ' + target[1].toFixed(5);
    });
  }, 80);
}

/* ---------- button actions (event delegation) ---------- */
const ACTIONS = {
  track:  id => withMap(() => { const t = DB.get('teams', id); map.setView([t.lat, t.lng], 16); markers[id]?.openPopup(); }),
  utrack: id => withMap(() => { const u = DB.get('users', id); map.setView([u.lat, u.lng], 17); respMarkers[id]?.openPopup(); }),
  itrack: id => withMap(() => { const i = DB.get('incidents', id); map.setView([i.lat, i.lng], 17); L.circleMarker([i.lat, i.lng], { radius: 14, color: '#dc2626' }).addTo(map); }),
  sosTrack: id => withMap(() => { const s = DB.get('sos', id); map.setView([s.lat, s.lng], 16); sosMarkers[id]?.openPopup(); }),
  msg:   id => composeMsg(id),
  route(id) {
    const t = DB.get('teams', id), m = DB.all('missions').find(x => x.teamId === id && x.status !== 'Closed');
    const to = t.target || (m && [m.lat, m.lng]);
    if (!to) return toast('This team has no active mission or target');
    withMap(() => drawRoute([t.lat, t.lng], to, t.name + ' → target'));
  },
  mmap(id) {
    const m = DB.get('missions', id);
    if (!m) return;
    const team = DB.get('teams', m.teamId);
    withMap(() => drawRoute(team ? [team.lat, team.lng] : [m.lat, m.lng], [m.lat, m.lng], `${m.name} mission target`, [m.lat, m.lng]));
  },
  assign(id) {
    const s = DB.get('sos', id);
    const c = DB.all('teams').filter(t => t.id !== s.teamId && t.status !== 'SOS').sort((a, b) => MapKit.distance([a.lat, a.lng], [s.lat, s.lng]) - MapKit.distance([b.lat, b.lng], [s.lat, s.lng]));
    if (!c.length) return toast('No team available');
    const best = c[0];
    DB.update('teams', best.id, { status: 'En route', target: [s.lat, s.lng] });
    DB.insert('messages', { teamId: best.id, senderId: ME().id, senderName: 'Command Center', role: 'admin', text: `SOS at ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)} (${teamName(s.teamId)}). Respond immediately.` });
    toast(best.name + ' assigned'); live();
    withMap(() => drawRoute([best.lat, best.lng], [s.lat, s.lng], best.name + ' → SOS'));
  },
  sosResolve(id) { const s = DB.get('sos', id); DB.update('sos', id, { status: 'Resolved' }); DB.update('teams', s.teamId, { status: 'On site' }); toast('SOS resolved'); live(); },
  mtoggle(id) { const m = DB.get('missions', id); DB.update('missions', id, { status: m.status === 'Closed' ? 'In progress' : 'Closed' }); live(); },
  mdel(id) { if (confirm('Delete this mission?')) { DB.remove('missions', id); live(); } },
  rtoggle(id) { const r = DB.get('resources', id); DB.update('resources', id, { status: r.status === 'Available' ? 'Deployed' : 'Available' }); live(); },
  rdel(id) { DB.remove('resources', id); live(); },
  istat(id, b) { DB.update('incidents', id, { status: b.dataset.s }); toast('Incident ' + b.dataset.s.toLowerCase()); live(); },
  async upw(id) {
    const user = DB.get('users', id);
    if (!user?.email) return toast('This account has no email address');
    try { await Auth.sendPasswordReset(user.email); toast('Password reset email sent'); }
    catch (error) { toast('Password reset failed: ' + error.message); }
  },
  udel(id) {
    if (confirm('Revoke this account’s ResQCoord access? The Firebase Authentication user itself will remain.')) {
      DB.remove('users', id); live();
    }
  }
};
$('#view').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) ACTIONS[b.dataset.act]?.(b.dataset.id, b); });
$('#view').addEventListener('change', e => {
  const s = e.target.closest('[data-change]');
  if (s?.dataset.change === 'reassign') { DB.update('users', s.dataset.id, { teamId: s.value }); toast('Personnel reassigned'); live(); }
});

/* ---------- live refresh ---------- */
function live() {
  if (['dashboard', 'map'].includes(view)) {
    if ($('#kpis')) $('#kpis').innerHTML = kpis();
    $('#roster').innerHTML = roster(); $('#alerts').innerHTML = alerts();
    if ($('#inbox')) $('#inbox').innerHTML = inbox();
    drawTeams();
  } else if (TABLES[view]) $('#tbl').innerHTML = TABLES[view]();
}

// teams without a live responder move toward their target so you can see tracking
function simStep() {
  if (localStorage.getItem('rq_sim') === '0') return;
  const liveTeams = new Set(DB.all('users').filter(u => u.lastSeen && Date.now() - new Date(u.lastSeen) < 60000).map(u => u.teamId));
  let changed = false;
  DB.all('teams').forEach(t => {
    if (liveTeams.has(t.id) || t.status !== 'En route') return;
    const m = DB.all('missions').find(x => x.teamId === t.id && x.status !== 'Closed');
    const tgt = t.target || (m && [m.lat, m.lng]); if (!tgt) return;
    const lat = t.lat + (tgt[0] - t.lat) * 0.12, lng = t.lng + (tgt[1] - t.lng) * 0.12;
    const arrived = MapKit.distance([lat, lng], tgt) < 0.03;
    DB.update('teams', t.id, { lat, lng, status: arrived ? 'On site' : 'En route', target: arrived ? null : t.target });
    changed = true;
  });
  if (changed) live();
}

function show(v) {
  view = v; destroyMap();
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  $('#title').textContent = TITLES[v][0]; $('#sub').textContent = TITLES[v][1];
  $('#view').innerHTML = VIEWS[v]();
  BIND[v]?.();
}

/* ---------- start ---------- */
$('#adminName').textContent = ME().name;
$$('#nav a').forEach(a => a.onclick = () => show(a.dataset.view));
$('#qMission').onclick = newMission;
$('#qSos').onclick = () => composeMsg('ALL', true);
$('#logout').onclick = Auth.logout;
DB.onChange(live);
setInterval(simStep, 3000);
setInterval(live, 30000);
show('dashboard');
}).catch(error => {
  console.error('Firebase initialization failed:', error);
  const toastElement = document.getElementById('toast');
  if (toastElement) { toastElement.textContent = error.message || 'Could not connect to Firebase.'; toastElement.classList.add('show'); }
});