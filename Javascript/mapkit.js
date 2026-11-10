const MapKit = (() => {
  const CENTER = [16.4027, 120.5973];   // Mt. Lantin operational area (from your deck)
  const COLORS = { 'On site':'#22c55e', 'En route':'#3b82f6', 'Standby':'#f59e0b', 'SOS':'#ef4444' };
  const MISSION_COLOR = '#14b8a6';
  const DEFAULT_GEOFENCE_RADIUS = 500;

  function create(id, center = CENTER, zoom = 14) {
    const target = document.getElementById(id);
    const compact = target.classList.contains('small');
    const map = L.map(id, { zoomControl: false, preferCanvas: true }).setView(center, zoom);
    const street = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenTopoMap &copy; OpenStreetMap contributors'
    });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri'
    });
    street.addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
    if (!compact) {
      L.control.layers({ Street: street, Terrain: topo, OpenStreetMap: osm, Satellite: sat }, null, {
        position: 'topright'
      }).addTo(map);
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const box = L.DomUtil.create('div', 'map-legend');
        box.innerHTML = `<b>Map legend</b>${Object.entries(COLORS).map(([name, color]) =>
          `<span><i style="--legend-color:${color}"></i>${name}</span>`).join('')}<span><i style="--legend-color:${MISSION_COLOR}"></i>Mission geofence</span>`;
        L.DomEvent.disableClickPropagation(box);
        return box;
      };
      legend.addTo(map);
    }
    return map;
  }

  const icon = (label, color, pulse = false) => {
    const text = String(label).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    const shade = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#2563eb';
    const current = label === 'YOU';
    return L.divIcon({
      className: 'resq-marker-icon',
      iconSize: [current ? 48 : 42, current ? 48 : 42],
      iconAnchor: [current ? 24 : 21, current ? 24 : 21],
      html: `<span class="map-marker${pulse ? ' is-alert' : ''}${current ? ' is-current' : ''}" style="--marker-color:${shade}">${text}</span>`
    });
  };

  function routeLayer(coords, online = true, color = '#0f9488') {
    const dashArray = online ? null : '8 10';
    return L.layerGroup([
      L.polyline(coords, { color: '#fff', weight: 11, opacity: .9, dashArray, lineCap: 'round', lineJoin: 'round' }),
      L.polyline(coords, { color, weight: 6, opacity: .95, dashArray, lineCap: 'round', lineJoin: 'round' })
    ]);
  }

  // distance in km between two [lat,lng] points (haversine)
  function distance(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function directRoute(from, to) {
    const coords = [from, to];
    const km = distance(from, to);
    return { coords, km, min: km / 4 * 60, online: false };
  }

  function geofenceRadius(mission) {
    const radius = Number(mission?.geofenceRadius);
    return Number.isFinite(radius) && radius >= 50 && radius <= 10000 ? radius : DEFAULT_GEOFENCE_RADIUS;
  }

  async function route(from, to) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const coordinates = [from, to].map(([lat, lng]) => `${lng},${lat}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Route service returned ${response.status}`);
      const data = await response.json();
      const rt = data.routes?.[0];
      if (!rt?.geometry?.coordinates?.length) throw new Error('Route service returned no route');
      return { coords: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: rt.duration / 60, online: true };
    } catch {
      return directRoute(from, to);
    } finally {
      clearTimeout(timeout);
    }
  }

  // real GPS tracking
  function gps(onFix, onError) {
    if (!navigator.geolocation) { onError('GPS not supported'); return null; }
    return navigator.geolocation.watchPosition(
      p => onFix([p.coords.latitude, p.coords.longitude], p.coords.accuracy),
      e => onError(e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  return { CENTER, COLORS, MISSION_COLOR, DEFAULT_GEOFENCE_RADIUS, create, icon, routeLayer, distance, directRoute, geofenceRadius, route, gps };
})();