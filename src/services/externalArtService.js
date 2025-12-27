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

// Known placeholder image patterns to filter out
const PLACEHOLDER_PATTERNS = [
  /artist\/default-/i,     // Deezer default artist image
  /artist\/000000/i,       // Deezer placeholder
  /artwork\/default/i,     // Generic artwork placeholder
  /no-artwork/i,           // No artwork available
  /placeholder/i,          // Generic placeholder
  /avatar-default/i,       // Default avatar
  /user-default/i,         // Default user image
  /audiodefault\.png/i,    // iTunes audio default
  /MusicDefault\.png/i,    // iTunes music default
];

// Common iTunes placeholder image hashes (these appear in URLs)
const ITUNES_PLACEHOLDER_HASHES = [
  'bb7f14996b4e42ffbb76ea0e97c971de', // Known iTunes placeholder hash
  '0/0/0/0/', // Empty artwork path pattern
];

function isPlaceholderImage(url) {
  if (!url) return true;
  
  // Check for known placeholder patterns
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(url)) {
      console.log('[ExternalArt] Filtered placeholder pattern:', url.substring(0, 80));
      return true;
    }
  }
  
  // Check for iTunes placeholder hashes
  for (const hash of ITUNES_PLACEHOLDER_HASHES) {
    if (url.includes(hash)) {
      console.log('[ExternalArt] Filtered iTunes placeholder hash:', url.substring(0, 80));
      return true;
    }
  }
  
  // Check if URL is too generic/short (likely a placeholder)
  if (url.length < 50) {
    console.log('[ExternalArt] Filtered short URL (likely placeholder):', url);
    return true;
  }
  
  return false;
}

async function fetchDeezerImages(artistName, limit = 4) {
  if (!artistName) return [];
  const url = `${DEEZER_ENDPOINT}?q=${encodeURIComponent(artistName)}&limit=${limit}`;
  try {
    console.log('[ExternalArt] Fetching from Deezer for artist:', artistName);
    const payload = await fetchJSON(url);
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    const images = entries
      .map((entry) => entry.picture_xl || entry.picture_big || entry.picture_medium || entry.picture)
      .filter(Boolean)
      .filter(url => !isPlaceholderImage(url)); // Filter out placeholders
    console.log('[ExternalArt] Deezer returned', images.length, 'images (after filtering placeholders)');
    return images;
  } catch (error) {
    console.warn('[ExternalArt] Deezer lookup failed', error.message);
    return [];
  }
}

async function fetchItunesImages(artistName, limit = 6) {
  if (!artistName) return [];
  const url = `${ITUNES_ENDPOINT}?term=${encodeURIComponent(artistName)}&entity=musicTrack&limit=${limit}`;
  try {
    console.log('[ExternalArt] Fetching from iTunes for artist:', artistName);
    const payload = await fetchJSON(url);
    const entries = Array.isArray(payload?.results) ? payload.results : [];
    const images = entries
      .map((entry) => entry.artworkUrl100 || entry.artworkUrl60)
      .filter(Boolean)
      .map((urlStr) => urlStr.replace(/100x100|60x60/gi, '1000x1000'))
      .filter(url => !isPlaceholderImage(url)); // Filter out placeholders
    console.log('[ExternalArt] iTunes returned', images.length, 'images (after filtering placeholders)');
    return images;
  } catch (error) {
    console.warn('[ExternalArt] iTunes lookup failed', error.message);
    return [];
  }
}

async function fetchAdditionalArtistImages(artistName, desired = 2) {
  if (!artistName || desired <= 0) {
    console.log('[ExternalArt] fetchAdditionalArtistImages: No artist name or desired <= 0');
    return [];
  }
  
  console.log('[ExternalArt] fetchAdditionalArtistImages: Fetching', desired, 'images for:', artistName);
  
  const unique = new Set();
  const results = [];
  const add = (url) => {
    if (!url || typeof url !== 'string') return;
    if (!/^https?:\/\//i.test(url)) return;
    if (unique.has(url)) return;
    unique.add(url);
    results.push(url);
  };

  // Try the full artist name first
  const [deezerList, itunesList] = await Promise.all([
    fetchDeezerImages(artistName, desired * 3),
    fetchItunesImages(artistName, desired * 4),
  ]);

  deezerList.forEach(add);
  itunesList.forEach(add);

  // If we got enough results, return them
  if (results.length >= desired) {
    const final = results.slice(0, desired);
    console.log('[ExternalArt] fetchAdditionalArtistImages: Returning', final.length, 'unique images');
    return final;
  }

  // Otherwise, try splitting on common separators and search for individual artists
  console.log('[ExternalArt] Not enough results, trying individual artists...');
  const separators = /[,/&;]/;
  if (separators.test(artistName)) {
    const individualArtists = artistName.split(separators).map(a => a.trim()).filter(Boolean);
    console.log('[ExternalArt] Found', individualArtists.length, 'individual artists:', individualArtists);
    
    // Try each artist, but limit to first 2 to avoid too many requests
    for (const artist of individualArtists.slice(0, 2)) {
      if (results.length >= desired) break;
      
      const [deezerExtra, itunesExtra] = await Promise.all([
        fetchDeezerImages(artist, 3),
        fetchItunesImages(artist, 4),
      ]);
      
      deezerExtra.forEach(add);
      itunesExtra.forEach(add);
    }
  }

  const final = results.slice(0, desired);
  console.log('[ExternalArt] fetchAdditionalArtistImages: Returning', final.length, 'unique images');
  return final;
}

module.exports = {
  fetchAdditionalArtistImages,
};

