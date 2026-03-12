# ARRFlow — Pipeline Visualizer

Visualizes your entire media request-to-Plex pipeline in real time.

```
Overseerr → Radarr/Sonarr/Lidarr → SABnzbd/qBittorrent → Plex
```

## Features

- **Pipeline Overview** — Live counts at each stage (pending → searching → downloading → importing → in Plex)
- **Service Health Cards** — Per-service metrics (queue size, library size, speeds, missing media)
- **Active Downloads Table** — Live progress bars for SABnzbd and qBittorrent
- **Recently Added** — Last 12 items added to Plex with type icons and timestamps
- **Auto-refresh** every 30 seconds (or manual via ↻ button)
- **Configurable** — All service URLs and API keys stored in browser localStorage

## Setup

### 1. Push to GitHub (first time)

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/gandhithepunk/arrflow.git
git push -u origin main
```

GitHub Actions will automatically build the image and push it to `ghcr.io/gandhithepunk/arrflow:latest`. Check the **Actions** tab — it takes about 1-2 minutes.

### 2. Make the package public (one-time)

By default the ghcr.io package is private. To let TrueNAS pull it without auth:

1. Go to `https://github.com/gandhithepunk?tab=packages`
2. Click **arrflow** → **Package settings**
3. Scroll to **Danger Zone** → **Change visibility** → **Public**

### 3. Deploy in Dockge on TrueNAS Scale

1. Open Dockge → **+ Compose**
2. Give it a name (e.g. `arrflow`)
3. Paste the contents of `docker-compose.yml`
4. Hit **Deploy**

Open **http://your-truenas-ip:3000**, click **⚙ Config**, and enter your service URLs and API keys.

### Updating

Push changes to `main` → GitHub Actions rebuilds the image automatically → in Dockge, click **Pull** then **Restart**.

## Configuration

Click **⚙ Config** in the top-right corner.

| Service | URL Example | Auth |
|---|---|---|
| Overseerr | `http://192.168.1.x:5055` | API Key (Settings → General) |
| Radarr | `http://192.168.1.x:7878` | API Key (Settings → General) |
| Sonarr | `http://192.168.1.x:8989` | API Key (Settings → General) |
| Lidarr | `http://192.168.1.x:8686` | API Key (Settings → General) |
| SABnzbd | `http://192.168.1.x:8080` | API Key (Config → General) |
| qBittorrent | `http://192.168.1.x:8080` | Username + Password |
| Plex | `http://192.168.1.x:32400` | X-Plex-Token |

> **TrueNAS note:** Since each service runs in its own Dockge stack, use LAN IPs rather than container hostnames. If you want container name resolution, uncomment the `networks` block in `docker-compose.yml` and attach all stacks to the same external Docker network.

### Getting your Plex Token

1. Sign in to Plex Web
2. Open any media item → **···** → **Get Info** → **View XML**
3. Copy the `X-Plex-Token` value from the URL

## Architecture

ARRFlow is a single Node.js process with zero npm dependencies:

- **Static server** — Serves the dashboard SPA from `/public`
- **CORS proxy** — Browser API calls go to `/proxy/<service>/<path>?_base=<url>`, forwarded server-side. Sidesteps CORS restrictions on all *arr services with no config changes needed on them. Also sets `rejectUnauthorized: false` so self-signed TLS certs work fine.

## Ports

| Default | Override |
|---|---|
| `3000` | Set `PORT` env var |
