const os = require('os');

function getLocalAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const candidates = interfaces[name] || [];
    for (const details of candidates) {
      if (!details || details.family !== 'IPv4' || details.internal) {
        continue;
      }
      return details.address;
    }
  }
  return 'localhost';
}

module.exports = {
  getLocalAddress,
};

