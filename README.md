# Roon → Chromecast Bridge

This project exposes now-playing details from any authorized Roon Core and mirrors the information to a custom Chromecast receiver (app id **180705D2**). It contains three key pieces:

- **Node server & Roon extension** – Discovers/authorizes with local Roon cores, subscribes to zones, and watches playback.
- **Chromecast controller** – Scans the LAN for Cast devices, launches the custom receiver, and streams live metadata.
- **Receiver UI** – Hosted separately (e.g. `https://zekimust-a11y.github.io/roon-cast`) and styled from the provided template to display rich now-playing data.

## Prerequisites

- Node.js 18+
- Roon Core on the same network
- Chromecast device registered to the Google Cast developer console with app id `180705D2`

## Getting started

```bash
cp .env.example .env    # update port/namespace if needed
npm install
npm run dev             # starts Express + socket.io + discovery services
```

On first launch the extension named **“Roon Chromecast Bridge”** will appear in **Settings → Extensions** inside any Roon Core on the LAN. Enable it so that the server can subscribe to transport updates.

Open `http://<server-ip>:8080/` to access the control dashboard:

1. Select the authorized Roon Core.
2. Choose the zone that should trigger casting.
3. Pick the Chromecast device found via mDNS discovery.

As soon as the selected zone transitions to *Playing*, the server launches the custom receiver on the Chromecast (without using DashCast) and sends now-playing payloads in real time. Pauses/stops update the receiver state, and the control panel mirrors the same data.

## Receiver deployment

The folder `receiver/` contains the CAF-based HTML page derived from the supplied template. To host it at `https://zekimust-a11y.github.io/roon-cast`:

1. Create a new Git repository named `roon-cast` inside the `zekimust-a11y` GitHub account.
2. Copy the contents of the local `receiver/` directory into that repository.
3. Enable GitHub Pages (main branch, root).
4. Update the Cast developer console so application id `180705D2` points to the new Pages URL if it is not already configured.

Once live, any Chromecast session started by the Node bridge will load that URL automatically.

## Project structure

- `src/index.js` – Express bootstrap, socket.io wiring, and REST endpoints.
- `src/services/roonService.js` – Handles discovery, zone subscriptions, and emits now-playing payloads.
- `src/services/chromecastService.js` – mDNS scanning, Castv2 control channel, and auto-launch logic.
- `public/` – Control dashboard (vanilla JS + socket.io).
- `receiver/` – Custom CAF-backed Chromecast UI built from the provided index template.

## Environment variables

| Name | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP server + socket.io port |
| `CAST_APP_ID` | `180705D2` | Google Cast application id |
| `CAST_NAMESPACE` | `urn:x-cast:com.zeki.rooncast` | Custom namespace used for messaging |
| `DEFAULT_RECEIVER_URL` | `https://zekimust-a11y.github.io/roon-cast/` | Reference URL for the receiver app |

## Git workflow

The repo is ready to be initialized locally:

```bash
git init
git add .
git commit -m "feat: roon chromecast bridge"
```

Push the main project wherever you host backend services. Push the `receiver/` folder to the `roon-cast` GitHub Pages repo so it matches the application id.

## Limitations & next steps

- Album art is represented by an initial placeholder; exposing Roon’s image proxy would require an additional authenticated endpoint.
- Chromecast control currently targets a single device at a time.
- Volume/mute control is read-only inside the receiver (display only).

These can be iterated upon now that the end-to-end scaffolding is in place.


