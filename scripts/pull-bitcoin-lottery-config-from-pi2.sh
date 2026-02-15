#!/usr/bin/env bash
set -euo pipefail

# Pulls the Pi2 proxy API key into a gitignored runtime config file.
# This avoids copy/pasting secrets while keeping them out of Git.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PI2_USERHOST="${PI2_USERHOST:-JeanclydeCruz@192.168.4.12}"
PI2_ENV_PATH="${PI2_ENV_PATH:-/home/JeanclydeCruz/bitcoin-lottery-proxy/.env}"

OUT_PATH="${OUT_PATH:-public/runtime-config.json}"
DEFAULT_PROXY_URL="${DEFAULT_PROXY_URL:-http://192.168.4.12/bitcoin}"

api_key="$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$PI2_USERHOST" "set -euo pipefail; grep -E '^PROXY_API_KEY=' '$PI2_ENV_PATH' | head -n 1 | cut -d= -f2-")"

# Trim CRLF and optional quotes.
api_key="${api_key//$'\r'/}"
api_key="${api_key%\"}"
api_key="${api_key#\"}"
api_key="${api_key%\'}"
api_key="${api_key#\'}"

if [[ -z "$api_key" ]]; then
  echo "ERROR: API key was empty." >&2
  exit 4
fi

umask 077
OUT_PATH="$OUT_PATH" DEFAULT_PROXY_URL="$DEFAULT_PROXY_URL" API_KEY="$api_key" python3 - <<'PY'
import json
import os
from pathlib import Path

out_path = Path(os.environ['OUT_PATH'])
cfg = {
  'bitcoinLottery': {
    'proxyUrl': os.environ.get('DEFAULT_PROXY_URL', '').strip(),
    'apiKey': os.environ['API_KEY'],
    'wallet': ''
  }
}

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(cfg, indent=2) + '\n', encoding='utf-8')
out_path.chmod(0o644)
print(f'Wrote {out_path} (gitignored)')
PY
