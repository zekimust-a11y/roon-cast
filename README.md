# Roon → Chromecast Bridge

A complete solution for displaying rich "now playing" information from Roon on a Chromecast device with custom UI. Features automatic casting on playback start, persistent settings, smooth track transitions, and external artist image enrichment.

## Features

- ✅ **Automatic Casting** - Starts casting automatically when Roon playback begins
- ✅ **Smooth Track Changes** - No black screen flashes between tracks (2-second debounce)
- ✅ **Rich Metadata Display** - Album art, artist images, track info, seek position, and waveform visualization
- ✅ **Artist Image Cycling** - Rotates through artist images every 20 seconds with smooth crossfade
- ✅ **External Image Sources** - Fetches additional artist images from Deezer and iTunes if needed
- ✅ **Persistent Settings** - Zone and Chromecast selections save automatically and restore on restart
- ✅ **Stable Connection** - Fixed Roon core flapping issues with proper reconnection handling
- ✅ **Pause Handling** - Automatically stops casting after 2 seconds of pause (track changes don't trigger stop)
- ✅ **Image Optimization** - Serves images via local HTTP to avoid Chromecast payload limits
- ✅ **Custom Receiver UI** - Beautiful full-screen display with blurred backgrounds and animated waveforms

## Prerequisites

- **Node.js 18+**
- **Roon Core** on the same network (tested with v2.57 build 1598)
- **Chromecast device** on the same network
- **Google Cast Developer Account** with app ID `180705D2` registered
- **GitHub Pages** hosting for receiver app at `https://zekimust-a11y.github.io/roon-cast/`

## Installation

```bash
# Clone or extract to your desired location
cd "/Users/zeki/My Drive (zekimust@gmail.com)/Personal/APPS/Chromecast"

# Install dependencies
npm install

# Start the bridge
npm run start
```

The server will start on `http://localhost:8080` and automatically:
- Discover the Roon Core on your network
- Scan for Chromecast devices via mDNS
- Register as a Roon extension

## Initial Setup

### 1. Authorize in Roon

1. Open **Roon → Settings → Extensions**
2. Find **"Roon Chromecast Bridge"** in the list
3. Click **Enable** to authorize the extension
4. The extension should show as "Connected" with a green indicator

### 2. Configure via Web Interface

1. Open `http://localhost:8080` in your browser
2. Select your **Roon Core** from the dropdown
3. Select your **Zone** (e.g., "Living Room")
4. Select your **Chromecast Device** (e.g., "Rooncast TV")

Your selections are automatically saved to `config.json` and will persist across restarts.

### 3. Start Playback

Simply press play in Roon—casting will start automatically within 1-2 seconds!

## Configuration

### Environment Variables

Create a `.env` file in the project root (or use the existing one):

```bash
# Server Configuration
PORT=8080                                           # HTTP server port
PUBLIC_HOST=192.168.1.12                            # Your local IP (auto-detected if not set)
PUBLIC_BASE_URL=http://192.168.1.12:8080           # Base URL for serving images

# Google Cast Configuration  
CAST_APP_ID=180705D2                                # Your Google Cast Application ID
CAST_NAMESPACE=urn:x-cast:com.zeki.rooncast         # Custom message namespace
DEFAULT_RECEIVER_URL=https://zekimust-a11y.github.io/roon-cast/  # Receiver app URL
```

### Persisted Settings (`config.json`)

Automatically created on first selection:

```json
{
  "selectedZoneId": "1601aa6469c85aaa8466da421549455ad448",
  "selectedChromecastId": "df214589123579a5ff04a18d922bda2e"
}
```

These IDs are saved when you make selections in the web interface and restored on startup.

## Project Structure

```
.
├── src/
│   ├── index.js                          # Main Express server + Socket.IO
│   ├── config.js                         # Configuration loader
│   ├── services/
│   │   ├── roonService.js                # Roon API integration + zone management
│   │   ├── chromecastService.js          # Chromecast discovery + casting logic
│   │   ├── imageStore.js                 # In-memory image cache with HTTP serving
│   │   └── externalArtService.js         # Deezer/iTunes artist image fetcher
│   └── utils/
│       ├── config.js                     # Config file persistence (config.json)
│       └── network.js                    # Local IP address detection
├── public/
│   ├── index.html                        # Control panel UI
│   ├── app.js                            # Control panel JavaScript
│   └── styles.css                        # Control panel styles
├── receiver/
│   └── index.html                        # Chromecast receiver app (for testing)
├── receiver-gh/                          # Receiver deployed to GitHub Pages
│   └── index.html                        # (deployed via Git to separate repo)
├── config.json                           # Persisted settings (auto-created)
├── package.json                          # Dependencies + scripts
└── README.md                             # This file
```

## Key Services

### RoonService (`src/services/roonService.js`)

- **Roon Extension Registration** - Registers as "Roon Chromecast Bridge"
- **Core Discovery & Pairing** - Finds Roon cores on the network with 1-second delayed activation
- **Zone Subscription** - Subscribes to transport changes for the selected zone
- **Now Playing Data** - Emits rich metadata including:
  - Track title, artist, album
  - Seek position and duration
  - Album artwork (256×256 inline base64 + 640×640 hosted URL)
  - Artist images (up to 4, enriched from external sources)
- **Image Management** - Fetches images from Roon API and caches them
- **External Artist Images** - Queries Deezer and iTunes if Roon provides fewer than 4 artist images
- **Reconnection Handling** - 5-second buffer for brief Roon core disconnects

### ChromecastService (`src/services/chromecastService.js`)

- **mDNS Discovery** - Scans for `_googlecast._tcp` services on the local network
- **Device Management** - Tracks discovered devices with 24-hour TTL
- **Connection Management** - Maintains TCP connection with heartbeat (5-second ping)
- **Application Launching** - Launches custom receiver app (app ID `180705D2`)
- **Message Sanitization** - Trims payloads to stay under 60KB Chromecast limit:
  1. Trim artist images to 1
  2. Collapse metadata
  3. Remove artist images entirely if needed
  4. Remove inline image data as last resort
- **Pause Debouncing** - 2-second delay before stopping cast (prevents stop during track changes)
- **State Management** - Cancels stop timer when:
  - New track data arrives
  - State changes to `playing` or `loading`
- **PAUSE Message** - Sends explicit pause command to receiver before stopping

### ImageStore (`src/services/imageStore.js`)

- **In-Memory Cache** - Stores image buffers with 1-hour TTL
- **HTTP Serving** - Serves cached images at `/images/:id` endpoint
- **Auto-Cleanup** - Removes expired images every 10 minutes
- **URL Generation** - Provides `http://192.168.1.12:8080/images/:id` URLs for Chromecast

### ExternalArtService (`src/services/externalArtService.js`)

- **Deezer API** - Fetches up to 4 artist images from `api.deezer.com`
- **iTunes API** - Fetches up to 6 artist images from `itunes.apple.com`
- **Timeout Handling** - 5-second timeout per request
- **URL Sanitization** - Upgrades HTTP to HTTPS, increases image quality parameters

## Receiver Application

The receiver is a CAF (Cast Application Framework) based HTML page that displays:

- **Full-Screen Album Art** - With fade-in animation
- **Artist Background** - Cycles through artist images every 20 seconds with smooth crossfade
- **Blurred Album Fallback** - If no artist images available, shows blurred album art as background
- **Track Information** - Title, artist, album
- **Seek Bar** - Shows playback position with animated waveform
- **Time Display** - Current time and duration (tabular nums for alignment)
- **Waveform Visualization** - Static waveform with mirrored top reflection
- **Volume Overlay** - Shows volume changes with icon and percentage (2.5-second fade-out)

### Receiver Deployment

The receiver is hosted on GitHub Pages and automatically updated via git:

```bash
cd "receiver-gh"
git add index.html
git commit -m "Update receiver"
git push origin main
```

GitHub Pages URL: `https://zekimust-a11y.github.io/roon-cast/`

### Receiver Message Protocol

The receiver listens on namespace `urn:x-cast:com.zeki.rooncast` for messages:

**NOW_PLAYING Message:**
```json
{
  "type": "NOW_PLAYING",
  "payload": {
    "state": "playing",
    "seek_position": 120,
    "now_playing": {
      "length": 240,
      "one_line": { "line1": "Track Title - Artist" },
      "two_line": { "line1": "Track Title", "line2": "Artist" },
      "three_line": { "line1": "Track Title", "line2": "Artist", "line3": "Album" },
      "image_key": "..."
    },
    "image_data": "data:image/jpeg;base64,...",        // Inline 256x256 for album art
    "image_url": "http://192.168.1.12:8080/images/...", // Hosted 640x640 for background
    "artist_images": [                                   // Up to 4 artist image URLs
      "http://192.168.1.12:8080/images/...",
      "https://e-cdns-images.dzcdn.net/images/...",
      "https://is1-ssl.mzstatic.com/image/..."
    ],
    "output": {
      "volume": { "value": -17, "is_muted": false }
    }
  }
}
```

**STATE Message:**
```json
{
  "type": "STATE",
  "payload": {
    "state": "paused",
    "seek_position": 120,
    "now_playing": { ... }
  }
}
```

**PAUSE Message:**
```json
{
  "type": "PAUSE"
}
```

## Troubleshooting

### Roon Extension Not Appearing

1. Check that Node server is running: `http://localhost:8080`
2. Check server logs for "Roon Cast bridge running"
3. Restart Roon and wait 10-15 seconds
4. Check **Roon → Settings → Extensions** again

### Chromecast Not Discovered

1. Ensure Chromecast is on the same network/subnet
2. Check mDNS/Bonjour is not blocked by firewall
3. Click **Rescan** button in web interface
4. Check server logs for `[Chromecast] registered device`

### Casting Not Starting

1. Verify zone and Chromecast are selected in web interface
2. Check that Chromecast is not already in use by another app
3. Reboot Chromecast if it's been casting for a while (cache issue)
4. Check server logs for `[Chromecast] launching app` or errors

### Track Changes Show "Waiting for Playback"

- This was fixed—ensure you're running the latest code
- The receiver now ignores `loading` state transitions
- The bridge sends NOW_PLAYING for all states when track data is present

### Album Art Not Showing

- Check `[Chromecast] trimmed payload` in logs
- If payload is > 60KB, inline image_data may be removed
- Background should still show (uses hosted image_url)

### Casting Stops Between Tracks

- This was fixed with 2-second pause debounce
- Ensure you're running latest code
- Track changes with `stopped` state now cancel the stop timer

### Settings Button Crashes Roon

- This was fixed by removing the Settings UI entirely
- Extension no longer provides `RoonApiSettings` service
- All configuration is done via web interface at `http://localhost:8080`

### Core Connection Flapping

- This was fixed by delaying core activation by 1 second
- The bridge no longer clears zones when reconnecting to the same core
- Check logs for repeated `Core paired / Core unpaired` messages
- If still happening, restart both Roon and the bridge

## Development

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start

# View logs in real-time
tail -f ~/.cursor/projects/.../terminals/*.txt
```

## API Endpoints

### REST API

- `GET /api/status` - Current bridge status (cores, zones, devices, now-playing)
- `POST /api/cores/select` - Select Roon core (`{ "coreId": "..." }`)
- `POST /api/zones/select` - Select zone (`{ "zoneId": "..." }`)
- `POST /api/cast/select` - Select Chromecast (`{ "deviceId": "..." }`)
- `POST /api/cast/refresh` - Trigger Chromecast device rescan
- `GET /images/:id` - Serve cached image (auto-generated URLs)

### Socket.IO Events

**Client → Server:**
- `request:auto-select` - Auto-select if only one option available

**Server → Client:**
- `bootstrap` - Initial state on connection
- `roon:update` - Roon state changed (cores, zones)
- `roon:now-playing` - Now playing data updated
- `roon:state` - Playback state changed
- `cast:devices` - Chromecast device list updated
- `cast:status` - Chromecast connection status changed
- `cast:error` - Chromecast error occurred

## Dependencies

### Runtime Dependencies

- **express** (5.2.1) - HTTP server
- **socket.io** (4.8.3) - Real-time bidirectional communication
- **castv2** (0.1.10) - Chromecast protocol implementation
- **mdns-js** (1.0.3) - mDNS/Bonjour device discovery
- **node-roon-api** (git) - Roon Core discovery and pairing
- **node-roon-api-transport** (git) - Roon zone subscriptions
- **node-roon-api-status** (git) - Roon extension status display
- **node-roon-api-image** (git) - Roon image proxy access
- **node-fetch** (2.7.0) - External API requests (Deezer, iTunes)
- **cors** (2.8.5) - Cross-origin resource sharing
- **dotenv** (17.2.3) - Environment variable management

### Development Dependencies

- **nodemon** (3.1.11) - Auto-restart on file changes

## License

MIT

## Credits

- Original template: `/Users/zeki/Desktop/index.html` (initial design)
- Updated layout: `/Users/zeki/Desktop/now-playing.html` (current design)
- Google Cast Application ID: `180705D2`
- Receiver URL: `https://zekimust-a11y.github.io/roon-cast/`
- Developed for casting Roon playback to Chromecast with rich metadata display

## Version History

- **v1.0.0** - Initial release
  - Roon extension with zone selection
  - Chromecast discovery and casting
  - Custom receiver with album art and artist images
  - Web-based control panel
  - Persistent settings
  - External artist image enrichment
  - Smooth track transitions
  - Pause debouncing
  - Image optimization via HTTP serving
