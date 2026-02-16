#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-trading-research"
DATA_DIR="${TRADING_RESEARCH_DATA_DIR:-$HOME/.pi5-dashboard-data/trading}"
ENV_PATH="${PI5_DASHBOARD_ENV_PATH:-$HOME/.pi5-dashboard.keys.env}"
SCRIPT_PATH="$ROOT_DIR/trading-research/enhanced_researcher.py"
CRON_LOG="$DATA_DIR/research-agent-cron.log"
CRON_LINE="0 19 * * * PI5_DASHBOARD_ENV_PATH=$ENV_PATH TRADING_RESEARCH_DATA_DIR=$DATA_DIR $VENV_DIR/bin/python $SCRIPT_PATH >> $CRON_LOG 2>&1"

if [[ ! -f "$SCRIPT_PATH" ]]; then
  echo "Missing script: $SCRIPT_PATH" >&2
  exit 2
fi

mkdir -p "$DATA_DIR"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
"$VENV_DIR/bin/pip" install yfinance pandas requests python-dotenv numpy >/dev/null

if [[ ! -f "$DATA_DIR/config.json" ]]; then
  cat >"$DATA_DIR/config.json" <<'JSON'
{
  "max_stock_price": 80,
  "max_option_premium": 2.5,
  "min_score": 2.0,
  "max_tickers": 60,
  "budget": 50,
  "use_ai_sentiment": true,
  "ai_rate_limit_delay": 1,
  "ai_top_n": 5
}
JSON
fi

tmp="$(mktemp)"
crontab -l 2>/dev/null >"$tmp" || true

if ! grep -Fq "enhanced_researcher.py" "$tmp"; then
  {
    cat "$tmp"
    echo
    echo "# pi5-trading-research-agent"
    echo "$CRON_LINE"
  } | crontab -
fi

rm -f "$tmp"

echo "Installed trading research agent."
echo "Venv: $VENV_DIR"
echo "Data: $DATA_DIR"
echo "Env: $ENV_PATH"
echo "Cron:"
crontab -l | grep -n "enhanced_researcher.py" || true
