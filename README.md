# Pi 5 Dashboard Repo

Unified Angular dashboard for the Pi 5. This repo is the consolidation target for the legacy Pi 2 surfaces (static pages + APIs).

## URLs

- Prod (served by Caddy): `http://<pi5-ip>/`
- Todo/checklist (stashed old landing page): `http://<pi5-ip>/todo`

## Local Dev

```bash
cd ~/pi5-dashboard-repo
npm install
npm start
```

Then open `http://<pi5-ip>:4200/` (or `http://localhost:4200/` if running locally).

## Build / Deploy

This repo is configured to output production builds to:

- `~/pi5-dashboard-build`

Build:

```bash
cd ~/pi5-dashboard-repo
npm run build
```

Caddy serves the build output directly, so no reload is required after a successful build.

Convenience:

```bash
./scripts/deploy.sh
```

## Caddy

Single-site SPA hosting:

```caddyfile
:80 {
  root * /home/jeanclydecruz/pi5-dashboard-build
  encode gzip zstd
  try_files {path} {path}/ /index.html
  file_server
}
```

Note: Caddy runs as user `caddy` and needs execute permission on `/home/jeanclydecruz` to traverse into the build directory. We use an ACL for that:

```bash
sudo setfacl -m u:caddy:--x /home/jeanclydecruz
```
