const EventEmitter = require('events');
const RoonApi = require('node-roon-api');
const RoonApiStatus = require('node-roon-api-status');
const RoonApiTransport = require('node-roon-api-transport');
const RoonApiBrowse = require('node-roon-api-browse');
const RoonApiImage = require('node-roon-api-image');
const imageStore = require('./imageStore');
const externalArtService = require('./externalArtService');
const { loadConfig, saveConfig } = require('../utils/config');

const ROON_EXTENSION_ID = 'com.zeki.rooncast';
const ROON_DISPLAY_NAME = 'Roon Chromecast Bridge';
const ROON_VERSION = '1.0.0';

class RoonService extends EventEmitter {
  constructor() {
    super();
    this.roon = null;
    this.transport = null;
    this.statusSvc = null;
    this.browseSvc = null;
    this.imageSvc = null;

    this.cores = new Map();
    this.activeCoreId = null;
    this.selectedZoneId = null;
    this.zones = new Map();
    this.nowPlaying = null;
    this.currentState = 'stopped';
    this.inlineImageCache = new Map();
    this.coreReconnectTimer = null;
    this.isCoreReconnectPending = false;
    this.lastTransportState = 'idle';
    this.config = loadConfig();
  }

  start() {
    this.roon = new RoonApi({
      extension_id: ROON_EXTENSION_ID,
      display_name: ROON_DISPLAY_NAME,
      display_version: ROON_VERSION,
      publisher: 'zeki',
      email: 'zekimust@gmail.com',
      website: 'https://zekimust-a11y.github.io/roon-cast',
      log_level: 'none',
      core_paired: (core) => this.handleCorePaired(core),
      core_unpaired: (core) => this.handleCoreUnpaired(core),
    });

    this.statusSvc = new RoonApiStatus(this.roon);

    this.browseSvc = new RoonApiBrowse(this.roon);

    this.roon.init_services({
      required_services: [RoonApiTransport, RoonApiImage],
      optional_services: [RoonApiBrowse],
      provided_services: [this.statusSvc],
    });

    this.statusSvc.set_status('Waiting for Roon Core authorization', false);
    this.roon.start_discovery();
  }

  handleCorePaired(core) {
    console.log('[RoonService] Core paired', core.core_id, core.display_name);
    if (this.coreReconnectTimer) {
      clearTimeout(this.coreReconnectTimer);
      this.coreReconnectTimer = null;
    }
    this.isCoreReconnectPending = false;
    const existing = this.cores.get(core.core_id) || {};
    this.cores.set(core.core_id, {
      id: core.core_id,
      display_name: core.display_name,
      display_version: core.display_version,
      core,
      available: true,
    });
    if (!this.activeCoreId) {
      this.setActiveCore(core.core_id);
    } else {
      this.emitState();
    }
  }

  handleCoreUnpaired(core) {
    console.warn('[RoonService] Core unpaired', core.core_id, core.display_name);
    const existing = this.cores.get(core.core_id);
    if (existing) {
      existing.available = false;
      existing.core = null;
      this.cores.set(core.core_id, existing);
    }
    if (this.activeCoreId === core.core_id) {
      this.scheduleReconnectCleanup();
      this.activeCoreId = null;
      this.transport = null;
      this.statusSvc.set_status('Lost connection to Roon Core', true);
    }
    this.emitState();
    this.emit('core-unavailable');
  }

  scheduleReconnectCleanup() {
    this.isCoreReconnectPending = true;
    if (this.coreReconnectTimer) return;
    this.coreReconnectTimer = setTimeout(() => {
      this.coreReconnectTimer = null;
      if (!this.activeCoreId) {
        this.isCoreReconnectPending = false;
        this.cleanupSubscriptions();
        this.emitState();
      }
    }, 5000);
  }

  setActiveCore(coreId) {
    const entry = this.cores.get(coreId);
    if (!entry || !entry.core) return false;
    console.log('[RoonService] Activating core', entry.display_name, coreId);
    this.cleanupSubscriptions();
    this.activeCoreId = coreId;
    this.transport = entry.core.services.RoonApiTransport;
    this.imageSvc = entry.core.services.RoonApiImage;
    this.statusSvc.set_status(`Connected to core: ${entry.display_name}`, false);
    this.subscribeZones();
    this.emitState();
    return true;
  }

  cleanupSubscriptions() {
    if (this.zoneSubscription && this.zoneSubscription.cancel) {
      try {
        this.zoneSubscription.cancel();
      } catch (err) {
        // ignore cleanup errors
      }
    }
    this.zoneSubscription = null;
    this.zones.clear();
    this.currentState = 'stopped';
    this.nowPlaying = null;
    this.imageSvc = null;
    this.inlineImageCache.clear();
    console.log('[RoonService] Subscriptions cleared');
  }

  subscribeZones() {
    if (!this.transport) return;
    this.zoneSubscription = this.transport.subscribe_zones((response, data) => {
      if (response === 'Subscribed') {
        data.zones.forEach((zone) => {
          this.zones.set(zone.zone_id, zone);
        });
      } else if (response === 'Changed') {
        if (data.zones_removed) {
          data.zones_removed.forEach((zoneId) => this.zones.delete(zoneId));
        }
        if (data.zones_added) {
          data.zones_added.forEach((zone) => this.zones.set(zone.zone_id, zone));
        }
        if (data.zones_changed) {
          data.zones_changed.forEach((zone) => this.zones.set(zone.zone_id, zone));
        }
        if (data.zones_seek_changed) {
          data.zones_seek_changed.forEach((update) => {
            const zone = this.zones.get(update.zone_id);
            if (zone && zone.now_playing) {
              zone.now_playing.seek_position = update.seek_position;
              zone.queue_time_remaining = update.queue_time_remaining;
            }
          });
        }
      } else if (response === 'Unsubscribed') {
        this.zones.clear();
      }

      if (response !== 'Unsubscribed') {
        this.evaluatePlaybackState();
      }
      this.emitState();
    });
  }

  setSelectedZone(zoneId) {
    if (!zoneId) return;
    const zone = this.zones.get(zoneId);
    if (!zone) return;
    this.selectedZoneId = zoneId;
    this.config.selectedZoneId = zoneId;
    saveConfig(this.config);
    this.emitState();
    this.evaluatePlaybackState();
  }

  evaluatePlaybackState() {
    if (!this.selectedZoneId) {
      this.nowPlaying = null;
      this.currentState = 'idle';
      return;
    }
    const zone = this.zones.get(this.selectedZoneId);
    if (!zone) {
      this.nowPlaying = null;
      this.currentState = 'idle';
      return;
    }
    const newState = zone.state;
    const nowPlaying = zone.now_playing || null;
    const seekPosition = nowPlaying ? nowPlaying.seek_position : 0;

    const primaryOutput = Array.isArray(zone.outputs) && zone.outputs.length > 0 ? zone.outputs[0] : null;
    const payload = {
      zone_id: zone.zone_id,
      zone_name: zone.display_name,
      core_name: this.cores.get(this.activeCoreId)?.display_name || 'Unknown Core',
      state: newState,
      seek_position: seekPosition,
      now_playing: nowPlaying,
      output: primaryOutput
        ? {
            output_id: primaryOutput.output_id,
            display_name: primaryOutput.display_name,
            volume: primaryOutput.volume || null,
            source_controls: primaryOutput.source_controls || [],
          }
        : null,
    };

    const previousPayload = this.nowPlaying;
    const stateChanged = newState !== this.currentState;
    let trackChanged = false;
    if (nowPlaying && !previousPayload) {
      trackChanged = true;
    } else if (nowPlaying && previousPayload && previousPayload.now_playing) {
      const prevLines = previousPayload.now_playing.three_line || {};
      const currentLines = nowPlaying.three_line || {};
      trackChanged =
        prevLines.line1 !== currentLines.line1 ||
        prevLines.line2 !== currentLines.line2 ||
        prevLines.line3 !== currentLines.line3 ||
        previousPayload.seek_position !== seekPosition;
    } else if (!nowPlaying && previousPayload && previousPayload.now_playing) {
      trackChanged = true;
    }

    const finalizePayload = (enhancedPayload) => {
      this.nowPlaying = enhancedPayload;
      this.currentState = newState;
      this.lastTransportState = newState;
      if (stateChanged) {
        this.emit('playback-state', this.currentState, enhancedPayload);
      }
      if (trackChanged || stateChanged) {
        this.emit('now-playing', enhancedPayload);
      }
    };

    if (trackChanged && nowPlaying) {
      console.log('[RoonService] Track changed. now_playing fields:', {
        artist: nowPlaying.artist || 'N/A',
        composer: nowPlaying.composer || 'N/A',
        artist_image_keys: (nowPlaying.artist_image_keys || []).length,
        line2: nowPlaying.two_line?.line2 || nowPlaying.three_line?.line2 || 'N/A'
      });
      
      const inlinePromise = this.getInlineImage(nowPlaying.image_key).catch(() => null);
      const hostedAlbumPromise = this.getHostedImage(nowPlaying.image_key).catch(() => null);
      const artistPromise = this.getArtistImages(nowPlaying.artist_image_keys || []).catch(() => []);

      Promise.all([inlinePromise, hostedAlbumPromise, artistPromise])
        .then(([inlineArt, hostedAlbumImage, artistImages]) => {
          // Send immediately with Roon images for fast display
          const quickPayload = {
            ...payload,
            image_data: inlineArt,
            image_url: hostedAlbumImage,
            artist_images: artistImages,
          };
          finalizePayload(quickPayload);
          
          // Then enrich with external images in background (non-blocking)
          if (artistImages && artistImages.length < 4) {
            this.enrichArtistImages(nowPlaying, artistImages)
              .then((finalArtistImages) => {
                if (finalArtistImages.length > artistImages.length) {
                  console.log('[RoonService] Sending enriched artist images update');
                  finalizePayload({
                    ...payload,
                    image_data: inlineArt,
                    image_url: hostedAlbumImage,
                    artist_images: finalArtistImages,
                  });
                }
              })
              .catch((err) => console.warn('[RoonService] background enrichment failed', err.message));
          }
        })
        .catch(() => finalizePayload(payload));
    } else {
      finalizePayload(payload);
    }
  }

  getSnapshot() {
    return {
      cores: Array.from(this.cores.values()).map((core) => ({
        id: core.id,
        name: core.display_name,
        version: core.display_version,
        isActive: core.id === this.activeCoreId,
        available: core.available !== false,
      })),
      activeCoreId: this.activeCoreId,
      zones: Array.from(this.zones.values()),
      selectedZoneId: this.selectedZoneId,
      nowPlaying: this.nowPlaying,
      reconnecting: this.isCoreReconnectPending,
      lastTransportState: this.lastTransportState,
    };
  }

  emitState() {
    this.emit('update', this.getSnapshot());
  }

  getHostedImage(
    imageKey,
    options = { scale: 'fit', width: 640, height: 640, format: 'image/jpeg' }
  ) {
    if (!imageKey || !this.imageSvc) {
      return Promise.reject(new Error('Image service unavailable'));
    }
    const cacheKey = this.buildImageCacheKey(imageKey, options);
    const cached = imageStore.getByCacheKey(cacheKey);
    if (cached) {
      return Promise.resolve(cached.url);
    }
    return new Promise((resolve, reject) => {
      this.imageSvc.get_image(imageKey, options, (err, contentType, body) => {
        if (err || !body) {
          reject(new Error(err || 'Image fetch failed'));
          return;
        }
        try {
          const record = imageStore.save(cacheKey, body, contentType || 'image/jpeg');
          resolve(record.url);
        } catch (storeError) {
          reject(storeError);
        }
      });
    });
  }

  getInlineImage(
    imageKey,
    options = { scale: 'fit', width: 256, height: 256, format: 'image/jpeg' }
  ) {
    if (!imageKey || !this.imageSvc) {
      return Promise.reject(new Error('Image service unavailable'));
    }
    const cacheKey = `${imageKey}:${options.width}x${options.height}:${options.scale}:inline`;
    if (this.inlineImageCache.has(cacheKey)) {
      return Promise.resolve(this.inlineImageCache.get(cacheKey));
    }
    return new Promise((resolve, reject) => {
      this.imageSvc.get_image(imageKey, options, (err, contentType, body) => {
        if (err || !body) {
          reject(new Error(err || 'Image fetch failed'));
          return;
        }
        const dataUrl = `data:${contentType};base64,${body.toString('base64')}`;
        this.inlineImageCache.set(cacheKey, dataUrl);
        resolve(dataUrl);
      });
    });
  }

  getArtistImages(imageKeys = []) {
    if (!Array.isArray(imageKeys) || imageKeys.length === 0 || !this.imageSvc) {
      return Promise.resolve([]);
    }
    const uniqueKeys = [...new Set(imageKeys.filter(Boolean))].slice(0, 4);
    if (uniqueKeys.length === 0) {
      return Promise.resolve([]);
    }
    const requests = uniqueKeys.map((key) =>
      this.getHostedImage(key, {
        scale: 'fill',
        width: 1920,
        height: 1080,
        format: 'image/jpeg',
      }).catch(() => null)
    );
    return Promise.all(requests).then((images) => images.filter(Boolean));
  }

  buildImageCacheKey(imageKey, options = {}) {
    const width = options.width || 0;
    const height = options.height || 0;
    const scale = options.scale || 'fit';
    return `${imageKey}:${width}x${height}:${scale}`;
  }

  async enrichArtistImages(nowPlaying, existingImages = []) {
    const MAX_ARTIST_IMAGES = 4;
    const finalImages = Array.isArray(existingImages) ? [...existingImages] : [];
    const trimmed = finalImages.filter(Boolean).slice(0, MAX_ARTIST_IMAGES);
    
    console.log('[RoonService] enrichArtistImages: Roon provided', trimmed.length, 'artist images');
    
    if (trimmed.length >= MAX_ARTIST_IMAGES) {
      console.log('[RoonService] enrichArtistImages: Already have', MAX_ARTIST_IMAGES, 'images, no external fetch needed');
      return trimmed;
    }
    
    const artistName = this.extractArtistName(nowPlaying);
    if (!artistName) {
      console.log('[RoonService] enrichArtistImages: No artist name found');
      return trimmed;
    }
    
    console.log('[RoonService] enrichArtistImages: Fetching external images for artist:', artistName);
    
    const needed = Math.max(0, MAX_ARTIST_IMAGES - trimmed.length);
    if (needed === 0) {
      return trimmed;
    }
    
    try {
      const supplemental = await externalArtService.fetchAdditionalArtistImages(artistName, Math.max(2, needed));
      console.log('[RoonService] enrichArtistImages: External services provided', supplemental.length, 'images');
      
      const merged = [...trimmed];
      supplemental.forEach((url) => {
        if (!url) return;
        if (merged.includes(url)) return;
        merged.push(url);
      });
      
      const result = merged.slice(0, MAX_ARTIST_IMAGES);
      console.log('[RoonService] enrichArtistImages: Final count:', result.length, 'images');
      return result;
    } catch (err) {
      console.error('[RoonService] enrichArtistImages: External fetch failed:', err.message);
      return trimmed;
    }
  }

  extractArtistName(nowPlaying) {
    if (!nowPlaying) return null;
    
    // Priority: prefer explicit artist field over line2 (which might include composer)
    let artistName = 
      nowPlaying.artist ||
      nowPlaying.three_line?.line2 ||
      nowPlaying.two_line?.line2 ||
      nowPlaying.one_line?.line2 ||
      null;
    
    if (!artistName) {
      console.log('[RoonService] extractArtistName: No artist found');
      return null;
    }
    
    // If multiple artists are separated by slashes, take only the first one (primary artist)
    if (artistName.includes(' / ')) {
      const primaryArtist = artistName.split(' / ')[0].trim();
      console.log('[RoonService] extractArtistName: Multiple artists found, using primary:', primaryArtist, '(full:', artistName + ')');
      return primaryArtist;
    }
    
    console.log('[RoonService] extractArtistName:', artistName);
    return artistName;
  }
}

module.exports = RoonService;

