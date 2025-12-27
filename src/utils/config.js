const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('[Config] Failed to load config:', error.message);
  }
  return {
    selectedZoneId: null,
    selectedChromecastId: null,
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('[Config] Saved configuration');
  } catch (error) {
    console.error('[Config] Failed to save config:', error.message);
  }
}

module.exports = {
  loadConfig,
  saveConfig,
};

