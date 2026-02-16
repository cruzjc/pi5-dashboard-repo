#!/usr/bin/env python3
"""
Enhanced Evening Options Researcher v2
- Options-specific data (IV, expected move, strike suggestions)
- AI-powered news sentiment (OpenAI)
- Price filters
- Entry/exit suggestions
- Expanded ticker universe (Alpaca + Robinhood filter)
- Earnings calendar
"""

import os
import json
import datetime
import requests
import time
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

import yfinance as yf
import pandas as pd
import numpy as np

# Load environment from the same key store used by the Pi5 dashboard API.
ENV_PATH = Path(os.getenv("PI5_DASHBOARD_ENV_PATH", str(Path.home() / ".pi5-dashboard.keys.env")))
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

# Configuration
DATA_DIR = Path(
    os.getenv("TRADING_RESEARCH_DATA_DIR", str(Path.home() / ".pi5-dashboard-data" / "trading"))
)
OUTPUT_DIR = DATA_DIR
OUTPUT_FILE = OUTPUT_DIR / "research.json"
JOURNAL_FILE = OUTPUT_DIR / "research_journal.json"
UNIVERSE_FILE = OUTPUT_DIR / "ticker_universe.json"
CONFIG_FILE = OUTPUT_DIR / "config.json"

# API Keys
ALPACA_KEY = (
    os.getenv("ALPACA_API_KEY")
    or os.getenv("ALPACA_API_KEY_ID")
    or os.getenv("APCA_API_KEY_ID")
)
ALPACA_SECRET = (
    os.getenv("ALPACA_SECRET_KEY")
    or os.getenv("ALPACA_API_SECRET_KEY")
    or os.getenv("APCA_API_SECRET_KEY")
)
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "").strip() or "gpt-4o-mini"
OPENAI_API_STYLE = (os.getenv("OPENAI_API_STYLE") or "").strip().lower()  # "responses" | "chat" | ""
FINNHUB_TOKEN = os.getenv("FINNHUB_TOKEN")

# Default config
DEFAULT_CONFIG = {
    "max_stock_price": 50,        # Only stocks under $50
    "max_option_premium": 2.00,   # Only options under $2.00
    "min_score": 2.0,             # Minimum score to display
    "max_tickers": 100,           # Max tickers to scan (Pi-friendly)
    "budget": 50,                 # Budget per trade
    "use_ai_sentiment": True,     # Use OpenAI for sentiment
    "ai_rate_limit_delay": 1,     # Seconds between AI calls
}

# Robinhood-tradeable tickers (popular options with good liquidity)
# This is a curated list - can be expanded via update_universe()
ROBINHOOD_POPULAR = [
    # Mega-cap tech
    "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA",
    # Semiconductor
    "AMD", "INTC", "MU", "QCOM", "AVGO", "TSM", "MRVL", "ON",
    # EVs & Clean Energy
    "RIVN", "LCID", "NIO", "XPEV", "LI", "FSR", "PLUG", "FCEL", "BE",
    # Fintech & Payments
    "SOFI", "HOOD", "COIN", "PYPL", "SQ", "AFRM", "UPST",
    # Retail & Consumer
    "GME", "AMC", "BBBY", "COST", "WMT", "TGT", "HD", "LOW",
    # Biotech & Pharma
    "MRNA", "BNTX", "PFE", "JNJ", "ABBV", "BMY", "LLY", "NVO",
    # Software & Cloud
    "CRM", "SNOW", "PLTR", "NET", "DDOG", "ZS", "CRWD", "PANW",
    # Streaming & Social
    "NFLX", "DIS", "ROKU", "SPOT", "SNAP", "PINS", "RBLX",
    # Travel & Leisure
    "ABNB", "UBER", "LYFT", "DAL", "UAL", "AAL", "LUV", "CCL", "RCL", "NCLH",
    # Energy
    "XOM", "CVX", "OXY", "SLB", "DVN", "FANG", "MRO",
    # Financials
    "JPM", "BAC", "GS", "MS", "C", "WFC", "SCHW", "V", "MA", "AXP",
    # Industrials
    "BA", "CAT", "DE", "UPS", "FDX",
    # Telecom & Media
    "T", "VZ", "TMUS", "CMCSA",
    # Real Estate
    "O", "SPG", "AMT", "PLD",
    # Mining & Materials
    "GOLD", "NEM", "FCX", "CLF", "X",
    # Cannabis
    "TLRY", "CGC", "ACB",
    # Meme/High-volatility
    "BBIG", "MULN", "SNDL", "WISH", "CLOV", "SPCE",
    # China ADRs
    "BABA", "JD", "PDD", "BIDU",
    # ETFs (for reference, though we focus on stocks)
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK",
]


def load_config() -> dict:
    """Load configuration"""
    config = DEFAULT_CONFIG.copy()
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            user_config = json.load(f)
            config.update(user_config)
    return config


def save_config(config: dict):
    """Save configuration"""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def get_universe(config: dict) -> list:
    """Get ticker universe, optionally from cached file"""
    tickers = ROBINHOOD_POPULAR.copy()
    
    # Load custom universe if exists
    if UNIVERSE_FILE.exists():
        with open(UNIVERSE_FILE) as f:
            data = json.load(f)
            custom = data.get("tickers", [])
            for t in custom:
                if t not in tickers:
                    tickers.append(t)
    
    # Limit for Pi performance
    return tickers[:config.get("max_tickers", 100)]


def update_universe_from_alpaca():
    """
    Update ticker universe from Alpaca's tradeable assets.
    Filters for US equities that are tradeable and have options.
    """
    if not ALPACA_KEY or not ALPACA_SECRET:
        print("Alpaca keys not configured, skipping universe update")
        return
    
    print("Fetching tradeable assets from Alpaca...")
    
    try:
        headers = {
            "APCA-API-KEY-ID": ALPACA_KEY,
            "APCA-API-SECRET-KEY": ALPACA_SECRET
        }
        
        resp = requests.get(
            "https://api.alpaca.markets/v2/assets",
            headers=headers,
            params={"status": "active", "asset_class": "us_equity"}
        )
        resp.raise_for_status()
        assets = resp.json()
        
        # Filter for tradeable, optionable assets
        tradeable = [
            a["symbol"] for a in assets
            if a.get("tradable") and 
               a.get("fractionable") and  # Usually means good liquidity
               not a.get("symbol", "").endswith("W") and  # Skip warrants
               len(a.get("symbol", "")) <= 5  # Skip weird symbols
        ]
        
        # Merge with existing
        existing = set(ROBINHOOD_POPULAR)
        new_tickers = [t for t in tradeable if t not in existing]
        
        # Save updated universe
        universe_data = {
            "updated_at": datetime.datetime.now().isoformat(),
            "source": "alpaca",
            "tickers": list(existing) + new_tickers[:200],  # Cap at reasonable size
            "total_available": len(tradeable)
        }
        
        UNIVERSE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(UNIVERSE_FILE, 'w') as f:
            json.dump(universe_data, f, indent=2)
        
        print(f"Universe updated: {len(universe_data['tickers'])} tickers")
        
    except Exception as e:
        print(f"Error updating universe: {e}")


def get_ai_sentiment(ticker: str, headlines: list[str], config: dict, force: bool = False) -> dict:
    """Use OpenAI to analyze news sentiment (only for top picks to save credits)"""
    if not OPENAI_KEY or not headlines:
        return {"score": 0, "summary": None, "confidence": "low"}
    
    # Skip AI unless forced (top picks only)
    if not force and not config.get("force_ai_all", False):
        return {"score": 0, "summary": None, "confidence": "skipped"}
    
    try:
        # Rate limiting
        time.sleep(config.get("ai_rate_limit_delay", 1))
        
        prompt = f"""Analyze the sentiment of these news headlines for {ticker} stock.
Rate the overall sentiment from -5 (very bearish) to +5 (very bullish).
Consider: earnings implications, market reaction, analyst views, company fundamentals.

Headlines:
{chr(10).join(f'- {h}' for h in headlines[:5])}

Respond with valid JSON only, no markdown:
{{"score": 2, "summary": "One sentence.", "confidence": "low", "catalysts": ["catalyst 1", "catalyst 2"]}}"""

        headers = {
            "Authorization": f"Bearer {OPENAI_KEY}",
            "Content-Type": "application/json",
        }

        def _extract_text_from_responses(data: dict) -> str:
            # Some versions may include output_text as a convenience field.
            ot = data.get("output_text")
            if isinstance(ot, str) and ot.strip():
                return ot.strip()

            parts: list[str] = []
            for item in data.get("output") or []:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "message":
                    for c in item.get("content") or []:
                        if not isinstance(c, dict):
                            continue
                        t = c.get("text")
                        if isinstance(t, str):
                            parts.append(t)
            return "".join(parts).strip()

        def _parse_json_obj(text: str) -> dict | None:
            text = (text or "").strip()
            if not text:
                return None
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if not m:
                return None
            try:
                obj = json.loads(m.group(0))
            except Exception:
                return None
            return obj if isinstance(obj, dict) else None

        errors: list[str] = []

        # Prefer the Responses API (works with newer reasoning models); fall back to Chat Completions.
        if OPENAI_API_STYLE in ("", "responses"):
            try:
                body = {
                    "model": OPENAI_MODEL,
                    "input": prompt,
                    # o*-style reasoning models can spend tokens on reasoning; keep enough headroom
                    # so the JSON doesn't get truncated.
                    "max_output_tokens": 600,
                    # Keep reasoning models fast/cheap. Some gpt-5*-chat models require "medium"
                    # if reasoning is provided; we retry on 400s.
                    "reasoning": {"effort": "low"},
                }

                for _ in range(3):
                    resp = requests.post(
                        OPENAI_BASE_URL + "/responses",
                        headers=headers,
                        json=body,
                        timeout=30,
                    )

                    if resp.status_code != 400:
                        break

                    # Retry common incompatibilities across models/endpoints.
                    txt = resp.text or ""
                    changed = False

                    if "Unsupported parameter: 'temperature'" in txt and "temperature" in body:
                        body.pop("temperature", None)
                        changed = True

                    if ("reasoning.effort" in txt or "reasoning" in txt) and isinstance(body.get("reasoning"), dict):
                        effort = body["reasoning"].get("effort")
                        if effort == "low":
                            body["reasoning"]["effort"] = "medium"
                            changed = True
                        elif effort == "medium":
                            body.pop("reasoning", None)
                            changed = True

                    if ("Unsupported parameter: 'reasoning'" in txt or "Unknown parameter: 'reasoning'" in txt) and "reasoning" in body:
                        body.pop("reasoning", None)
                        changed = True

                    if not changed:
                        break

                resp.raise_for_status()
                text = _extract_text_from_responses(resp.json())
                obj = _parse_json_obj(text)
                if obj:
                    return obj
            except Exception as e:
                errors.append(f"responses: {e}")

        if OPENAI_API_STYLE in ("", "chat"):
            try:
                payload = {
                    "model": OPENAI_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                }
                if OPENAI_MODEL.startswith("gpt-5"):
                    payload["max_completion_tokens"] = 240
                else:
                    payload["max_tokens"] = 240
                    payload["temperature"] = 0.3

                resp = requests.post(
                    OPENAI_BASE_URL + "/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=30,
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                obj = _parse_json_obj(content)
                if obj:
                    return obj
            except Exception as e:
                errors.append(f"chat: {e}")

        if errors:
            raise RuntimeError("; ".join(errors[-2:]))
        
    except Exception as e:
        print(f"AI sentiment error for {ticker}: {e}")
    
    return {"score": 0, "summary": None, "confidence": "low"}


def _atomic_write_json(path: Path, data: object):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, default=str)
    os.replace(tmp, path)


def _load_json_list(path: Path) -> list:
    try:
        if not path.exists():
            return []
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _build_basic_research_journal_entry(output: dict) -> dict:
    created_at = output.get("generated_at") or datetime.datetime.now().isoformat()
    summary = output.get("summary") or {}

    def _num(x, default=0):
        try:
            return int(x)
        except Exception:
            return default

    opps = _num(summary.get("opportunities_found"))
    earnings = _num(summary.get("earnings_upcoming"))
    oversold = _num(summary.get("oversold_count"))
    scanned = _num(summary.get("total_scanned"))
    passed = _num(summary.get("passed_filters"))

    picks: list[dict] = []
    for p in (output.get("top_picks") or [])[:5]:
        idea = p.get("trade_idea") or {}
        ai = p.get("ai_sentiment") or {}
        score = p.get("score")
        if isinstance(score, (int, float)):
            score = round(float(score), 1)
        picks.append(
            {
                "ticker": p.get("ticker"),
                "score": score,
                "direction": idea.get("direction"),
                "ai_summary": ai.get("summary"),
            }
        )

    return {
        "created_at": created_at,
        "title": f"Scan: {opps} opportunities (4+) | Earnings: {earnings} | Oversold: {oversold}",
        "summary": f"Scanned {scanned} tickers; {passed} passed filters.",
        "top_picks": picks,
    }


def _openai_generate_json(prompt: str, *, max_output_tokens: int = 800, timeout: int = 60) -> dict | None:
    if not OPENAI_KEY:
        return None

    headers = {
        "Authorization": f"Bearer {OPENAI_KEY}",
        "Content-Type": "application/json",
    }

    def _extract_text_from_responses(data: dict) -> str:
        ot = data.get("output_text")
        if isinstance(ot, str) and ot.strip():
            return ot.strip()

        parts: list[str] = []
        for item in data.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                for c in item.get("content") or []:
                    if not isinstance(c, dict):
                        continue
                    t = c.get("text")
                    if isinstance(t, str):
                        parts.append(t)
        return "".join(parts).strip()

    def _parse_json_obj(text: str) -> dict | None:
        text = (text or "").strip()
        if not text:
            return None
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except Exception:
            return None
        return obj if isinstance(obj, dict) else None

    errors: list[str] = []

    if OPENAI_API_STYLE in ("", "responses"):
        try:
            body = {
                "model": OPENAI_MODEL,
                "input": prompt,
                "max_output_tokens": max_output_tokens,
                "reasoning": {"effort": "low"},
            }

            for _ in range(3):
                resp = requests.post(
                    OPENAI_BASE_URL + "/responses",
                    headers=headers,
                    json=body,
                    timeout=timeout,
                )

                if resp.status_code != 400:
                    break

                txt = resp.text or ""
                changed = False

                if ("reasoning.effort" in txt or "reasoning" in txt) and isinstance(body.get("reasoning"), dict):
                    effort = body["reasoning"].get("effort")
                    if effort == "low":
                        body["reasoning"]["effort"] = "medium"
                        changed = True
                    elif effort == "medium":
                        body.pop("reasoning", None)
                        changed = True

                if ("Unsupported parameter: 'reasoning'" in txt or "Unknown parameter: 'reasoning'" in txt) and "reasoning" in body:
                    body.pop("reasoning", None)
                    changed = True

                if not changed:
                    break

            resp.raise_for_status()
            text = _extract_text_from_responses(resp.json())
            obj = _parse_json_obj(text)
            if obj:
                return obj
        except Exception as e:
            errors.append(f"responses: {e}")

    if OPENAI_API_STYLE in ("", "chat"):
        try:
            payload = {
                "model": OPENAI_MODEL,
                "messages": [{"role": "user", "content": prompt}],
            }
            if OPENAI_MODEL.startswith("gpt-5"):
                payload["max_completion_tokens"] = max_output_tokens
            else:
                payload["max_tokens"] = max_output_tokens

            resp = requests.post(
                OPENAI_BASE_URL + "/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            obj = _parse_json_obj(content)
            if obj:
                return obj
        except Exception as e:
            errors.append(f"chat: {e}")

    if errors:
        raise RuntimeError("; ".join(errors[-2:]))

    return None


def append_research_journal(output: dict, config: dict):
    entries = _load_json_list(JOURNAL_FILE)
    entry = _build_basic_research_journal_entry(output)

    # Optional AI-authored journal note (1 call per run). Fail open.
    try:
        if OPENAI_KEY and config.get("use_ai_sentiment", True):
            summary = output.get("summary") or {}
            top_picks = []
            for p in (output.get("top_picks") or [])[:5]:
                top_picks.append(
                    {
                        "ticker": p.get("ticker"),
                        "price": p.get("price"),
                        "score": p.get("score"),
                        "direction": (p.get("trade_idea") or {}).get("direction"),
                        "reasons": (p.get("reasons") or [])[:6],
                        "ai_sentiment": (p.get("ai_sentiment") or {}),
                    }
                )

            context = {
                "generated_at": output.get("generated_at"),
                "summary": summary,
                "top_picks": top_picks,
                "earnings_plays": [
                    {"ticker": p.get("ticker"), "days_to_earnings": p.get("days_to_earnings"), "direction": (p.get("trade_idea") or {}).get("direction")}
                    for p in (output.get("categories") or {}).get("earnings_plays", [])[:5]
                ],
                "momentum_plays": [
                    {"ticker": p.get("ticker"), "momentum_5d": p.get("momentum_5d"), "direction": (p.get("trade_idea") or {}).get("direction")}
                    for p in (output.get("categories") or {}).get("momentum_plays", [])[:5]
                ],
                "oversold_plays": [
                    {"ticker": p.get("ticker"), "rsi": p.get("rsi"), "direction": (p.get("trade_idea") or {}).get("direction")}
                    for p in (output.get("categories") or {}).get("oversold_plays", [])[:5]
                ],
            }

            prompt = (
                "Write a short daily research journal entry for my private stock/options dashboard. "
                "Use the scan context JSON below. "
                "Return valid JSON only (no markdown) with this schema:\n"
                "{\n"
                '  "headline": "short headline",\n'
                '  "tone": "bullish|bearish|mixed|neutral",\n'
                '  "themes": ["theme 1", "theme 2"],\n'
                '  "watchlist": [{"ticker": "AAPL", "direction": "CALL|PUT|NEUTRAL", "why": "one line"}],\n'
                '  "notes": "2-5 sentences max, plain text"\n'
                "}\n\n"
                "Scan context JSON:\n"
                + json.dumps(context, ensure_ascii=False, default=str)
            )

            ai_journal = _openai_generate_json(prompt, max_output_tokens=700, timeout=60)
            if ai_journal:
                entry["ai_journal"] = ai_journal
                entry["model"] = OPENAI_MODEL
    except Exception as e:
        print(f"Journal AI note error: {e}")

    # De-dupe on timestamp if re-run.
    if entries and entries[0].get("created_at") == entry.get("created_at"):
        entries[0] = entry
    else:
        entries.insert(0, entry)

    max_entries = 30
    try:
        max_entries = int(os.getenv("RESEARCH_JOURNAL_MAX_ENTRIES") or max_entries)
    except Exception:
        pass

    _atomic_write_json(JOURNAL_FILE, entries[:max_entries])


def get_options_data(stock, price: float, config: dict) -> dict:
    """Get options-specific data: IV, expected move, suggested strikes"""
    try:
        options_dates = stock.options
        if not options_dates:
            return None
        
        # Find nearest expiration (weekly or next)
        today = datetime.date.today()
        nearest_exp = None
        weekly_exp = None
        
        for exp_str in options_dates[:5]:
            exp_date = datetime.datetime.strptime(exp_str, "%Y-%m-%d").date()
            days_out = (exp_date - today).days
            
            if days_out >= 1:
                if nearest_exp is None:
                    nearest_exp = exp_str
                if 5 <= days_out <= 10 and weekly_exp is None:
                    weekly_exp = exp_str
        
        target_exp = weekly_exp or nearest_exp
        if not target_exp:
            return None
        
        chain = stock.option_chain(target_exp)
        calls = chain.calls
        puts = chain.puts
        
        if calls.empty or puts.empty:
            return None
        
        # Find ATM options
        atm_strike = round(price)
        
        # Get nearest strikes
        call_atm = calls.iloc[(calls['strike'] - atm_strike).abs().argsort()[:1]]
        put_atm = puts.iloc[(puts['strike'] - atm_strike).abs().argsort()[:1]]
        
        # Calculate IV and expected move
        call_iv = call_atm['impliedVolatility'].values[0] if not call_atm.empty else 0
        put_iv = put_atm['impliedVolatility'].values[0] if not put_atm.empty else 0
        avg_iv = (call_iv + put_iv) / 2
        
        # Expected move = Stock Price × IV × sqrt(DTE/365)
        exp_date = datetime.datetime.strptime(target_exp, "%Y-%m-%d").date()
        dte = (exp_date - today).days
        expected_move_pct = avg_iv * np.sqrt(dte / 365) * 100
        expected_move_dollars = price * (expected_move_pct / 100)
        
        # Find affordable options under max premium
        max_premium = config.get("max_option_premium", 2.00)
        
        affordable_calls = calls[calls['lastPrice'] <= max_premium].sort_values('strike')
        affordable_puts = puts[puts['lastPrice'] <= max_premium].sort_values('strike', ascending=False)
        
        # Suggest best entries
        call_suggestion = None
        put_suggestion = None
        
        if not affordable_calls.empty:
            # For calls, pick slightly OTM with good volume
            otm_calls = affordable_calls[affordable_calls['strike'] >= price]
            if not otm_calls.empty:
                best_call = otm_calls.iloc[0]
                call_suggestion = {
                    "strike": best_call['strike'],
                    "premium": round(best_call['lastPrice'], 2),
                    "iv": round(best_call['impliedVolatility'] * 100, 1),
                    "volume": int(best_call['volume']) if pd.notna(best_call['volume']) else 0,
                    "oi": int(best_call['openInterest']) if pd.notna(best_call['openInterest']) else 0,
                    "break_even": round(best_call['strike'] + best_call['lastPrice'], 2),
                }
        
        if not affordable_puts.empty:
            # For puts, pick slightly OTM with good volume
            otm_puts = affordable_puts[affordable_puts['strike'] <= price]
            if not otm_puts.empty:
                best_put = otm_puts.iloc[0]
                put_suggestion = {
                    "strike": best_put['strike'],
                    "premium": round(best_put['lastPrice'], 2),
                    "iv": round(best_put['impliedVolatility'] * 100, 1),
                    "volume": int(best_put['volume']) if pd.notna(best_put['volume']) else 0,
                    "oi": int(best_put['openInterest']) if pd.notna(best_put['openInterest']) else 0,
                    "break_even": round(best_put['strike'] - best_put['lastPrice'], 2),
                }
        
        return {
            "expiration": target_exp,
            "dte": dte,
            "iv_avg": round(avg_iv * 100, 1),
            "expected_move_pct": round(expected_move_pct, 1),
            "expected_move_dollars": round(expected_move_dollars, 2),
            "call_suggestion": call_suggestion,
            "put_suggestion": put_suggestion,
            "atm_call_price": round(call_atm['lastPrice'].values[0], 2) if not call_atm.empty else None,
            "atm_put_price": round(put_atm['lastPrice'].values[0], 2) if not put_atm.empty else None,
        }
        
    except Exception as e:
        print(f"Options data error: {e}")
        return None


def calculate_entry_exit(data: dict, options: dict) -> dict:
    """Calculate suggested entry and exit prices"""
    price = data.get("price", 0)
    momentum = data.get("momentum_5d", 0)
    rsi = data.get("rsi", 50)
    expected_move = options.get("expected_move_pct", 5) if options else 5
    
    # Determine direction
    direction = data.get("trade_idea", {}).get("direction", "CALL")
    
    if direction == "CALL":
        # For calls: entry on dip, exit on pop
        entry_pct = -1.5 if rsi > 50 else -0.5  # Buy on small dip
        exit_pct = expected_move * 0.7  # Take profit at 70% of expected move
        stop_pct = -expected_move * 0.5  # Stop at 50% of expected move
        
        entry_price = round(price * (1 + entry_pct/100), 2)
        target_price = round(price * (1 + exit_pct/100), 2)
        stop_price = round(price * (1 + stop_pct/100), 2)
        
    elif direction == "PUT":
        # For puts: entry on bounce, exit on drop
        entry_pct = 1.5 if rsi < 50 else 0.5  # Buy on small bounce
        exit_pct = -expected_move * 0.7
        stop_pct = expected_move * 0.5
        
        entry_price = round(price * (1 + entry_pct/100), 2)
        target_price = round(price * (1 + exit_pct/100), 2)
        stop_price = round(price * (1 + stop_pct/100), 2)
        
    else:  # STRADDLE
        entry_price = price
        target_price = round(price * (1 + expected_move/100), 2)
        stop_price = round(price * (1 - expected_move/200), 2)
    
    return {
        "direction": direction,
        "stock_entry": entry_price,
        "stock_target": target_price,
        "stock_stop": stop_price,
        "option_entry": "At or below suggested premium",
        "option_target": "50-100% gain on premium",
        "option_stop": "50% loss on premium",
    }


def get_stock_data(ticker: str, config: dict) -> dict | None:
    """Fetch comprehensive stock data"""
    try:
        stock = yf.Ticker(ticker)
        
        # Get price history
        hist = stock.history(period="1mo")
        if hist.empty or len(hist) < 5:
            return None
        
        current = hist.iloc[-1]
        prev = hist.iloc[-2] if len(hist) > 1 else current
        price = current['Close']
        
        # Apply price filter
        if price > config.get("max_stock_price", 50):
            return None
        
        change_pct = ((price - prev['Close']) / prev['Close']) * 100
        
        # Volume analysis
        avg_volume = hist['Volume'].mean()
        vol_surge = current['Volume'] / avg_volume if avg_volume > 0 else 1
        
        # Momentum
        if len(hist) >= 5:
            price_5d_ago = hist.iloc[-5]['Close']
            momentum_5d = ((price - price_5d_ago) / price_5d_ago) * 100
        else:
            momentum_5d = 0
        
        # RSI
        rsi = calculate_rsi(hist['Close'])
        
        # Trend
        sma_10 = hist['Close'].tail(10).mean()
        sma_20 = hist['Close'].tail(20).mean() if len(hist) >= 20 else sma_10
        trend = "bullish" if price > sma_10 > sma_20 else "bearish" if price < sma_10 < sma_20 else "neutral"
        
        # Support/Resistance levels
        recent_low = hist['Low'].tail(10).min()
        recent_high = hist['High'].tail(10).max()
        
        # Earnings date
        earnings_date = None
        days_to_earnings = None
        try:
            calendar = stock.calendar
            if calendar is not None and not calendar.empty:
                if 'Earnings Date' in calendar.index:
                    ed = calendar.loc['Earnings Date']
                    if isinstance(ed, pd.Series):
                        ed = ed.iloc[0]
                    if pd.notna(ed):
                        if isinstance(ed, str):
                            earnings_date = ed
                        else:
                            earnings_date = ed.strftime("%Y-%m-%d")
                        ed_dt = pd.to_datetime(earnings_date)
                        days_to_earnings = (ed_dt - pd.Timestamp.now()).days
        except:
            pass
        
        # Get options data
        options_data = get_options_data(stock, price, config)
        
        # Get news (updated for new Yahoo API structure)
        news_items = []
        try:
            news = stock.news[:5] if hasattr(stock, 'news') else []
            for item in news:
                # Handle new nested structure under 'content'
                content_data = item.get('content', item)  # fallback to item if no content key
                title = content_data.get('title', '')
                provider = content_data.get('provider', {})
                publisher = provider.get('displayName', '') if isinstance(provider, dict) else ''
                click_url = content_data.get('clickThroughUrl', {})
                link = click_url.get('url', '') if isinstance(click_url, dict) else ''
                if title:  # Only add if we have a title
                    news_items.append({
                        "title": title,
                        "publisher": publisher,
                        "link": link,
                    })
        except Exception as e:
            pass
        
        # AI Sentiment - skipped in first pass, done later for top picks only
        headlines = [n['title'] for n in news_items if n.get('title')]
        ai_sentiment = {"score": 0, "summary": None, "confidence": "pending"}
        
        return {
            "ticker": ticker,
            "price": round(price, 2),
            "change_pct": round(change_pct, 2),
            "volume": int(current['Volume']),
            "vol_surge": round(vol_surge, 2),
            "momentum_5d": round(momentum_5d, 2),
            "rsi": round(rsi, 1) if rsi else None,
            "trend": trend,
            "support": round(recent_low, 2),
            "resistance": round(recent_high, 2),
            "earnings_date": earnings_date,
            "days_to_earnings": days_to_earnings,
            "options": options_data,
            "news": news_items[:3],
            "ai_sentiment": ai_sentiment,
        }
        
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        return None


def calculate_rsi(prices: pd.Series, period: int = 14) -> float | None:
    """Calculate RSI"""
    if len(prices) < period + 1:
        return None
    
    delta = prices.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    return rsi.iloc[-1] if not pd.isna(rsi.iloc[-1]) else None


def score_opportunity(data: dict, config: dict) -> tuple[float, list]:
    """Score an opportunity with enhanced factors"""
    score = 0
    reasons = []
    
    # Earnings catalyst
    days_to_earnings = data.get('days_to_earnings')
    if days_to_earnings is not None:
        if 1 <= days_to_earnings <= 3:
            score += 3
            reasons.append(f"⚡ Earnings in {days_to_earnings}d")
        elif 4 <= days_to_earnings <= 7:
            score += 2
            reasons.append(f"📅 Earnings in {days_to_earnings}d")
        elif days_to_earnings == 0:
            score += 1
            reasons.append("📅 Earnings today")
    
    # Volume surge
    vol_surge = data.get('vol_surge', 1)
    if vol_surge >= 2:
        score += 2
        reasons.append(f"📊 Volume {vol_surge:.1f}x")
    elif vol_surge >= 1.5:
        score += 1
        reasons.append(f"📊 Volume {vol_surge:.1f}x")
    
    # Momentum
    momentum = data.get('momentum_5d', 0)
    if abs(momentum) >= 10:
        score += 2
        emoji = "🚀" if momentum > 0 else "📉"
        reasons.append(f"{emoji} {abs(momentum):.1f}% move")
    elif abs(momentum) >= 5:
        score += 1
        emoji = "📈" if momentum > 0 else "📉"
        reasons.append(f"{emoji} {abs(momentum):.1f}% move")
    
    # RSI extremes
    rsi = data.get('rsi')
    if rsi:
        if rsi >= 70:
            score += 1
            reasons.append(f"🔥 Overbought RSI {rsi:.0f}")
        elif rsi <= 30:
            score += 1.5  # Oversold often better opportunity
            reasons.append(f"💎 Oversold RSI {rsi:.0f}")
    
    # Options IV
    options = data.get('options')
    if options:
        iv = options.get('iv_avg', 0)
        if iv >= 80:
            score += 1
            reasons.append(f"🌡️ High IV {iv:.0f}%")
        elif iv <= 30 and iv > 0:
            score += 1.5  # Low IV = cheap options
            reasons.append(f"💰 Low IV {iv:.0f}%")
        
        # Bonus for affordable options
        call_sug = options.get('call_suggestion')
        put_sug = options.get('put_suggestion')
        if call_sug or put_sug:
            score += 0.5
            reasons.append("✅ Affordable options")
    
    # AI Sentiment
    ai_sent = data.get('ai_sentiment', {})
    ai_score = ai_sent.get('score', 0)
    if abs(ai_score) >= 3:
        score += 1.5
        emoji = "🟢" if ai_score > 0 else "🔴"
        reasons.append(f"{emoji} AI: {ai_sent.get('summary', 'Strong signal')[:30]}")
    elif abs(ai_score) >= 2:
        score += 1
        emoji = "🟢" if ai_score > 0 else "🔴"
        reasons.append(f"{emoji} AI sentiment")
    
    return score, reasons


def generate_trade_idea(data: dict, score: float, reasons: list) -> dict:
    """Generate trade idea with direction and entry/exit"""
    momentum = data.get('momentum_5d', 0)
    trend = data.get('trend', 'neutral')
    rsi = data.get('rsi', 50)
    ai_score = data.get('ai_sentiment', {}).get('score', 0)
    
    # Determine direction
    bullish_signals = 0
    bearish_signals = 0
    
    if momentum > 3: bullish_signals += 1
    elif momentum < -3: bearish_signals += 1
    
    if trend == 'bullish': bullish_signals += 1
    elif trend == 'bearish': bearish_signals += 1
    
    if ai_score > 0: bullish_signals += 1
    elif ai_score < 0: bearish_signals += 1
    
    if rsi and rsi < 35: bullish_signals += 1
    elif rsi and rsi > 65: bearish_signals += 1
    
    if bullish_signals > bearish_signals:
        direction = "CALL"
        bias = "bullish"
    elif bearish_signals > bullish_signals:
        direction = "PUT"
        bias = "bearish"
    else:
        direction = "STRADDLE"
        bias = "neutral"
    
    # Expiration suggestion
    days_to_earnings = data.get('days_to_earnings')
    options = data.get('options', {})
    
    if days_to_earnings and 1 <= days_to_earnings <= 7:
        expiry = f"Through earnings ({data['earnings_date']})"
    elif options and options.get('expiration'):
        expiry = f"{options['expiration']} ({options['dte']} DTE)"
    else:
        expiry = "1-2 weeks out"
    
    # Get entry/exit
    entry_exit = calculate_entry_exit(data, options)
    
    return {
        "direction": direction,
        "bias": bias,
        "expiry": expiry,
        "reasons": reasons,
        "entry_exit": entry_exit,
        "suggested_option": options.get(f"{'call' if direction == 'CALL' else 'put'}_suggestion") if options else None,
    }


def build_earnings_calendar(results: list) -> list:
    """Build visual earnings calendar for the week"""
    today = datetime.date.today()
    calendar = []
    
    for i in range(7):
        day = today + datetime.timedelta(days=i)
        day_str = day.strftime("%Y-%m-%d")
        day_name = day.strftime("%a %m/%d")
        
        earnings_today = [
            {"ticker": r['ticker'], "price": r['price'], "score": r.get('score', 0)}
            for r in results
            if r.get('earnings_date') == day_str
        ]
        
        calendar.append({
            "date": day_str,
            "day": day_name,
            "is_today": i == 0,
            "earnings": earnings_today
        })
    
    return calendar


def run_research():
    """Main research function"""
    config = load_config()
    
    print(f"[{datetime.datetime.now()}] Starting enhanced options research...")
    print(f"Config: max_price=${config['max_stock_price']}, max_premium=${config['max_option_premium']}")
    
    # Try to load discovered tickers, fall back to default universe
    try:
        from ticker_discovery import get_universe as get_discovered_universe, get_discovered_info
        universe = get_discovered_universe()
        print(f"Using discovered universe: {len(universe)} tickers")
    except:
        universe = get_universe(config)
        get_discovered_info = lambda x: None
    
    print(f"Scanning {len(universe)} tickers...")
    
    # Fetch data (limited parallelism for Pi) - NO AI in first pass
    results = []
    
    # Process in batches to be Pi-friendly
    batch_size = 5
    for i in range(0, len(universe), batch_size):
        batch = universe[i:i+batch_size]
        
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {executor.submit(get_stock_data, ticker, config): ticker for ticker in batch}
            
            for future in as_completed(futures):
                ticker = futures[future]
                try:
                    data = future.result()
                    if data:
                        # Add discovery info if available
                        discovery_info = get_discovered_info(ticker) if callable(get_discovered_info) else None
                        if discovery_info:
                            data['discovery'] = discovery_info
                        
                        score, reasons = score_opportunity(data, config)
                        if score >= config.get("min_score", 0):
                            data['score'] = score
                            data['reasons'] = reasons
                            data['trade_idea'] = generate_trade_idea(data, score, reasons)
                            results.append(data)
                except Exception as e:
                    print(f"Error processing {ticker}: {e}")
        
        # Small delay between batches
        if i + batch_size < len(universe):
            time.sleep(0.5)
    
    # Sort by score
    results.sort(key=lambda x: x['score'], reverse=True)
    
    # === AI SENTIMENT FOR TOP 5 ONLY (to save credits) ===
    top_n_for_ai = config.get("ai_top_n", 5)
    if OPENAI_KEY and config.get("use_ai_sentiment", True):
        print(f"\nRunning AI sentiment analysis on top {top_n_for_ai} picks...")
        for i, result in enumerate(results[:top_n_for_ai]):
            ticker = result['ticker']
            headlines = [n['title'] for n in result.get('news', []) if n.get('title')]
            if headlines:
                print(f"  Analyzing {ticker}...")
                ai_sentiment = get_ai_sentiment(ticker, headlines, config, force=True)
                result['ai_sentiment'] = ai_sentiment
                
                # Adjust score based on AI sentiment
                ai_score = ai_sentiment.get('score', 0)
                if abs(ai_score) >= 3:
                    result['score'] += 1.5
                    result['reasons'].append(f"{'🟢' if ai_score > 0 else '🔴'} AI: {ai_sentiment.get('summary', 'Strong signal')[:30]}")
                elif abs(ai_score) >= 2:
                    result['score'] += 1
                    result['reasons'].append(f"{'🟢' if ai_score > 0 else '🔴'} AI sentiment")
                
                # Re-generate trade idea with AI info
                result['trade_idea'] = generate_trade_idea(result, result['score'], result['reasons'])
                
                # Rate limit
                time.sleep(config.get("ai_rate_limit_delay", 2))
        
        # Re-sort after AI adjustments
        results.sort(key=lambda x: x['score'], reverse=True)
    
    # Categorize
    earnings_plays = [r for r in results if r.get('days_to_earnings') and 0 <= r['days_to_earnings'] <= 7]
    momentum_plays = [r for r in results if abs(r.get('momentum_5d', 0)) >= 5 and r not in earnings_plays]
    oversold_plays = [r for r in results if r.get('rsi') and r['rsi'] <= 35 and r not in earnings_plays]
    
    # Build earnings calendar
    all_with_earnings = [r for r in results if r.get('days_to_earnings') is not None]
    earnings_calendar = build_earnings_calendar(all_with_earnings + [
        {"ticker": t, "earnings_date": None} for t in universe if t not in [r['ticker'] for r in results]
    ])
    
    # Build output with descriptions
    output = {
        "generated_at": datetime.datetime.now().isoformat(),
        "next_update": "7:00 PM HST tomorrow",
        "config": {
            "max_stock_price": config['max_stock_price'],
            "max_option_premium": config['max_option_premium'],
            "min_score": config['min_score'],
        },
        "descriptions": {
            "score_guide": {
                "6+": "🔥 Excellent - Multiple strong catalysts aligned. High conviction play.",
                "4-5.9": "✅ Good - Solid setup with clear catalyst. Worth considering.",
                "2-3.9": "👀 Watchlist - Some positive signals. Monitor for better entry.",
                "0-1.9": "⏸️ Weak - Limited catalyst. Wait for better setup.",
            },
            "sections": {
                "top_picks": "Highest-scoring opportunities across all categories. These have multiple bullish/bearish signals aligned.",
                "earnings_plays": "Stocks with earnings in the next 7 days. High risk/reward due to potential big moves. Consider straddles if direction unclear.",
                "momentum_plays": "Stocks moving 5%+ in the past 5 days with elevated volume. Trend followers.",
                "oversold_plays": "RSI under 35 - potentially oversold and due for a bounce. Contrarian plays.",
            },
            "entry_exit": "Entry prices are suggested limit orders. Targets are based on expected move. Stops protect against adverse moves."
        },
        "summary": {
            "total_scanned": len(universe),
            "passed_filters": len(results),
            "opportunities_found": len([r for r in results if r['score'] >= 4]),
            "earnings_upcoming": len(earnings_plays),
            "oversold_count": len(oversold_plays),
        },
        "top_picks": results[:10],
        "categories": {
            "earnings_plays": earnings_plays[:5],
            "momentum_plays": momentum_plays[:5],
            "oversold_plays": oversold_plays[:5],
        },
        "earnings_calendar": earnings_calendar,
        "all_results": results,
    }
    
    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f, indent=2, default=str)

    try:
        append_research_journal(output, config)
    except Exception as e:
        print(f"Journal update error: {e}")
    
    print(f"[{datetime.datetime.now()}] Research complete!")
    print(f"Scanned: {len(universe)}, Passed filters: {len(results)}, High-score: {len([r for r in results if r['score'] >= 4])}")
    print("\nTop 5:")
    for r in results[:5]:
        print(f"  {r['ticker']}: ${r['price']} | Score {r['score']:.1f} | {r['trade_idea']['direction']}")
        if r.get('ai_sentiment', {}).get('summary'):
            print(f"    AI: {r['ai_sentiment']['summary'][:60]}")
    
    return output


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--update-universe":
        update_universe_from_alpaca()
    else:
        run_research()
