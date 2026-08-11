#!/usr/bin/env python3
"""
Oi Web — morning OCC fetch
Pulls open interest for SPY, QQQ, IWM, GLD, SPX and writes JSON snapshots
for static hosting (GitHub Pages / Cloudflare Pages).
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("pip install requests", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

# حذف أيام أقدم من هذا الحد (حماية حجم المستودع)
RETENTION_DAYS = 60

TICKER_URLS = {
    "SPY": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=spy",
    "QQQ": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=qqq",
    "IWM": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=iwm",
    "GLD": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=gld",
    "SPX": "https://marketdata.theocc.com/series-search?symbolType=U&symbol=spx",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

US_MARKET_HOLIDAYS = {
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16),
    date(2026, 4, 3), date(2026, 5, 25), date(2026, 6, 19),
    date(2026, 7, 3), date(2026, 9, 7), date(2026, 11, 26),
    date(2026, 12, 25),
}


def session_pull_date(today: date | None = None) -> tuple[str, date]:
    """Map calendar day to the options session column label (d-m)."""
    d = today or date.today()
    wd = d.weekday()
    if wd == 5:
        d = d + timedelta(days=2)
    elif wd == 6:
        d = d + timedelta(days=1)
    while d.weekday() >= 5 or d in US_MARKET_HOLIDAYS:
        d = d + timedelta(days=1)
    return f"{d.day}-{d.month}", d


def get_close(ticker: str) -> float | None:
    symbol_map = {"SPY": "SPY", "QQQ": "QQQ", "IWM": "IWM", "GLD": "GLD", "SPX": "^GSPC"}
    symbol = symbol_map.get(ticker, ticker)
    try:
        import yfinance as yf
        hist = yf.Ticker(symbol).history(period="10d")
        if hist is None or hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception as e:
        print(f"[warn] close {ticker}: {e}", file=sys.stderr)
        return None


def _product_matches(product: str, ticker: str) -> bool:
    p = (product or "").upper().strip()
    t = (ticker or "").upper().strip()
    if t == "SPX":
        return p in ("SPX", "SPXW")
    return p == t


def parse_occ_text(ticker: str, text: str) -> list[dict[str, Any]]:
    """Parse OCC series-search plain text rows into records."""
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 10:
            continue
        if not _product_matches(parts[0], ticker):
            continue
        try:
            exp = f"{parts[1]}-{parts[2].zfill(2)}-{parts[3].zfill(2)}"
            strike = float(f"{parts[4]}.{parts[5]}")
            call_oi = int(parts[8])
            put_oi = int(parts[9])
            rows.append(
                {
                    "expiration": exp,
                    "strike": strike,
                    "call_oi": call_oi,
                    "put_oi": put_oi,
                }
            )
        except Exception:
            continue
    return rows


def download_ticker(ticker: str, url: str) -> list[dict[str, Any]]:
    print(f"[...] {ticker}")
    r = requests.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    # OCC sometimes returns HTML wrapper; keep raw text parse tolerant
    text = r.text
    rows = parse_occ_text(ticker, text)
    if not rows:
        # fallback: strip tags roughly
        plain = re.sub(r"<[^>]+>", " ", text)
        rows = parse_occ_text(ticker, plain)
    print(f"[ok] {ticker}: {len(rows)} rows")
    return rows


def load_history(path: Path) -> dict[str, Any]:
    if path.exists():
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    return {
        "ticker": path.stem,
        "closes": {},
        "days": {},  # pull_date -> { expiration -> { strike -> {call, put} } }
        "updated_at": None,
    }


def merge_day(hist: dict[str, Any], pull_date: str, rows: list[dict[str, Any]]) -> None:
    day = hist.setdefault("days", {}).setdefault(pull_date, {})
    for rec in rows:
        exp = rec["expiration"]
        strike_key = str(rec["strike"])
        day.setdefault(exp, {})[strike_key] = {
            "call_oi": rec["call_oi"],
            "put_oi": rec["put_oi"],
        }



def prune_old_days(hist: dict[str, Any], keep_days: int = RETENTION_DAYS) -> int:
    """يحذف أيام السحب الأقدم من keep_days يومًا (تقويمية من اليوم)."""
    days = hist.get("days") or {}
    if not days:
        return 0
    today = date.today()
    year = today.year
    removed = 0
    for key in list(days.keys()):
        try:
            d_s, m_s = key.split("-")
            d, m = int(d_s), int(m_s)
            y = year
            # عبر رأس السنة: إذا الشهر المستقبلي جدًا نسبة لليوم الحالي ننسب للسنة السابقة
            cand = date(y, m, d)
            if cand > today + __import__("datetime").timedelta(days=30):
                cand = date(y - 1, m, d)
            age = (today - cand).days
            if age > keep_days:
                del days[key]
                removed += 1
        except Exception:
            continue
    # نظّف closes المرتبطة
    closes = hist.get("closes") or {}
    for key in list(closes.keys()):
        if key not in days:
            closes.pop(key, None)
    hist["days"] = days
    hist["closes"] = closes
    return removed


def sort_pull_dates(dates: list[str], year: int | None = None) -> list[str]:
    year = year or datetime.now().year

    def key(x: str):
        try:
            d, m = x.split("-")
            return datetime(year, int(m), int(d))
        except Exception:
            return datetime.min

    # drop pure weekend labels if any slipped in
    out = []
    for x in dates:
        try:
            d, m = x.split("-")
            dt = datetime(year, int(m), int(d))
            if dt.weekday() < 5:
                out.append(x)
        except Exception:
            continue
    return sorted(set(out), key=key)


def build_public_snapshot(hist: dict[str, Any], ticker: str) -> dict[str, Any]:
    """Flatten history into a UI-friendly JSON structure."""
    year = datetime.now().year
    pull_dates = sort_pull_dates(list(hist.get("days", {}).keys()), year)
    expirations: set[str] = set()
    for day in hist.get("days", {}).values():
        expirations.update(day.keys())
    expirations_list = sorted(expirations)

    # per expiration: strikes + matrix
    by_exp: dict[str, Any] = {}
    for exp in expirations_list:
        strikes: set[float] = set()
        for pd in pull_dates:
            block = hist["days"].get(pd, {}).get(exp, {})
            for sk in block.keys():
                try:
                    strikes.add(float(sk))
                except Exception:
                    pass
        strike_list = sorted(strikes)
        matrix = []
        for strike in strike_list:
            sk = str(strike) if not float(strike).is_integer() else str(int(strike))
            # also try float string variants
            candidates = {sk, str(strike), f"{strike:.1f}", f"{strike:.0f}"}
            row = {"strike": strike, "calls": [], "puts": []}
            for pd in pull_dates:
                block = hist["days"].get(pd, {}).get(exp, {})
                cell = None
                for c in candidates:
                    if c in block:
                        cell = block[c]
                        break
                if cell is None:
                    # try float match
                    for k, v in block.items():
                        try:
                            if abs(float(k) - strike) < 1e-6:
                                cell = v
                                break
                        except Exception:
                            pass
                if cell is None:
                    row["calls"].append(0)
                    row["puts"].append(0)
                else:
                    row["calls"].append(int(cell.get("call_oi") or 0))
                    row["puts"].append(int(cell.get("put_oi") or 0))
            matrix.append(row)
        by_exp[exp] = {"strikes": strike_list, "rows": matrix}

    close = None
    closes = hist.get("closes") or {}
    if pull_dates and pull_dates[-1] in closes:
        close = closes[pull_dates[-1]]
    elif closes:
        close = list(closes.values())[-1]

    return {
        "ticker": ticker,
        "pull_dates": pull_dates,
        "expirations": expirations_list,
        "close": close,
        "by_expiration": by_exp,
        "updated_at": hist.get("updated_at"),
    }



def third_friday(year: int, month: int) -> date:
    d = date(year, month, 1)
    # first Friday
    while d.weekday() != 4:
        d += timedelta(days=1)
    return d + timedelta(days=14)


def next_friday_on_or_after(d: date) -> date:
    while d.weekday() != 4:
        d += timedelta(days=1)
    return d


def pick_expiration(available: list[str], target: date) -> str | None:
    """Nearest expiration on or after target; else closest overall."""
    parsed = []
    for e in available:
        try:
            parsed.append((datetime.strptime(e, "%Y-%m-%d").date(), e))
        except Exception:
            continue
    if not parsed:
        return None
    on_or_after = [p for p in parsed if p[0] >= target]
    if on_or_after:
        on_or_after.sort(key=lambda x: x[0])
        return on_or_after[0][1]
    parsed.sort(key=lambda x: abs((x[0] - target).days))
    return parsed[0][1]


def max_oi_levels_for_exp(hist: dict[str, Any], exp: str, pull_date: str) -> dict[str, Any]:
    """Highest put_oi strike = support, highest call_oi strike = resistance for one expiration."""
    block = (hist.get("days") or {}).get(pull_date, {}).get(exp) or {}
    if not block:
        # fallback: search latest pull_date that has this exp
        for pd in reversed(sort_pull_dates(list((hist.get("days") or {}).keys()))):
            block = (hist.get("days") or {}).get(pd, {}).get(exp) or {}
            if block:
                pull_date = pd
                break
    max_put_s, max_put_v = None, -1
    max_call_s, max_call_v = None, -1
    for sk, cell in block.items():
        try:
            strike = float(sk)
        except Exception:
            continue
        put_v = int(cell.get("put_oi") or 0)
        call_v = int(cell.get("call_oi") or 0)
        if put_v > max_put_v:
            max_put_v, max_put_s = put_v, strike
        if call_v > max_call_v:
            max_call_v, max_call_s = call_v, strike
    return {
        "exp": exp,
        "pull_date": pull_date,
        "support": max_put_s,   # قاع = أعلى Put
        "resistance": max_call_s,  # قمة = أعلى Call
        "support_oi": max_put_v if max_put_s is not None else None,
        "resistance_oi": max_call_v if max_call_s is not None else None,
    }


def build_levels_for_ticker(hist: dict[str, Any], ticker: str, pull_date: str, close: float | None) -> dict[str, Any]:
    """Daily / weekly / OPX / next OPX walls from max OI + close path history."""
    year = datetime.now().year
    today = date.today()
    # all expirations known
    available: set[str] = set()
    for day in (hist.get("days") or {}).values():
        available.update(day.keys())
    avail = sorted(available)

    daily_exp = pick_expiration(avail, today)
    weekly_exp = pick_expiration(avail, next_friday_on_or_after(today))
    opx_date = third_friday(today.year, today.month)
    if opx_date < today:
        # next month
        m = today.month + 1
        y = today.year
        if m > 12:
            m, y = 1, y + 1
        opx_date = third_friday(y, m)
    opx_exp = pick_expiration(avail, opx_date)
    # next month third friday
    m2 = opx_date.month + 1
    y2 = opx_date.year
    if m2 > 12:
        m2, y2 = 1, y2 + 1
    next_opx_date = third_friday(y2, m2)
    next_opx_exp = pick_expiration(avail, next_opx_date)

    def safe_levels(exp):
        if not exp:
            return {"exp": None, "support": None, "resistance": None}
        return max_oi_levels_for_exp(hist, exp, pull_date)

    # price path from closes (phase 3)
    closes = hist.get("closes") or {}
    path = []
    for pd in sort_pull_dates(list(closes.keys()), year):
        try:
            path.append({"date": pd, "close": float(closes[pd])})
        except Exception:
            pass

    return {
        "ticker": ticker,
        "close": close,
        "as_of": pull_date,
        "updated_at": hist.get("updated_at"),
        "daily": safe_levels(daily_exp),
        "weekly": safe_levels(weekly_exp),
        "opx": safe_levels(opx_exp),
        "next_opx": safe_levels(next_opx_exp),
        "path": path[-30:],  # last ~30 sessions
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    levels_all: dict[str, Any] = {}
    pull_date, pull_day = session_pull_date()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"session column: {pull_date} ({pull_day})")

    index = {
        "generated_at": now,
        "session_pull_date": pull_date,
        "tickers": [],
    }

    for ticker, url in TICKER_URLS.items():
        hist_path = DATA_DIR / f"{ticker}_history.json"
        pub_path = DATA_DIR / f"{ticker}.json"
        hist = load_history(hist_path)
        hist["ticker"] = ticker

        try:
            rows = download_ticker(ticker, url)
        except Exception as e:
            print(f"[error] {ticker}: {e}", file=sys.stderr)
            # still publish last known snapshot if any
            if pub_path.exists():
                index["tickers"].append(ticker)
            continue

        if not rows:
            print(f"[warn] {ticker}: zero rows", file=sys.stderr)
        else:
            merge_day(hist, pull_date, rows)
        pruned = prune_old_days(hist)
        if pruned:
            print(f"[prune] {ticker}: removed {pruned} day(s) older than {RETENTION_DAYS}d")

        close = get_close(ticker)
        if close is not None:
            hist.setdefault("closes", {})[pull_date] = close

        hist["updated_at"] = now
        with hist_path.open("w", encoding="utf-8") as f:
            json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

        snap = build_public_snapshot(hist, ticker)
        with pub_path.open("w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))

        levels_all[ticker] = build_levels_for_ticker(hist, ticker, pull_date, close)
        index["tickers"].append(ticker)
        print(f"[saved] {pub_path.name} days={len(snap['pull_dates'])} exps={len(snap['expirations'])}")

    with (DATA_DIR / "index.json").open("w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    with (DATA_DIR / "levels.json").open("w", encoding="utf-8") as f:
        json.dump({"updated_at": datetime.utcnow().isoformat() + "Z", "tickers": levels_all}, f, ensure_ascii=False, indent=2)
    print("[saved] levels.json")

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
