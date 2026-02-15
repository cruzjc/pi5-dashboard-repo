#!/usr/bin/env bash
set -euo pipefail

# Installs the local API that exposes Pi5 env keys to the dashboard UI.
# Intended to be run on the Pi5 host.

API_PORT="8092"
ENV_PATH="/home/jeanclydecruz/.pi5-dashboard.keys.env"

sudo tee /etc/systemd/system/pi5-dashboard-api.service >/dev/null <<UNIT
[Unit]
Description=Pi5 Dashboard API
After=network.target

[Service]
Type=simple
User=jeanclydecruz
WorkingDirectory=/home/jeanclydecruz/pi5-dashboard-repo
Environment=PI5_DASHBOARD_API_HOST=127.0.0.1
Environment=PI5_DASHBOARD_API_PORT=
Environment=PI5_DASHBOARD_ENV_PATH=
ExecStart=/usr/bin/node /home/jeanclydecruz/pi5-dashboard-repo/api/server.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now pi5-dashboard-api.service
sudo systemctl is-active pi5-dashboard-api.service
