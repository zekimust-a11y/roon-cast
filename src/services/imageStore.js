const { randomUUID } = require('crypto');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

class ImageStore {
  constructor() {
    this.baseUrl = null;
    this.ttlMs = DEFAULT_TTL_MS;
    this.byCacheKey = new Map();
    this.byId = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  configure({ baseUrl, ttlMs } = {}) {
    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    if (ttlMs) {
      this.ttlMs = ttlMs;
    }
  }

  ensureConfigured() {
    if (!this.baseUrl) {
      throw new Error('ImageStore base URL has not been configured.');
    }
  }

  buildUrl(id) {
    this.ensureConfigured();
    return `${this.baseUrl}/images/${id}`;
  }

  getByCacheKey(cacheKey) {
    const entry = this.byCacheKey.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.removeByCacheKey(cacheKey);
      return null;
    }
    return { id: entry.id, url: this.buildUrl(entry.id) };
  }

  save(cacheKey, buffer, contentType = 'image/jpeg', ttlMs) {
    this.ensureConfigured();
    const expiresAt = Date.now() + (ttlMs || this.ttlMs);
    let entry = this.byCacheKey.get(cacheKey);

    if (entry) {
      entry.buffer = buffer;
      entry.contentType = contentType;
      entry.expiresAt = expiresAt;
    } else {
      const id = randomUUID().replace(/-/g, '');
      entry = {
        id,
        cacheKey,
        buffer,
        contentType,
        expiresAt,
      };
      this.byCacheKey.set(cacheKey, entry);
      this.byId.set(id, entry);
    }

    return { id: entry.id, url: this.buildUrl(entry.id) };
  }

  getById(id) {
    const entry = this.byId.get(id);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.removeByCacheKey(entry.cacheKey);
      return null;
    }
    return entry;
  }

  removeByCacheKey(cacheKey) {
    const entry = this.byCacheKey.get(cacheKey);
    if (!entry) {
      return;
    }
    this.byCacheKey.delete(cacheKey);
    this.byId.delete(entry.id);
  }

  cleanup() {
    const now = Date.now();
    this.byCacheKey.forEach((entry, cacheKey) => {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.byCacheKey.delete(cacheKey);
        this.byId.delete(entry.id);
      }
    });
  }
}

module.exports = new ImageStore();

