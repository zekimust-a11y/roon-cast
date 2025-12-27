require('dotenv').config();

const { getLocalAddress } = require('./utils/network');

const port = Number(process.env.PORT) || 8080;
const publicHost = process.env.PUBLIC_HOST || getLocalAddress();
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${publicHost}:${port}`;

const config = {
  port,
  castAppId: process.env.CAST_APP_ID || '180705D2',
  castNamespace: process.env.CAST_NAMESPACE || 'urn:x-cast:com.zeki.rooncast',
  receiverUrl: process.env.DEFAULT_RECEIVER_URL || 'https://zekimust-a11y.github.io/roon-cast/',
  publicBaseUrl,
};

module.exports = config;
