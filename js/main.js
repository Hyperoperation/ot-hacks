// Minimal frontend app using Leaflet (OpenStreetMap) for the map,
// Weatherbit for current weather, and TomTom Search for POIs near a coordinate.

const state = {
  map: null,
  markers: [],
  currentLatLng: { lat: 37.7749, lng: -122.4194 }, // fallback: San Francisco
  placeMarker: null,
  trafficLayer: null,
  trafficEnabled: false,
  incidentMarkers: [],
  routingEnabled: false,
  routePoints: [], // [start, end]
  routeMarkers: [],
  routeLine: null,
  routeReplaceTarget: null, // 'start' | 'end' | null
  weatherOverlayEnabled: false,
  weatherOverlayLayer: null,
};

const $ = (sel) => document.querySelector(sel);

const CONFIG = (window.APP_CONFIG || {});

function showSetupOverlayIfNeeded() {
  const overlay = $('#setup-overlay');
  const hasNeeded = CONFIG.WEATHERBIT_API_KEY && CONFIG.TOMTOM_API_KEY;
  if (!hasNeeded) overlay.classList.remove('hidden');
  const closeBtn = document.getElementById('overlay-close');
  if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
}

function initMapInstance(center) {
  const map = L.map('map').setView([center.lat, center.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  state.map = map;
  state.placeMarker = L.marker([center.lat, center.lng]).addTo(map);
  
  // Initialize TomTom Traffic Flow tile layer (not added yet)
  if (CONFIG.TOMTOM_API_KEY) {
    state.trafficLayer = L.tileLayer(
      `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${CONFIG.TOMTOM_API_KEY}`,
      {
        maxZoom: 19,
        opacity: 0.7,
        attribution: '&copy; <a href="https://www.tomtom.com/">TomTom</a>',
      }
    );
  }
  
  // Update incidents and speed when map moves (if traffic is enabled)
  map.on('moveend', () => {
    if (state.trafficEnabled) {
      const center = map.getCenter();
      state.currentLatLng = { lat: center.lat, lng: center.lng };
      refreshTrafficIncidents().catch(() => {});
      updateSpeedInfo();
    }
  });
  
  // Handle routing clicks
  map.on('click', (e) => {
    if (state.routingEnabled) {
      handleRouteClick(e.latlng);
    }
  });
}

function attachSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      await geocodeAndSet(q);
    }
  });
}

async function geocodeAndSet(query) {
  // Use Nominatim for free geocoding (usage policy applies)
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Nominatim relies on HTTP Referer for browser clients; you can also set a custom header if you proxy.
        'Accept-Language': navigator.language || 'en',
      },
    });
    if (!res.ok) throw new Error('Geocoding failed');
    const data = await res.json();
    const first = data[0];
    if (!first) return alert('No results found.');
    const pos = { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
    setLocation(pos);
  } catch (e) {
    alert('Failed to search location.');
  }
}

function setLocation(pos) {
  state.currentLatLng = pos;
  state.map.setView([pos.lat, pos.lng], 13);
  if (state.placeMarker) {
    state.placeMarker.setLatLng([pos.lat, pos.lng]);
  }
  loadWeather(pos).catch(() => {});
  refreshPOIs().catch(() => {});
  if (state.weatherOverlayEnabled) {
    updateWeatherOverlay();
    updateWeatherOverlayTiles();
  }
}

async function useMyLocation() {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
    setLocation(pos);
  } catch (e) {
    alert('Failed to get location. Check permissions or use search.');
  }
}

function kmDistance(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
}

async function loadWeather({ lat, lng }) {
  if (!CONFIG.WEATHERBIT_API_KEY) return;
  const weatherEl = document.getElementById('weather');
  weatherEl.textContent = 'Loading weather…';
  const url = new URL('https://api.weatherbit.io/v2.0/current');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('key', CONFIG.WEATHERBIT_API_KEY);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Weatherbit error');
    const data = await res.json();
    const d = data && data.data && data.data[0];
    if (!d) throw new Error('No weather data');
    const tempC = Math.round(d.temp);
    const feelsC = Math.round(d.app_temp);
    const icon = d.weather && d.weather.icon ? d.weather.icon : 'c01d';
    const desc = d.weather && d.weather.description ? d.weather.description : 'Unknown';
    weatherEl.innerHTML = `
      <div class="big">${tempC}°C</div>
      <div class="sub">Feels ${feelsC}°C • ${desc}</div>
      <img alt="icon" src="https://www.weatherbit.io/static/img/icons/${icon}.png" />
      <div class="sub">Wind ${Math.round(d.wind_spd)} m/s • RH ${d.rh}%</div>
    `;
  } catch (e) {
    weatherEl.textContent = 'Failed to load weather.';
  }
}

function mapWeatherCodeToOverlay(code) {
  if (!code && code !== 0) return 'clear';
  if (code >= 200 && code < 300) return 'storm';
  if (code >= 300 && code < 600) return 'rain';
  if (code >= 600 && code < 700) return 'snow';
  if (code >= 700 && code < 800) return 'fog';
  if (code === 800) return 'clear';
  if (code > 800) return 'clouds';
  return 'clear';
}

function toggleWeatherOverlay() {
  state.weatherOverlayEnabled = !state.weatherOverlayEnabled;
  const btn = document.getElementById('btn-toggle-weather-overlay');
  const overlay = document.getElementById('weather-overlay');
  if (!btn || !overlay) return;

  if (state.weatherOverlayEnabled) {
    btn.style.borderColor = '#38bdf8';
    btn.style.background = '#0b172c';
    overlay.style.display = 'flex';
    updateWeatherOverlay();
    updateWeatherOverlayTiles();
  } else {
    btn.style.borderColor = '#243041';
    btn.style.background = '#152033';
    overlay.style.display = 'none';
    overlay.className = 'weather-overlay';
    overlay.innerHTML = '';
    removeWeatherOverlayTiles();
  }
}

function updateWeatherOverlay() {
  if (!state.weatherOverlayEnabled || !CONFIG.WEATHERBIT_API_KEY) return;
  const overlay = document.getElementById('weather-overlay');
  if (!overlay) return;

  const { lat, lng } = state.currentLatLng;
  const url = new URL('https://api.weatherbit.io/v2.0/current');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('key', CONFIG.WEATHERBIT_API_KEY);

  fetch(url.toString())
    .then((res) => res.json())
    .then((data) => {
      const d = data && data.data && data.data[0];
      if (!d) throw new Error('No weather data');
      const tempC = Math.round(d.temp);
      const desc = d.weather && d.weather.description ? d.weather.description : 'Unknown';
      const code = d.weather && d.weather.code ? d.weather.code : 800;
      const overlayClass = mapWeatherCodeToOverlay(code);
      overlay.className = `weather-overlay ${overlayClass}`;
      overlay.innerHTML = `<div class="overlay-label">${desc} • ${tempC}°C</div>`;
      overlay.style.display = 'flex';
    })
    .catch(() => {
      // keep silent; overlay will remain as-is
    });
}

function removeWeatherOverlayTiles() {
  if (state.weatherOverlayLayer) {
    state.map.removeLayer(state.weatherOverlayLayer);
    state.weatherOverlayLayer = null;
  }
}

async function updateWeatherOverlayTiles() {
  if (!state.weatherOverlayEnabled) return;
  try {
    // RainViewer public radar tiles (no key required)
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) throw new Error('Radar meta fetch failed');
    const data = await res.json();
    const radar = data && data.radar;
    const latestPast = radar && radar.past ? radar.past[radar.past.length - 1] : null;
    const latestNowcast = radar && radar.nowcast && radar.nowcast[0] ? radar.nowcast[0] : null;
    const chosen = latestNowcast || latestPast;
    if (!chosen || !chosen.path) throw new Error('No radar frames');

    removeWeatherOverlayTiles();

    const tileUrl = `https://tilecache.rainviewer.com${chosen.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const layer = L.tileLayer(tileUrl, {
      opacity: 0.55,
      attribution: 'Radar (c) RainViewer',
    });
    layer.addTo(state.map);
    state.weatherOverlayLayer = layer;
  } catch (err) {
    // silent fail; keep previous layer if any
  }
}

function clearPOIMarkers() {
  for (const m of state.markers) state.map.removeLayer(m);
  state.markers = [];
}

function renderPOIList(items) {
  const ul = document.getElementById('poi-list');
  ul.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    const dist = kmDistance(state.currentLatLng, { lat: it.position.lat, lng: it.position.lon });
    li.innerHTML = `
      <div class="poi-name">${it.poi?.name || it.address?.freeformAddress || 'Unknown'}</div>
      <div class="poi-distance">${dist.toFixed(2)} km • ${it.address?.freeformAddress || ''}</div>
    `;
    li.addEventListener('click', () => {
      state.map.setView([it.position.lat, it.position.lon], 15);
    });
    ul.appendChild(li);
  }
}

async function fetchTransitArrivals() {
  const agencyEl = document.getElementById('transit-agency');
  const stopInput = document.getElementById('transit-stop');
  const resultsEl = document.getElementById('transit-results');
  if (!agencyEl || !stopInput || !resultsEl) return;

  const agency = agencyEl.value;
  const stopId = stopInput.value.trim();
  if (!stopId) {
    resultsEl.textContent = 'Enter a stop ID first.';
    return;
  }

  resultsEl.textContent = 'Loading arrivals...';

  try {
    let items = [];
    if (agency === 'ttc') {
      items = await fetchTtcPredictions(stopId);
    } else if (agency === 'translink') {
      items = await fetchTransLinkPredictions(stopId);
    }

    renderTransitResults(items, agency);
  } catch (err) {
    resultsEl.textContent = 'Failed to load arrivals. Check stop ID or API key.';
  }
}

function renderTransitResults(items, agency) {
  const target = document.getElementById('transit-results');
  if (!target) return;

  if (!items || items.length === 0) {
    target.textContent = 'No upcoming vehicles for this stop.';
    return;
  }

  const agencyLabel = agency === 'translink' ? 'TransLink' : 'TTC';

  const html = items.slice(0, 12).map((it) => {
    const mins = Number.isFinite(it.minutes) ? `${it.minutes} min` : 'Due';
    const head = it.headsign || 'Inbound';
    const route = it.route || 'Route';
    const stop = it.stopTitle ? ` • ${it.stopTitle}` : '';
    const vehicle = it.vehicle ? ` • Vehicle ${it.vehicle}` : '';
    return `
      <div class="transit-item">
        <div class="transit-line">${route} • ${head}</div>
        <div class="transit-meta">${agencyLabel}${stop}${vehicle}</div>
        <div class="transit-time">${mins}</div>
      </div>
    `;
  }).join('');

  target.innerHTML = html;
}

async function fetchTtcPredictions(stopId) {
  const url = `https://retro.umoiq.com/service/publicJSONFeed?command=predictions&a=ttc&stopId=${encodeURIComponent(stopId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('TTC API error');
  const data = await res.json();

  const raw = data && data.predictions;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const items = [];

  for (const p of list) {
    const stopTitle = p.stopTitle || '';
    const route = p.routeTitle || p.routeTag || 'Route';
    const dirs = p.direction ? (Array.isArray(p.direction) ? p.direction : [p.direction]) : [];
    for (const dir of dirs) {
      const headsign = dir.title || '';
      const preds = dir.prediction ? (Array.isArray(dir.prediction) ? dir.prediction : [dir.prediction]) : [];
      for (const pr of preds) {
        const minutes = Number(pr.minutes);
        items.push({
          agency: 'ttc',
          route,
          headsign,
          minutes: Number.isFinite(minutes) ? minutes : null,
          vehicle: pr.vehicle || '',
          stopTitle,
          branch: pr.branch || '',
        });
      }
    }
  }

  return items.sort((a, b) => (a.minutes || 0) - (b.minutes || 0));
}

async function fetchTransLinkPredictions(stopId) {
  if (!CONFIG.TRANSLINK_API_KEY) {
    throw new Error('TransLink API key missing');
  }
  const url = `https://api.translink.ca/rttiapi/v1/stops/${encodeURIComponent(stopId)}/estimates?apikey=${encodeURIComponent(CONFIG.TRANSLINK_API_KEY)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('TransLink API error');
  const data = await res.json();

  const items = [];
  for (const route of data || []) {
    const routeId = route.RouteNo || route.RouteName || 'Route';
    const headsign = route.RouteName || route.Destination || '';
    const stopTitle = route.StopName || '';
    const schedules = Array.isArray(route.Schedules) ? route.Schedules : [];
    for (const sch of schedules) {
      const minutes = Number(sch.ExpectedCountdown);
      items.push({
        agency: 'translink',
        route: routeId,
        headsign,
        minutes: Number.isFinite(minutes) ? minutes : null,
        vehicle: sch.VehicleNo || '',
        stopTitle,
      });
    }
  }

  return items.sort((a, b) => (a.minutes || 0) - (b.minutes || 0));
}

async function refreshPOIs() {
  if (!CONFIG.TOMTOM_API_KEY) return;
  const category = document.getElementById('poi-category').value || 'restaurant';
  const { lat, lng } = state.currentLatLng;
  const url = new URL(`https://api.tomtom.com/search/2/search/${encodeURIComponent(category)}.json`);
  url.searchParams.set('key', CONFIG.TOMTOM_API_KEY);
  url.searchParams.set('limit', '20');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('radius', '5000');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('TomTom error');
    const data = await res.json();
    const results = data.results || [];
    renderPOIList(results);

    clearPOIMarkers();
    for (const r of results) {
      const marker = L.circleMarker([r.position.lat, r.position.lon], {
        radius: 6,
        color: '#0ea5e9',
        fillColor: '#38bdf8',
        fillOpacity: 1,
        weight: 2,
      }).addTo(state.map);
      marker.bindPopup(
        (r.poi?.name || category) +
        (r.address?.freeformAddress ? `<br/>${r.address.freeformAddress}` : '')
      );
      state.markers.push(marker);
    }
  } catch (e) {
    // Silent fail in UI; could add toast.
  }
}

function bindUI() {
  $('#btn-my-location').addEventListener('click', useMyLocation);
  $('#btn-refresh-poi').addEventListener('click', refreshPOIs);
  $('#poi-category').addEventListener('change', refreshPOIs);
  $('#btn-toggle-traffic').addEventListener('click', toggleTraffic);
  $('#btn-toggle-weather-overlay').addEventListener('click', toggleWeatherOverlay);
  $('#btn-toggle-routing').addEventListener('click', toggleRouting);
  $('#btn-close-route-sidebar').addEventListener('click', toggleRouting);
  $('#btn-clear-route').addEventListener('click', clearRoute);
  $('#btn-transit-fetch').addEventListener('click', fetchTransitArrivals);
  $('#btn-set-start').addEventListener('click', () => setRoutePointFromInput('start'));
  $('#btn-set-end').addEventListener('click', () => setRoutePointFromInput('end'));
  $('#btn-replace-start').addEventListener('click', () => setRouteReplaceMode('start'));
  $('#btn-replace-end').addEventListener('click', () => setRouteReplaceMode('end'));
  $('#route-mode').addEventListener('change', () => {
    if (state.routePoints.length === 2) {
      calculateRoute();
    }
  });
  
  // Allow Enter key in route inputs
  $('#route-start-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setRoutePointFromInput('start');
  });
  $('#route-end-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setRoutePointFromInput('end');
  });
  $('#transit-stop').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchTransitArrivals();
  });
}

function toggleTraffic() {
  if (!state.trafficLayer) {
    alert('Traffic layer requires TomTom API key in config.js');
    return;
  }
  
  state.trafficEnabled = !state.trafficEnabled;
  const statusEl = document.getElementById('traffic-status');
  const panelEl = document.getElementById('traffic-panel');
  const speedEl = document.getElementById('speed-display');
  
  if (state.trafficEnabled) {
    state.trafficLayer.addTo(state.map);
    statusEl.textContent = 'On';
    statusEl.style.color = '#22c55e';
    panelEl.style.display = 'block';
    speedEl.style.display = 'block';
    refreshTrafficIncidents().catch(() => {});
    updateSpeedInfo();
  } else {
    state.map.removeLayer(state.trafficLayer);
    statusEl.textContent = 'Off';
    statusEl.style.color = '#94a3b8';
    panelEl.style.display = 'none';
    speedEl.style.display = 'none';
    clearIncidentMarkers();
  }
}

function clearIncidentMarkers() {
  for (const m of state.incidentMarkers) state.map.removeLayer(m);
  state.incidentMarkers = [];
}

async function refreshTrafficIncidents() {
  if (!CONFIG.TOMTOM_API_KEY) return;
  const { lat, lng } = state.currentLatLng;
  const bounds = state.map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  
  // TomTom Traffic Incidents API v5
  const url = new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
  url.searchParams.set('key', CONFIG.TOMTOM_API_KEY);
  url.searchParams.set('bbox', `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`);
  url.searchParams.set('fields', '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime}}}');
  url.searchParams.set('language', 'en-US');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Incidents API error');
    const data = await res.json();
    const incidents = data.incidents || [];
    
    renderIncidents(incidents);
    clearIncidentMarkers();
    
    // Add incident markers
    for (const inc of incidents.slice(0, 50)) { // Limit to 50 for performance
      if (inc.geometry && inc.geometry.type === 'Point') {
        const [lng, lat] = inc.geometry.coordinates;
        const props = inc.properties || {};
        const iconCat = props.iconCategory || 0;
        const delay = props.magnitudeOfDelay || 0;
        const desc = props.events && props.events[0] ? props.events[0].description : 'Incident';
        
        // Icon color based on severity
        let color = '#facc15'; // default yellow
        if (delay >= 3) color = '#ef4444'; // red for major
        else if (delay >= 2) color = '#fb923c'; // orange for moderate
        
        const marker = L.circleMarker([lat, lng], {
          radius: 8,
          color: '#fff',
          fillColor: color,
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(state.map);
        
        marker.bindPopup(`
          <strong>${getIncidentIcon(iconCat)} ${getIncidentType(iconCat)}</strong><br/>
          ${desc}<br/>
          <em>Delay: ${getDelayText(delay)}</em>
        `);
        
        state.incidentMarkers.push(marker);
      }
    }
  } catch (e) {
    document.getElementById('incidents-list').textContent = 'Failed to load incidents.';
  }
}

function renderIncidents(incidents) {
  const listEl = document.getElementById('incidents-list');
  if (!incidents || incidents.length === 0) {
    listEl.textContent = 'No incidents in current area.';
    return;
  }
  
  listEl.innerHTML = '';
  const limitedIncidents = incidents.slice(0, 10); // Show top 10
  
  for (const inc of limitedIncidents) {
    const props = inc.properties || {};
    const iconCat = props.iconCategory || 0;
    const delay = props.magnitudeOfDelay || 0;
    const desc = props.events && props.events[0] ? props.events[0].description : 'Traffic incident';
    
    const item = document.createElement('div');
    item.className = 'incident-item';
    item.innerHTML = `
      <div class="incident-type">${getIncidentIcon(iconCat)} ${getIncidentType(iconCat)}</div>
      <div class="incident-desc">${desc}</div>
      <div class="incident-delay">Delay: ${getDelayText(delay)}</div>
    `;
    
    // Click to center on incident
    if (inc.geometry && inc.geometry.type === 'Point') {
      const [lng, lat] = inc.geometry.coordinates;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        state.map.setView([lat, lng], 15);
      });
    }
    
    listEl.appendChild(item);
  }
}

function getIncidentIcon(category) {
  const icons = {
    0: '⚠️', 1: '🚧', 2: '🚗', 3: '🚙', 4: '🚛',
    5: '⛔', 6: '🔧', 7: '🌧️', 8: '❄️', 9: '🌫️',
    10: '🔥', 11: '💨', 14: '🚦'
  };
  return icons[category] || '⚠️';
}

function getIncidentType(category) {
  const types = {
    0: 'Unknown', 1: 'Accident', 2: 'Fog', 3: 'Dangerous Conditions',
    4: 'Rain', 5: 'Ice', 6: 'Jam', 7: 'Lane Closed', 8: 'Road Closed',
    9: 'Road Works', 10: 'Wind', 11: 'Flooding', 14: 'Broken Down Vehicle'
  };
  return types[category] || 'Incident';
}

function getDelayText(magnitude) {
  const delays = ['None', 'Minor', 'Moderate', 'Major', 'Severe'];
  return delays[magnitude] || 'Unknown';
}

function updateSpeedInfo() {
  const zoom = state.map.getZoom();
  const infoEl = document.getElementById('speed-info');
  
  // Rough speed limit estimation based on zoom and OSM road types
  // In production, you'd fetch from TomTom's Speed Limits API or OSM tags
  let speedEstimate = 'Unknown';
  if (zoom >= 16) speedEstimate = '30-50 km/h (Urban)';
  else if (zoom >= 14) speedEstimate = '50-80 km/h (Suburban)';
  else if (zoom >= 12) speedEstimate = '80-100 km/h (Highway)';
  else speedEstimate = '100-130 km/h (Motorway)';
  
  infoEl.innerHTML = `
    <div style="color:var(--accent-2);">${speedEstimate}</div>
    <div style="font-size:12px;margin-top:2px;">Zoom: ${zoom} • Estimated for area type</div>
  `;
}

function toggleRouting() {
  state.routingEnabled = !state.routingEnabled;
  const sidebarEl = document.getElementById('route-sidebar');
  const btn = document.getElementById('btn-toggle-routing');
  
  if (state.routingEnabled) {
    sidebarEl.classList.add('open');
    btn.style.borderColor = '#22c55e';
    btn.style.background = '#1a3a28';
    state.map.getContainer().style.cursor = 'crosshair';
    document.getElementById('routing-status').textContent = 'Click two points on the map or enter locations below';
  } else {
    sidebarEl.classList.remove('open');
    btn.style.borderColor = '#243041';
    btn.style.background = '#152033';
    state.map.getContainer().style.cursor = '';
    clearRoute();
  }
}

function setRouteReplaceMode(target) {
  state.routeReplaceTarget = target;
  const startBtn = document.getElementById('btn-replace-start');
  const endBtn = document.getElementById('btn-replace-end');
  startBtn.style.borderColor = target === 'start' ? '#22c55e' : '#243041';
  startBtn.style.background = target === 'start' ? '#1a3a28' : '#152033';
  endBtn.style.borderColor = target === 'end' ? '#ef4444' : '#243041';
  endBtn.style.background = target === 'end' ? '#2a1810' : '#152033';
  const msg = target
    ? `Next map click replaces the ${target} pin`
    : 'Click two points on the map or enter locations below';
  document.getElementById('routing-status').textContent = msg;
}

async function setRoutePointFromInput(type) {
  const inputId = type === 'start' ? 'route-start-input' : 'route-end-input';
  const input = document.getElementById(inputId);
  const query = input.value.trim();
  
  if (!query) return;
  
  // Geocode the address using Nominatim
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  
  try {
    const res = await fetch(url.toString(), {
      headers: { 'Accept-Language': navigator.language || 'en' },
    });
    if (!res.ok) throw new Error('Geocoding failed');
    const data = await res.json();
    const first = data[0];
    if (!first) {
      alert('Location not found. Try a different address.');
      return;
    }
    
    const pos = { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
    
    // If setting start and we already have a start, replace it
    if (type === 'start' && state.routePoints.length > 0) {
      if (state.routeMarkers[0]) {
        state.map.removeLayer(state.routeMarkers[0]);
      }
      state.routePoints[0] = pos;
      state.routeMarkers[0] = addRouteMarker(pos, 'start');
    } else if (type === 'end' && state.routePoints.length === 2) {
      if (state.routeMarkers[1]) {
        state.map.removeLayer(state.routeMarkers[1]);
      }
      state.routePoints[1] = pos;
      state.routeMarkers[1] = addRouteMarker(pos, 'end');
    } else if (type === 'start' && state.routePoints.length === 0) {
      state.routePoints[0] = pos;
      state.routeMarkers[0] = addRouteMarker(pos, 'start');
      document.getElementById('routing-status').textContent = 'Now set destination';
    } else if (type === 'end' && state.routePoints.length === 1) {
      state.routePoints[1] = pos;
      state.routeMarkers[1] = addRouteMarker(pos, 'end');
    }
    
    state.map.setView([pos.lat, pos.lng], 13);
    
    if (state.routePoints.length === 2 && state.routePoints[0] && state.routePoints[1]) {
      document.getElementById('routing-status').textContent = 'Calculating route...';
      calculateRoute();
    }
  } catch (e) {
    alert('Failed to find location. Check your internet connection.');
  }
}

function addRouteMarker(pos, type) {
  const icon = type === 'start' ? '🟢' : '🔴';
  const label = type === 'start' ? 'Start' : 'End';
  
  const marker = L.marker([pos.lat, pos.lng], {
    icon: L.divIcon({
      html: `<div style="font-size:24px;">${icon}</div>`,
      className: 'route-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
  }).addTo(state.map);
  marker.bindPopup(label);
  return marker;
}

function handleRouteClick(latlng) {
  const pos = { lat: latlng.lat, lng: latlng.lng };

  if (state.routeReplaceTarget) {
    const idx = state.routeReplaceTarget === 'start' ? 0 : 1;
    if (state.routePoints[idx]) {
      if (state.routeMarkers[idx]) state.map.removeLayer(state.routeMarkers[idx]);
      state.routePoints[idx] = pos;
      state.routeMarkers[idx] = addRouteMarker(pos, state.routeReplaceTarget);
      state.routeReplaceTarget = null;
      setRouteReplaceMode(null);
      document.getElementById('routing-status').textContent = 'Calculating route...';
      calculateRoute();
      return;
    }
  }

  if (state.routePoints.length < 2) {
    state.routePoints.push(pos);
    const type = state.routePoints.length === 1 ? 'start' : 'end';
    const marker = addRouteMarker(pos, type);
    state.routeMarkers.push(marker);
    if (state.routePoints.length === 1) {
      document.getElementById('routing-status').textContent = 'Click destination point or enter address';
    } else if (state.routePoints.length === 2) {
      document.getElementById('routing-status').textContent = 'Calculating route...';
      calculateRoute();
    }
  } else {
    if (state.routeMarkers[1]) state.map.removeLayer(state.routeMarkers[1]);
    state.routePoints[1] = pos;
    state.routeMarkers[1] = addRouteMarker(pos, 'end');
    document.getElementById('routing-status').textContent = 'Calculating route...';
    calculateRoute();
  }
}

function clearRoute() {
  state.routePoints = [];
  for (const m of state.routeMarkers) state.map.removeLayer(m);
  state.routeMarkers = [];
  if (state.routeLine) {
    state.map.removeLayer(state.routeLine);
    state.routeLine = null;
  }
  document.getElementById('routing-status').textContent = 'Click two points on the map or enter locations below';
  document.getElementById('route-summary').style.display = 'none';
  document.getElementById('directions-list').textContent = 'No route calculated yet';
  document.getElementById('route-start-input').value = '';
  document.getElementById('route-end-input').value = '';
  state.routeReplaceTarget = null;
  setRouteReplaceMode(null);
}

async function calculateRoute() {
  if (!CONFIG.TOMTOM_API_KEY) {
    alert('Routing requires TomTom API key in config.js');
    return;
  }
  
  const [start, end] = state.routePoints;
  const mode = document.getElementById('route-mode').value;
  
  const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${start.lat},${start.lng}:${end.lat},${end.lng}/json`);
  url.searchParams.set('key', CONFIG.TOMTOM_API_KEY);
  url.searchParams.set('travelMode', mode);
  url.searchParams.set('traffic', 'true');
  url.searchParams.set('instructionsType', 'text');
  url.searchParams.set('language', 'en-US');
  
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Routing API error');
    const data = await res.json();
    
    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }
    
    const route = data.routes[0];
    displayRoute(route);
    document.getElementById('routing-status').textContent = 'Route calculated!';
    document.getElementById('routing-status').style.color = '#22c55e';
  } catch (e) {
    document.getElementById('routing-status').textContent = 'Failed to calculate route. Try different points.';
    document.getElementById('routing-status').style.color = '#ef4444';
  }
}

function displayRoute(route) {
  const summary = route.summary;
  const legs = route.legs || [];
  
  const distanceKm = (summary.lengthInMeters / 1000).toFixed(2);
  const durationMin = Math.round(summary.travelTimeInSeconds / 60);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const durationText = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  
  const now = new Date();
  const arrival = new Date(now.getTime() + summary.travelTimeInSeconds * 1000);
  const arrivalDate = arrival.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const arrivalTime = arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const arrivalText = `${arrivalDate}, ${arrivalTime}`;
  
  document.getElementById('route-distance').textContent = `${distanceKm} km`;
  document.getElementById('route-duration').textContent = durationText;
  document.getElementById('route-arrival').textContent = arrivalText;
  document.getElementById('route-summary').style.display = 'block';
  
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  
  const coordinates = [];
  for (const leg of legs) {
    for (const point of leg.points) {
      coordinates.push([point.latitude, point.longitude]);
    }
  }
  
  state.routeLine = L.polyline(coordinates, {
    color: '#3b82f6',
    weight: 5,
    opacity: 0.8,
  }).addTo(state.map);
  
  state.map.fitBounds(state.routeLine.getBounds(), { padding: [50, 50] });
  
  renderDirections(legs);
}

function renderDirections(legs) {
  const listEl = document.getElementById('directions-list');
  listEl.innerHTML = '';
  
  let stepNum = 1;
  for (const leg of legs) {
    for (const inst of leg.instructions || []) {
      const item = document.createElement('div');
      item.className = 'direction-item';
      
      const distanceM = inst.routeOffsetInMeters || 0;
      const distanceText = distanceM > 1000 
        ? `${(distanceM / 1000).toFixed(1)} km` 
        : `${distanceM} m`;
      
      const icon = getDirectionIcon(inst.maneuver);
      
      item.innerHTML = `
        <div class="direction-step">${icon} <strong>Step ${stepNum}</strong></div>
        <div class="direction-text">${inst.message || 'Continue'}</div>
        <div class="direction-distance">${distanceText}</div>
      `;
      
      listEl.appendChild(item);
      stepNum++;
    }
  }
}

function getDirectionIcon(maneuver) {
  const icons = {
    'ARRIVE': '🏁',
    'DEPART': '🟢',
    'TURN_LEFT': '⬅️',
    'TURN_RIGHT': '➡️',
    'BEAR_LEFT': '↖️',
    'BEAR_RIGHT': '↗️',
    'KEEP_LEFT': '⬅️',
    'KEEP_RIGHT': '➡️',
    'MAKE_UTURN': '🔄',
    'ENTER_MOTORWAY': '🛣️',
    'TAKE_EXIT': '🚪',
    'ROUNDABOUT_LEFT': '🔃',
    'ROUNDABOUT_RIGHT': '🔃',
    'STRAIGHT': '⬆️',
  };
  return icons[maneuver] || '➡️';
}

async function main() {
  showSetupOverlayIfNeeded();
  try {
    initMapInstance(state.currentLatLng);
    attachSearch();
    bindUI();
    // Try to use geolocation on load; ignore failure
    useMyLocation().catch(() => setLocation(state.currentLatLng));
    // Also load weather/POIs for fallback location immediately
    loadWeather(state.currentLatLng).catch(() => {});
    refreshPOIs().catch(() => {});
  } catch (e) {
    const map = document.getElementById('map');
    map.innerHTML = '<div style="padding:12px;color:#fff;">Failed to initialize map.</div>';
  }
}

document.addEventListener('DOMContentLoaded', main);
