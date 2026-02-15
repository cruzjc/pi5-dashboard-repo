#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$ip" ]; then
  echo
  echo "Build complete. Caddy serves: http://$ip/"
fi
