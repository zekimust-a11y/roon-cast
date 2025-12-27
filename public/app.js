const coreSelect = document.getElementById('core-select');
const zoneSelect = document.getElementById('zone-select');
const castSelect = document.getElementById('cast-select');
const castStatusEl = document.getElementById('cast-status');
const refreshStatusBtn = document.getElementById('refresh-status');
const reselectZoneBtn = document.getElementById('reselect-zone');
const refreshCastBtn = document.getElementById('refresh-cast');
const trackTitleEl = document.getElementById('track-title');
const trackArtistEl = document.getElementById('track-artist');
const trackAlbumEl = document.getElementById('track-album');
const zoneNameEl = document.getElementById('zone-name');
const coreNameEl = document.getElementById('core-name');
const debugLog = document.getElementById('debug-log');

const socket = io();

const postJSON = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

async function fetchStatus() {
  const response = await fetch('/api/status');
  const data = await response.json();
  renderCores(data.roon);
  renderZones(data.roon);
  renderDevices(data.cast?.devices || []);
  updateCastStatus(data.cast?.castStatus || 'idle');
  updateNowPlaying(data.roon?.nowPlaying);
}

function logDebug(message, payload) {
  const lines = [`[${new Date().toLocaleTimeString()}] ${message}`];
  if (payload) {
    lines.push(JSON.stringify(payload, null, 2));
  }
  debugLog.textContent = `${lines.join('\n')}\n${debugLog.textContent}`.slice(0, 8000);
}

function renderCores(data) {
  const { cores = [], activeCoreId } = data;
  coreSelect.innerHTML = '';
  if (cores.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Waiting for authorization...';
    coreSelect.appendChild(opt);
    coreSelect.disabled = true;
    return;
  }
  coreSelect.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a Roon Core';
  coreSelect.appendChild(placeholder);

  cores.forEach((core) => {
    const option = document.createElement('option');
    option.value = core.id;
    option.textContent = `${core.name} (${core.version})`;
    if (core.id === activeCoreId) option.selected = true;
    coreSelect.appendChild(option);
  });
}

function renderZones(data) {
  const { zones = [], selectedZoneId } = data;
  zoneSelect.innerHTML = '';
  if (!data.activeCoreId) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Select a core first';
    zoneSelect.appendChild(opt);
    zoneSelect.disabled = true;
    return;
  }
  zoneSelect.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a zone';
  zoneSelect.appendChild(placeholder);

  zones.forEach((zone) => {
    const option = document.createElement('option');
    option.value = zone.zone_id;
    option.textContent = zone.display_name;
    if (zone.zone_id === selectedZoneId) option.selected = true;
    zoneSelect.appendChild(option);
  });
}

function renderDevices(devices) {
  castSelect.innerHTML = '';
  if (!devices || devices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No Chromecasts found yet';
    castSelect.appendChild(opt);
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a Chromecast';
  castSelect.appendChild(placeholder);

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = `${device.friendlyName} (${device.address})`;
    if (device.isSelected) option.selected = true;
    castSelect.appendChild(option);
  });
}

function updateCastStatus(status) {
  castStatusEl.textContent = status;
  castStatusEl.className = `status-pill status-${status}`;
}

function updateNowPlaying(payload) {
  if (!payload || !payload.now_playing) {
    trackTitleEl.textContent = 'Waiting for playback…';
    trackArtistEl.textContent = '';
    trackAlbumEl.textContent = '';
    zoneNameEl.textContent = '';
    coreNameEl.textContent = '';
    return;
  }
  const meta = payload.now_playing.three_line || {};
  trackTitleEl.textContent = meta.line1 || 'Unknown track';
  trackArtistEl.textContent = meta.line2 || '';
  trackAlbumEl.textContent = meta.line3 || '';
  zoneNameEl.textContent = payload.zone_name ? `Zone: ${payload.zone_name}` : '';
  coreNameEl.textContent = payload.core_name ? `Core: ${payload.core_name}` : '';
}

coreSelect.addEventListener('change', async (event) => {
  const value = event.target.value;
  if (!value) return;
  await postJSON('/api/cores/select', { coreId: value });
  logDebug('Selected core', { coreId: value });
});

zoneSelect.addEventListener('change', async (event) => {
  const value = event.target.value;
  if (!value) return;
  await postJSON('/api/zones/select', { zoneId: value });
  logDebug('Selected zone', { zoneId: value });
});

castSelect.addEventListener('change', async (event) => {
  const value = event.target.value;
  if (!value) return;
  await postJSON('/api/cast/select', { deviceId: value });
  logDebug('Selected Chromecast', { deviceId: value });
});

refreshStatusBtn.addEventListener('click', async () => {
  await fetchStatus();
  logDebug('Manually refreshed status');
});

reselectZoneBtn.addEventListener('click', async () => {
  const value = zoneSelect.value;
  if (!value) {
    logDebug('No zone selected to reselect');
    return;
  }
  await postJSON('/api/zones/select', { zoneId: value });
  logDebug('Reselected zone', { zoneId: value });
});

refreshCastBtn.addEventListener('click', async () => {
  await postJSON('/api/cast/refresh', {});
  await fetchStatus();
  logDebug('Requested Chromecast rescan');
});

socket.on('bootstrap', (snapshot) => {
  renderCores(snapshot.roon);
  renderZones(snapshot.roon);
  renderDevices(snapshot.cast?.devices || []);
  updateCastStatus(snapshot.cast?.castStatus || 'idle');
  updateNowPlaying(snapshot.roon.nowPlaying);
  autoSelectIfSingle(snapshot);
});

socket.on('roon:update', (snapshot) => {
  renderCores(snapshot);
  renderZones(snapshot);
});

socket.on('roon:now-playing', (payload) => {
  updateNowPlaying(payload);
});

socket.on('cast:devices', (devices) => {
  logDebug('Chromecast list updated', { count: devices.length });
  renderDevices(devices);
  autoSelectIfSingle({
    roon: { cores: Array.from(coreSelect.options).slice(1), zones: [] },
    cast: { devices },
  });
});

socket.on('cast:status', (status) => {
  updateCastStatus(status);
});

socket.on('cast:error', (message) => {
  logDebug(`Chromecast error: ${message}`);
});

socket.on('connect_error', (error) => {
  logDebug('Socket error', error);
});

fetchStatus().catch((err) => logDebug('Initial status fetch failed', err));

function autoSelectIfSingle(snapshot) {
  const { roon, cast } = snapshot;
  const singleCore = roon?.cores?.length === 1;
  const singleZone = roon?.zones?.length === 1;
  const singleCast = cast?.devices?.length === 1;

  if (!singleCore && !singleZone && !singleCast) return;
  socket.emit('request:auto-select');
}

