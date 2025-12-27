const EventEmitter = require('events');
const mdns = require('mdns-js');
const { Client } = require('castv2');
const { loadConfig, saveConfig } = require('../utils/config');

const DISCOVERY_SERVICE = mdns.tcp('googlecast');
const DEVICE_TTL_MS = 24 * 60 * 60 * 1000; // keep entries for 24h unless rediscovered
const MAX_MESSAGE_BYTES = 60 * 1024; // stay below Chromecast channel limits

class ChromecastService extends EventEmitter {
  constructor({ appId, namespace, receiverUrl }) {
    super();
    this.setMaxListeners(50);
    this.appId = appId;
    this.namespace = namespace;
    this.receiverUrl = receiverUrl;

    this.devices = new Map();
    this.selectedDeviceId = null;

    this.browser = null;
    this.cleanupInterval = null;

    this.client = null;
    this.connectionChannel = null;
    this.receiverChannel = null;
    this.appConnection = null;
    this.customChannel = null;
    this.heartbeat = null;
    this.heartbeatInterval = null;
    this.transportId = null;
    this.castStatus = 'idle';

    this.pendingLaunch = null;
    this.requestId = 1;
    this.lastMessage = null;
    this.stopCastTimer = null;
    this.config = loadConfig();
  }

  resetApplicationState() {
    this.transportId = null;
    this.customChannel = null;
    if (this.appConnection) {
      try {
        this.appConnection.close?.();
      } catch (err) {
        /* ignore */
      }
    }
    this.appConnection = null;
  }

  start() {
    try {
      mdns.excludeInterface('0.0.0.0');
    } catch (error) {
      this.emit('error', error);
    }
    this.browser = mdns.createBrowser(DISCOVERY_SERVICE);
    this.browser.on('ready', () => {
      console.log('[Chromecast] mDNS browser ready, discovering...');
      this.browser.discover();
    });
    this.browser.on('update', (data) => {
      console.log('[Chromecast] mDNS update', {
        fullname: data.fullname,
        addresses: data.addresses,
        txt: data.txt,
      });
      this.registerDevice(data);
    });
    this.browser.on('error', (err) => {
      console.error('[Chromecast] mDNS error', err);
      this.emit('error', err);
    });

    this.cleanupInterval = setInterval(() => this.purgeStaleDevices(), 30 * 1000);
  }

  stop() {
    if (this.stopCastTimer) {
      clearTimeout(this.stopCastTimer);
      this.stopCastTimer = null;
    }
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.disconnect();
  }

  registerDevice(service) {
    if (!service.txt || !service.addresses || service.addresses.length === 0) return;
    const txtRecord = {};
    service.txt.forEach((entry) => {
      const [key, value] = entry.split('=');
      txtRecord[key] = value;
    });

    const id = txtRecord.id || service.fullname;
    const existing = this.devices.get(id) || {};
    const device = {
      id,
      friendlyName: txtRecord.fn || existing.friendlyName || service.host || id,
      model: txtRecord.md || existing.model,
      address: service.addresses[0] || existing.address,
      port: service.port || (service.srv && service.srv.port) || existing.port || 8009,
      lastSeen: Date.now(),
    };
    this.devices.set(id, device);
    console.log('[Chromecast] registered device', device);
    this.emit('devices', this.getDevices());
  }

  purgeStaleDevices() {
    const now = Date.now();
    let removed = false;
    this.devices.forEach((device, id) => {
      if (now - device.lastSeen > DEVICE_TTL_MS) {
        this.devices.delete(id);
        removed = true;
      }
    });
    if (removed) {
      this.emit('devices', this.getDevices());
    }
  }

  selectDevice(deviceId) {
    if (!this.devices.has(deviceId)) return false;
    this.selectedDeviceId = deviceId;
    this.config.selectedChromecastId = deviceId;
    saveConfig(this.config);
    this.emit('devices', this.getDevices());
    this.connect().catch(() => {
      /* handled via event emitter */
    });
    return true;
  }

  getDevices() {
    return Array.from(this.devices.values()).map((device) => ({
      id: device.id,
      friendlyName: device.friendlyName,
      model: device.model,
      address: device.address,
      isSelected: device.id === this.selectedDeviceId,
    }));
  }

  refreshDiscovery() {
    if (this.browser) {
      try {
        console.log('[Chromecast] manual discovery refresh');
        this.browser.discover();
        this.emit('devices', this.getDevices());
      } catch (error) {
        console.error('[Chromecast] refresh error', error);
        this.emit('error', error);
      }
    }
  }

  connect() {
    if (!this.selectedDeviceId) {
      return Promise.reject(new Error('No Chromecast selected'));
    }
    const device = this.devices.get(this.selectedDeviceId);
    if (!device) {
      return Promise.reject(new Error('Selected Chromecast not available'));
    }
    if (this.client) {
      console.log('[Chromecast] reuse existing client connection');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      console.log('[Chromecast] connecting to', device.address, device.port);
      this.client = new Client();
      const handleError = (err) => {
        this.emit('error', err);
        this.disconnect();
        reject(err);
      };

      this.client.on('error', handleError);
      this.client.on('close', () => {
        this.castStatus = 'disconnected';
        this.emit('status', this.castStatus);
        this.disconnect();
      });

      this.client.connect({ host: device.address, port: device.port }, () => {
        console.log('[Chromecast] TCP connected');
        this.connectionChannel = this.client.createChannel(
          'sender-0',
          'receiver-0',
          'urn:x-cast:com.google.cast.tp.connection',
          'JSON'
        );
        this.receiverChannel = this.client.createChannel(
          'sender-0',
          'receiver-0',
          'urn:x-cast:com.google.cast.receiver',
          'JSON'
        );
        this.heartbeat = this.client.createChannel(
          'sender-0',
          'receiver-0',
          'urn:x-cast:com.google.cast.tp.heartbeat',
          'JSON'
        );

        this.connectionChannel.send({ type: 'CONNECT' });
        this.heartbeatInterval = setInterval(() => {
          try {
            this.heartbeat.send({ type: 'PING' });
          } catch (error) {
            this.emit('error', error);
          }
        }, 5000);

        this.receiverChannel.on('message', (data) => this.handleReceiverMessage(data));
        this.receiverChannel.send({ type: 'GET_STATUS', requestId: this.requestId++ });
        this.castStatus = 'connected';
        this.emit('status', this.castStatus);
        resolve();
      });
    });
  }

  handleReceiverMessage(message) {
    if (!message || !message.type) return;
    console.log('[Chromecast] receiver message', JSON.stringify(message));
    if (message.type === 'RECEIVER_STATUS') {
      this.processReceiverStatus(message.status);
    } else if (message.type === 'LAUNCH_ERROR') {
      console.error('[Chromecast] launch error', message.reason);
      if (this.pendingLaunch && this.pendingLaunch.reject) {
        clearTimeout(this.pendingLaunch.timer);
        this.pendingLaunch.reject(new Error(message.reason || 'Chromecast launch error'));
        this.pendingLaunch = null;
      }
    }
  }

  processReceiverStatus(status) {
    if (!status || !status.applications) {
      this.resetApplicationState();
      return;
    }
    const app = status.applications.find((entry) => entry.appId === this.appId);
    if (!app) {
      this.resetApplicationState();
      if (this.pendingLaunch && this.pendingLaunch.reject) {
        clearTimeout(this.pendingLaunch.timer);
        this.pendingLaunch.reject(new Error('Receiver app not running'));
        this.pendingLaunch = null;
      }
      return;
    }

    if (app.transportId !== this.transportId) {
      this.transportId = app.transportId;
      this.bindApplicationChannels();
    }

    if (this.pendingLaunch && this.pendingLaunch.resolve) {
      clearTimeout(this.pendingLaunch.timer);
      this.pendingLaunch.resolve();
      this.pendingLaunch = null;
    }
  }

  bindApplicationChannels() {
    if (!this.client || !this.transportId) return;
    this.appConnection = this.client.createChannel(
      'sender-0',
      this.transportId,
      'urn:x-cast:com.google.cast.tp.connection',
      'JSON'
    );
    this.appConnection.send({ type: 'CONNECT' });

    this.customChannel = this.client.createChannel('sender-0', this.transportId, this.namespace, 'JSON');
    this.customChannel.on('message', (data) => this.emit('message', data));
    this.castStatus = 'app-ready';
    this.emit('status', this.castStatus);
    this.flushLastMessage();
  }

  flushLastMessage() {
    if (!this.customChannel || !this.lastMessage) return;
    try {
      this.customChannel.send(this.lastMessage);
    } catch (error) {
      this.handleTransportError(error);
    }
  }

  sanitizeMessage(type, payload) {
    if (!payload) {
      return { type, payload: {} };
    }
    const clone = JSON.parse(JSON.stringify(payload));
    let trimmed = false;

    // Check initial size
    let sanitized = { type, payload: clone };
    let size = Buffer.byteLength(JSON.stringify(sanitized));
    
    // If under limit, return as-is
    if (size <= MAX_MESSAGE_BYTES) {
      return sanitized;
    }
    
    console.log('[Chromecast] Payload too large:', size, 'bytes, trimming...');

    // Step 1: Collapse three_line to just line1
    if (clone.now_playing) {
      clone.now_playing = { ...clone.now_playing };
      if (clone.now_playing.three_line) {
        clone.now_playing.three_line = { line1: clone.now_playing.three_line.line1 || '' };
        trimmed = true;
      }
      if (clone.now_playing.two_line) {
        clone.now_playing.two_line = {
          line1: clone.now_playing.two_line.line1 || '',
          line2: clone.now_playing.two_line.line2 || '',
        };
        trimmed = true;
      }
    }

    sanitized = { type, payload: clone };
    size = Buffer.byteLength(JSON.stringify(sanitized));
    if (size <= MAX_MESSAGE_BYTES) {
      console.log('[Chromecast] collapsed metadata, payload now', size, 'bytes');
      return sanitized;
    }

    // Step 3: Remove text metadata
    if (clone.now_playing) {
      delete clone.now_playing.two_line;
      delete clone.now_playing.three_line;
      sanitized = { type, payload: clone };
      size = Buffer.byteLength(JSON.stringify(sanitized));
      if (size <= MAX_MESSAGE_BYTES) {
        console.log('[Chromecast] removed metadata, payload bytes', size);
        return sanitized;
      }
    }
    
    // Step 4: Trim artist images to 2 (only if we still need to)
    if (Array.isArray(clone.artist_images) && clone.artist_images.length > 2) {
      console.log('[Chromecast] Trimming artist_images from', clone.artist_images.length, 'to 2');
      clone.artist_images = clone.artist_images.slice(0, 2);
      trimmed = true;
    }
    
    sanitized = { type, payload: clone };
    size = Buffer.byteLength(JSON.stringify(sanitized));
    if (size <= MAX_MESSAGE_BYTES) {
      console.log('[Chromecast] trimmed artist_images, payload now', size, 'bytes');
      return sanitized;
    }

    // Step 5: Remove all artist images if still too large
    if (clone.artist_images && clone.artist_images.length) {
      console.log('[Chromecast] Removing all artist_images');
      clone.artist_images = [];
      trimmed = true;
    }

    sanitized = { type, payload: clone };
    size = Buffer.byteLength(JSON.stringify(sanitized));
    if (size <= MAX_MESSAGE_BYTES) {
      console.log('[Chromecast] removed all artist_images, payload now', size, 'bytes');
      return sanitized;
    }
    
    // Step 6: Last resort - remove inline album art
    if (clone.image_data) {
      delete clone.image_data;
      sanitized = { type, payload: clone };
      size = Buffer.byteLength(JSON.stringify(sanitized));
      console.warn('[Chromecast] removed image_data as last resort, payload bytes', size);
      return sanitized;
    }

    console.warn('[Chromecast] payload remains large after trimming, bytes', size);
    return sanitized;
  }

  async ensureLaunched(customData = {}) {
    await this.connect();
    if (this.transportId && this.customChannel) return;
    if (!this.receiverChannel) throw new Error('Receiver channel not established');

    if (this.pendingLaunch) return this.pendingLaunch.promise;

    this.pendingLaunch = {};
    this.pendingLaunch.promise = new Promise((resolve, reject) => {
      this.pendingLaunch.resolve = resolve;
      this.pendingLaunch.reject = reject;
      this.receiverChannel.send({
        type: 'LAUNCH',
        appId: this.appId,
        requestId: this.requestId++,
      });
      this.pendingLaunch.timer = setTimeout(() => {
        if (this.pendingLaunch && this.pendingLaunch.reject) {
          this.pendingLaunch.reject(new Error('Chromecast launch timeout'));
          this.pendingLaunch = null;
        }
      }, 10000);
    });

    return this.pendingLaunch.promise;
  }

  async sendNowPlaying(payload) {
    if (!this.selectedDeviceId || !payload) return;
    
    // Cancel any pending stop timer - we have new track data
    if (this.stopCastTimer) {
      console.log('[Chromecast] canceling pending stop, received now-playing data');
      clearTimeout(this.stopCastTimer);
      this.stopCastTimer = null;
    }
    
    // Skip if state is explicitly stopped/paused with no playing intent
    if (payload.state && payload.state !== 'playing' && payload.state !== 'loading' && payload.state !== 'stopped') {
      console.log('[Chromecast] skip NOW_PLAYING while state', payload.state);
      return;
    }
    
    const sanitized = this.sanitizeMessage('NOW_PLAYING', payload);
    if (!sanitized) return;
    this.lastMessage = sanitized;
    try {
      await this.ensureLaunched();
      if (!this.customChannel) throw new Error('Custom channel unavailable');
      this.customChannel.send(this.lastMessage);
    } catch (error) {
      this.handleTransportError(error);
    }
  }

  async sendState(payload) {
    if (!this.selectedDeviceId || !payload) return;
    const state = payload.state;
    const isPlaying = state === 'playing';
    const isTransitioning = state === 'loading' || !state;
    
    // Cancel any pending stop if we're playing or transitioning
    if ((isPlaying || isTransitioning) && this.stopCastTimer) {
      console.log('[Chromecast] canceling pending stop, state is', state);
      clearTimeout(this.stopCastTimer);
      this.stopCastTimer = null;
    }
    
    // Only debounce stop for explicit pause/stopped states
    // Skip stop for "loading" (track changes) or undefined states
    if (!isPlaying && !isTransitioning) {
      if (this.stopCastTimer) {
        return; // Already scheduled
      }
      console.log('[Chromecast] scheduling stop in 2 seconds due to state', state);
      this.stopCastTimer = setTimeout(async () => {
        this.stopCastTimer = null;
        console.log('[Chromecast] executing delayed stop');
        await this.stopCasting();
        this.lastMessage = null;
      }, 2000);
      return;
    }
    
    const sanitized = this.sanitizeMessage('STATE', payload);
    if (!sanitized) return;
    this.lastMessage = sanitized;
    
    try {
      await this.ensureLaunched();
      if (!this.customChannel) throw new Error('Custom channel unavailable');
      this.customChannel.send(sanitized);
    } catch (error) {
      this.handleTransportError(error);
    }
  }

  async stopCasting() {
    // Send PAUSE message to receiver first
    if (this.customChannel) {
      try {
        console.log('[Chromecast] sending PAUSE to receiver');
        this.customChannel.send({ type: 'PAUSE' });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn('[Chromecast] pause message error', error.message || error);
      }
    }
    
    if (this.receiverChannel) {
      try {
        console.log('[Chromecast] sending STOP to receiver');
        this.receiverChannel.send({
          type: 'STOP',
          appId: this.appId,
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.warn('[Chromecast] stop cast error', error.message || error);
      }
    }
    
    // Close the app connection
    if (this.appConnection) {
      try {
        this.appConnection.send({ type: 'CLOSE' });
      } catch (error) {
        // ignore
      }
    }
    
    this.customChannel = null;
    this.transportId = null;
    this.appConnection = null;
    this.lastMessage = null;
    this.castStatus = this.selectedDeviceId ? 'connected' : 'idle';
    this.emit('status', this.castStatus);
  }

  disconnect() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.client) {
      try {
        this.client.close();
      } catch (error) {
        // ignore
      }
    }
    if (this.pendingLaunch) {
      clearTimeout(this.pendingLaunch.timer);
      this.pendingLaunch = null;
    }
    this.client = null;
    this.connectionChannel = null;
    this.receiverChannel = null;
    this.customChannel = null;
    this.transportId = null;
    this.castStatus = this.selectedDeviceId ? 'disconnected' : 'idle';
    this.emit('status', this.castStatus);
  }

  getSnapshot() {
    return {
      devices: this.getDevices(),
      selectedDeviceId: this.selectedDeviceId,
      castStatus: this.castStatus,
      receiverUrl: this.receiverUrl,
    };
  }

  handleTransportError(error) {
    const message = error?.message || String(error);
    this.emit('error', message);

    if (/Receiver channel not established|Custom channel unavailable/i.test(message)) {
      this.resetApplicationState();
      this.disconnect();
      if (this.selectedDeviceId) {
        setTimeout(() => {
          this.connect()
            .then(() => this.ensureLaunched().catch((launchErr) => this.emit('error', launchErr)))
            .catch((connectErr) => this.emit('error', connectErr));
        }, 1000);
      }
      return;
    }

    if (error && (error.code === 'EPIPE' || /EPIPE/i.test(String(error)))) {
      this.disconnect();
      if (this.selectedDeviceId) {
        setTimeout(() => {
          this.connect().catch((err) => this.emit('error', err));
        }, 2000);
      }
    }
  }
}

module.exports = ChromecastService;

