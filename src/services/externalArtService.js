const fetch = require('node-fetch');

const DEEZER_ENDPOINT = 'https://api.deezer.com/search/artist';
const ITUNES_ENDPOINT = 'https://itunes.apple.com/search';
const REQUEST_TIMEOUT_MS = 5000;

async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDeezerImages(artistName, limit = 4) {
  if (!artistName) return [];
  const url = `${DEEZER_ENDPOINT}?q=${encodeURIComponent(artistName)}&limit=${limit}`;
  try {
    const payload = await fetchJSON(url);
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    return entries
      .map((entry) => entry.picture_xl || entry.picture_big || entry.picture_medium || entry.picture)
      .filter(Boolean);
  } catch (error) {
    console.warn('[ExternalArt] Deezer lookup failed', error.message);
    return [];
  }
}

async function fetchItunesImages(artistName, limit = 6) {
  if (!artistName) return [];
  const url = `${ITUNES_ENDPOINT}?term=${encodeURIComponent(artistName)}&entity=musicTrack&limit=${limit}`;
  try {
    const payload = await fetchJSON(url);
    const entries = Array.isArray(payload?.results) ? payload.results : [];
    return entries
      .map((entry) => entry.artworkUrl100 || entry.artworkUrl60)
      .filter(Boolean)
      .map((urlStr) => urlStr.replace(/100x100|60x60/gi, '1000x1000'));
  } catch (error) {
    console.warn('[ExternalArt] iTunes lookup failed', error.message);
    return [];
  }
}

async function fetchAdditionalArtistImages(artistName, desired = 2) {
  if (!artistName || desired <= 0) {
    return [];
  }
  const unique = new Set();
  const results = [];
  const add = (url) => {
    if (!url || typeof url !== 'string') return;
    if (!/^https?:\/\//i.test(url)) return;
    if (unique.has(url)) return;
    unique.add(url);
    results.push(url);
  };

  const [deezerList, itunesList] = await Promise.all([
    fetchDeezerImages(artistName, desired * 2),
    fetchItunesImages(artistName, desired * 3),
  ]);

  deezerList.forEach(add);
  itunesList.forEach(add);

  return results.slice(0, desired);
}

module.exports = {
  fetchAdditionalArtistImages,
};

