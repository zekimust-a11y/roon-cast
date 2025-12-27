const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./config');
const RoonService = require('./services/roonService');
const ChromecastService = require('./services/chromecastService');
const imageStore = require('./services/imageStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roonService = new RoonService();
const chromecastService = new ChromecastService({
  appId: config.castAppId,
  namespace: config.castNamespace,
  receiverUrl: config.receiverUrl,
});

imageStore.configure({ baseUrl: config.publicBaseUrl });

roonService.start();
chromecastService.start();

app.use(cors());
app.use(express.json());
app.get('/images/:id', (req, res) => {
  const record = imageStore.getById(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.setHeader('Content-Type', record.contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(record.buffer);
});

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/status', (req, res) => {
  res.json({
    roon: roonService.getSnapshot(),
    cast: chromecastService.getSnapshot(),
  });
});

app.post('/api/cores/select', (req, res) => {
  const { coreId } = req.body;
  if (!coreId) {
    return res.status(400).json({ error: 'coreId is required' });
  }
  const success = roonService.setActiveCore(coreId);
  if (!success) {
    return res.status(404).json({ error: 'Unknown core identifier' });
  }
  return res.json({ ok: true });
});

app.post('/api/zones/select', (req, res) => {
  const { zoneId } = req.body;
  if (!zoneId) {
    return res.status(400).json({ error: 'zoneId is required' });
  }
  roonService.setSelectedZone(zoneId);
  return res.json({ ok: true });
});

app.post('/api/cast/select', (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }
  const success = chromecastService.selectDevice(deviceId);
  if (!success) {
    return res.status(404).json({ error: 'Device not found' });
  }
  return res.json({ ok: true });
});

app.post('/api/cast/refresh', (req, res) => {
  chromecastService.refreshDiscovery();
  return res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.emit('bootstrap', {
    roon: roonService.getSnapshot(),
    cast: chromecastService.getSnapshot(),
  });

  socket.on('request:auto-select', () => {
    const snapshot = roonService.getSnapshot();
    const castSnapshot = chromecastService.getSnapshot();

    if (snapshot.cores.length === 1 && !snapshot.activeCoreId) {
      roonService.setActiveCore(snapshot.cores[0].id);
    }

    if (
      snapshot.zones.length === 1 &&
      (!snapshot.selectedZoneId || snapshot.selectedZoneId !== snapshot.zones[0].zone_id)
    ) {
      roonService.setSelectedZone(snapshot.zones[0].zone_id);
    }

    if (
      castSnapshot.devices.length === 1 &&
      (!castSnapshot.selectedDeviceId || castSnapshot.selectedDeviceId !== castSnapshot.devices[0].id)
    ) {
      chromecastService.selectDevice(castSnapshot.devices[0].id);
    }

    socket.emit('bootstrap', {
      roon: roonService.getSnapshot(),
      cast: chromecastService.getSnapshot(),
    });
  });
});

roonService.on('update', (snapshot) => {
  io.emit('roon:update', snapshot);
});

roonService.on('now-playing', (payload) => {
  console.log('[Roon] now-playing update', payload?.state, payload?.now_playing?.three_line?.line1);
  try {
    const size = Buffer.byteLength(JSON.stringify(payload || {}));
    console.log('[Roon] payload size bytes', size);
  } catch (err) {
    console.warn('[Roon] payload size calc failed', err.message);
  }
  io.emit('roon:now-playing', payload);
  
  // If we have track data, treat it as NOW_PLAYING (cancels stop timer)
  // This handles track changes that briefly go to "stopped" state
  if (payload && payload.now_playing) {
    chromecastService.sendNowPlaying(payload);
  } else if (payload && payload.state === 'playing') {
    chromecastService.sendNowPlaying(payload);
  } else {
    chromecastService.sendState(payload);
  }
});

roonService.on('core-unavailable', () => {
  chromecastService.stopCasting();
});

roonService.on('playback-state', (state, payload) => {
  console.log('[Roon] state change', state);
  io.emit('roon:state', { state, payload });
});

chromecastService.on('devices', (devices) => {
  io.emit('cast:devices', devices);
});

chromecastService.on('status', (status) => {
  io.emit('cast:status', status);
});

chromecastService.on('message', (message) => {
  io.emit('cast:message', message);
});

chromecastService.on('error', (error) => {
  console.error('[Chromecast error]', error.message || error);
  io.emit('cast:error', error.message || String(error));
});

const shutdown = () => {
  chromecastService.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(config.port, () => {
  console.log(`Roon Cast bridge running on http://localhost:${config.port}`);
  console.log(`Public assets available at ${config.publicBaseUrl}`);
});

