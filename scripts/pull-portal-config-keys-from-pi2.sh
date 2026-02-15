#!/usr/bin/env bash
set -euo pipefail

# Pulls Pi2 portal-api keys into a local env file on Pi5.
# The output file contains secrets; keep it private and do not commit it.

PI2_USERHOST="${PI2_USERHOST:-JeanclydeCruz@192.168.4.12}"
PI2_CONFIG_PATH="${PI2_CONFIG_PATH:-/home/JeanclydeCruz/.portal-config.json}"
OUT_PATH="${OUT_PATH:-$HOME/.pi5-dashboard.keys.env}"

umask 077

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$PI2_USERHOST" "cat '$PI2_CONFIG_PATH'" >"$tmp"

python3 - "$OUT_PATH" "$tmp" <<'PY'
import datetime
import json
import shlex
import sys
from pathlib import Path

out_path = Path(sys.argv[1]).expanduser()
json_path = Path(sys.argv[2])
cfg = json.loads(json_path.read_text(encoding='utf-8'))

mapping = {
  'OPENAI_API_KEY': 'openaiApiKey',
  'OPENAI_MODEL': 'openaiModel',
  'GEMINI_API_KEY': 'geminiApiKey',
  'INWORLD_API_KEY': 'inworldApiKey',
  'INWORLD_SECRET': 'inworldSecret',
  'ALPACA_API_KEY_ID': 'alpacaKeyId',
  'ALPACA_API_SECRET_KEY': 'alpacaSecretKey',
  'APCA_API_BASE_URL': 'alpacaBaseUrl',
  'NTFY_URL': 'ntfyUrl',
  'NTFY_TOPIC': 'ntfyTopic',
  'NEWS_FEEDS': 'newsFeeds',
}

lines: list[str] = []
lines.append('# Generated from Pi2 ~/.portal-config.json')
lines.append(f"# Generated at {datetime.datetime.now().isoformat(timespec='seconds')}")
lines.append('# Contains secrets. Keep this file private.')

count = 0
for env_key, json_key in mapping.items():
  v = cfg.get(json_key)
  if v is None:
    continue
  if not isinstance(v, str):
    v = json.dumps(v)
  v = v.strip()
  if not v:
    continue
  lines.append(f"export {env_key}={shlex.quote(v)}")
  count += 1

out_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
out_path.chmod(0o600)

print(f'Wrote {out_path} ({count} vars)')
PY
