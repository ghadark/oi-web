#!/usr/bin/env python3
"""
Oi Web — morning OCC fetch
Pulls open interest for index + mega stocks and writes JSON snapshots
for static hosting (GitHub Pages / Cloudflare Pages).
"""

from __future__ import annotations

import math

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
# نسخة داخل web/ حتى Cloudflare Workers (assets = web) يجد JSON على /data/...
WEB_DATA_DIR = ROOT / "web" / "data"

# حذف أيام أقدم من هذا الحد (حماية حجم المستودع)
RETENTION_DAYS = 90


def _write_json(path: Path, obj: Any, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        if indent is None:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        else:
            json.dump(obj, f, ensure_ascii=False, indent=indent, allow_nan=False)


def mirror_to_web_data() -> None:
    """انسخ كل ملفات data/ → web/data/ لتوافق استضافة Cloudflare."""
    if not DATA_DIR.exists():
        return
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for src in DATA_DIR.glob("*.json"):
        dst = WEB_DATA_DIR / src.name
        dst.write_bytes(src.read_bytes())
        count += 1
    print(f"[mirror] web/data ← {count} json file(s)")

TICKER_URLS = {
    "SPY": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=spy",
    "QQQ": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=qqq",
    "IWM": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=iwm",
    "GLD": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=gld",
    "SPX": "https://marketdata.theocc.com/series-search?symbolType=U&symbol=spx",
    "NDX": "https://marketdata.theocc.com/series-search?symbolType=U&symbol=ndx",
    "AAPL": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=aapl",
    "MSFT": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=msft",
    "NVDA": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=nvda",
    "TSLA": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=tsla",
    "AMZN": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=amzn",
    "META": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=meta",
    "GOOGL": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=googl",
    "AVGO": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=avgo",
    "MSTR": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=mstr",
    "AMD": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=amd",
    "MU": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=mu",
    "COHR": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=cohr",
    "SNDK": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=sndk",
    "VOO": "https://marketdata.theocc.com/series-search?symbolType=O&symbol=voo",
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
    """
    يربط يوم التقويم بعمود جلسة تداول رسمية (Mon–Fri فقط).

    قواعد OCC / الخيارات الأمريكية:
    - السبت/الأحد: أرقام OCC المحدَّثة تخصّ **جلسة الاثنين التالية**
      (أو أول يوم تداول بعد العطلة إن وافق الاثنين عطلة).
    - الإثنين–الجمعة: نفس اليوم إن كان يوم تداول؛ وإلا أول جلسة تالية.
    - العطل الرسمية في US_MARKET_HOLIDAYS تُتخطى فلا يُنشأ لها عمود.
    """
    d = today or date.today()
    cal = d
    wd = d.weekday()  # 0=Mon … 5=Sat 6=Sun
    if wd == 5:  # Saturday → Monday (+2)
        d = d + timedelta(days=2)
    elif wd == 6:  # Sunday → Monday (+1)
        d = d + timedelta(days=1)
    while d.weekday() >= 5 or d in US_MARKET_HOLIDAYS:
        d = d + timedelta(days=1)
    label = f"{d.day}-{d.month}"
    if cal != d:
        print(
            f"[session] calendar {cal.isoformat()} (wd={cal.weekday()}) "
            f"→ trading column {label} ({d.isoformat()})"
        )
    return label, d


def last_completed_session(today: date | None = None) -> date:
    """آخر يوم تداول مكتمل قبل today (يتخطى الويكند والعطل)."""
    d = (today or date.today()) - timedelta(days=1)
    for _ in range(15):
        if d.weekday() < 5 and d not in US_MARKET_HOLIDAYS:
            return d
        d -= timedelta(days=1)
    return d

def get_close_bars(ticker: str) -> list[tuple[date, float]]:
    """
    سلسلة (تاريخ تداول ET, إغلاق) تصاعديًا.
    إذا كان آخر شريط يومي close=None نستخدم regularMarketPrice كإغلاق مؤقت لذلك اليوم
    (شائع بعد إغلاق الجلسة وقبل تسوية شريط Yahoo اليومي).
    """
    symbol_map = {
        "SPY": "SPY", "QQQ": "QQQ", "IWM": "IWM", "GLD": "GLD", "SPX": "^GSPC",
        "AAPL": "AAPL", "MSFT": "MSFT", "NVDA": "NVDA", "TSLA": "TSLA",
        "AMZN": "AMZN", "META": "META", "GOOGL": "GOOGL", "AVGO": "AVGO",
        "MSTR": "MSTR", "AMD": "AMD", "MU": "MU", "COHR": "COHR",
        "SNDK": "SNDK",
        "CRWD": "CRWD",
        "NDX": "^NDX",
        "VOO": "VOO",
    }
    symbol = symbol_map.get(ticker, ticker)
    bars: list[tuple[date, float]] = []

    def _ok(v: Any) -> float | None:
        try:
            if v is None:
                return None
            x = float(v)
            if math.isnan(x) or math.isinf(x) or x <= 0:
                return None
            return x
        except Exception:
            return None

    try:
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
    except Exception:
        ET = None

    try:
        from urllib.parse import quote
        sym_q = quote(symbol, safe="^")
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym_q}"
            f"?range=1mo&interval=1d"
        )
        r = requests.get(url, headers=HEADERS, timeout=25)
        r.raise_for_status()
        result = (r.json().get("chart") or {}).get("result") or []
        if result:
            ts = result[0].get("timestamp") or []
            quotes = (result[0].get("indicators") or {}).get("quote") or []
            closes_raw = (quotes[0].get("close") if quotes else None) or []
            meta = result[0].get("meta") or {}
            rmp = _ok(meta.get("regularMarketPrice"))
            raw_rows: list[tuple[date, float | None]] = []
            for i, tsv in enumerate(ts):
                if ET is not None:
                    d = datetime.fromtimestamp(int(tsv), tz=ET).date()
                else:
                    d = datetime.utcfromtimestamp(int(tsv)).date()
                x = _ok(closes_raw[i]) if i < len(closes_raw) else None
                raw_rows.append((d, x))
            # املأ آخر شريط الناقص بـ regularMarketPrice
            if raw_rows and raw_rows[-1][1] is None and rmp is not None:
                d_last, _ = raw_rows[-1]
                raw_rows[-1] = (d_last, rmp)
            for d, x in raw_rows:
                if x is not None:
                    bars.append((d, x))
            # احتياط إضافي من meta إن لم نجد أي شريط
            if not bars and rmp is not None:
                as_of = last_completed_session()
                bars.append((as_of, rmp))
    except Exception as e:
        print(f"[warn] yahoo bars {ticker}: {e}", file=sys.stderr)

    if not bars:
        try:
            import yfinance as yf
            hist = yf.Ticker(symbol).history(period="1mo")
            if hist is not None and not hist.empty and "Close" in hist.columns:
                for idx, row in hist.iterrows():
                    x = _ok(row["Close"])
                    if x is None:
                        continue
                    try:
                        d = idx.date() if hasattr(idx, "date") else date.fromisoformat(str(idx)[:10])
                    except Exception:
                        continue
                    bars.append((d, x))
        except Exception as e:
            print(f"[warn] yfinance bars {ticker}: {e}", file=sys.stderr)

    merged: dict[date, float] = {}
    for d, c in bars:
        merged[d] = c
    return [(d, merged[d]) for d in sorted(merged.keys())]

def get_close(ticker: str, as_of: date | None = None) -> float | None:
    """
    إغلاق آخر جلسة مكتملة في أو قبل as_of.
    as_of=None → آخر جلسة مكتملة بالنسبة لليوم الحالي.
    """
    if as_of is None:
        as_of = last_completed_session()
    bars = get_close_bars(ticker)
    if not bars:
        return None
    best = None
    for d, c in bars:
        if d <= as_of:
            best = c
    if best is not None:
        return best
    return bars[-1][1]

def _product_matches(product: str, ticker: str) -> bool:
    """SPX+SPXW · NDX+NDXP (يومي/أسبوعي/شهري PM)."""
    p = (product or "").upper().strip()
    t = (ticker or "").upper().strip()
    if t == "SPX":
        return p in ("SPX", "SPXW")
    if t == "NDX":
        return p in ("NDX", "NDXP")
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


def last_session_day(d: date) -> date:
    """آخر يوم تداول ≤ d (يتخطى ويكند + عطل)."""
    x = d
    guard = 0
    while (x.weekday() >= 5 or x in US_MARKET_HOLIDAYS) and guard < 14:
        x -= timedelta(days=1)
        guard += 1
    return x


def next_session_day(d: date) -> date:
    """Next US equity session (skip weekend + listed holidays)."""
    x = d + timedelta(days=1)
    while x.weekday() >= 5 or x in US_MARKET_HOLIDAYS:
        x += timedelta(days=1)
    return x


def first_friday_on_or_after(d: date) -> date:
    """أول جمعة تقويمية ≥ d (بدون اعتبار العطل)."""
    while d.weekday() != 4:
        d += timedelta(days=1)
    return d


def next_friday_on_or_after(d: date) -> date:
    """جمعة تداول ≥ d — إن وافقت عطلة رسمية نأخذ الجمعة التالية."""
    guard = 0
    while guard < 10:
        d = first_friday_on_or_after(d)
        if d not in US_MARKET_HOLIDAYS:
            return d
        d = d + timedelta(days=1)
        guard += 1
    return d


def weekly_friday_for(d: date) -> tuple[date, bool]:
    """
    جمعة الأسبوع لمرجع الجلسة d.
    إن كانت جمعة هذا الأسبوع عطلة → الجمعة التالية + is_next_week=True
    (للماب: تسمية «الأسبوع القادم»).
    """
    cand = first_friday_on_or_after(d)
    if cand in US_MARKET_HOLIDAYS:
        return next_friday_on_or_after(cand + timedelta(days=1)), True
    return cand, False


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



def previous_pull_date(hist: dict, pull_date: str) -> str | None:
    """أحدث pull_date أقدم من الحالي في التاريخ التراكمي."""
    ordered = sort_pull_dates(list((hist.get("days") or {}).keys()))
    if not ordered:
        return None
    if pull_date in ordered:
        idx = ordered.index(pull_date)
        return ordered[idx - 1] if idx > 0 else None
    # إن كان اليوم الجديد لم يُدرج بعد في المقارنة الداخلية
    return ordered[-1]


def max_oi_levels_for_exp(
    hist: dict[str, Any],
    exp: str,
    pull_date: str,
    *,
    allow_fallback: bool = True,
    only_on_or_before: str | None = None,
) -> dict[str, Any]:
    """قاع = أعلى Put OI، قمة = أعلى Call OI لانتهاء واحد."""
    days = hist.get("days") or {}
    block = (days.get(pull_date) or {}).get(exp) or {}
    used_pd = pull_date

    if not block and allow_fallback:
        ordered = sort_pull_dates(list(days.keys()))
        for pd in reversed(ordered):
            if only_on_or_before is not None and only_on_or_before in ordered and pd in ordered:
                if ordered.index(pd) > ordered.index(only_on_or_before):
                    continue
            cand = (days.get(pd) or {}).get(exp) or {}
            if cand:
                block = cand
                used_pd = pd
                break

    max_put_s, max_put_v = None, -1.0
    max_call_s, max_call_v = None, -1.0
    for sk, cell in (block or {}).items():
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
        "pull_date": used_pd,
        "support": max_put_s,
        "resistance": max_call_s,
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

    # —— مراجع الماب (أيام التداول Mon–Fri فقط) ——
    # نفس منطق session_pull_date لعمود الجدول:
    #   سبت/أحد → جلسة الاثنين (أرقام OCC المحدَّثة)
    #   إثنين–جمعة → نفس اليوم (مع تخطي العطل)
    # يوم بعد = أول جلسة بعد daily_ref
    # الأسبوع = جمعة ذلك الأسبوع
    _, daily_ref = session_pull_date(today)
    tomorrow_session = next_session_day(daily_ref)
    tomorrow_cal = today + timedelta(days=1)
    weekly_friday, weekly_is_next_week = weekly_friday_for(daily_ref)

    daily_exp = pick_expiration(avail, daily_ref)
    tomorrow_exp = pick_expiration(avail, tomorrow_session)
    weekly_exp = pick_expiration(avail, weekly_friday)
    # OPX = ثالث جمعة للشهر الذي تقع فيه جلسة «اليوم»؛ إن انقضت → الشهر التالي
    opx_date = third_friday(daily_ref.year, daily_ref.month)
    if opx_date < daily_ref:
        m = daily_ref.month + 1
        y = daily_ref.year
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

    prev_pd = previous_pull_date(hist, pull_date)

    def safe_levels(exp):
        if not exp:
            return {
                "exp": None, "support": None, "resistance": None,
                "prev_support": None, "prev_resistance": None,
                "prev_as_of": None,
            }
        # اليوم: يسمح بالبحث الاحتياطي دون تجاوز
        cur = max_oi_levels_for_exp(hist, exp, pull_date, allow_fallback=True)
        if prev_pd:
            # الأمس فقط — ممنوع السقوط على بيانات اليوم (سبب الأسهم المقلوبة)
            old = max_oi_levels_for_exp(
                hist, exp, prev_pd,
                allow_fallback=True,
                only_on_or_before=prev_pd,
            )
            # إذا لم توجد بيانات حقيقية ليوم prev على هذا الانتهاء → لا سهم
            old_block = ((hist.get("days") or {}).get(prev_pd) or {}).get(exp)
            if not old_block and old.get("pull_date") != prev_pd:
                cur["prev_support"] = None
                cur["prev_resistance"] = None
                cur["prev_as_of"] = None
            else:
                cur["prev_support"] = old.get("support")
                cur["prev_resistance"] = old.get("resistance")
                cur["prev_as_of"] = old.get("pull_date") or prev_pd
        else:
            cur["prev_support"] = None
            cur["prev_resistance"] = None
            cur["prev_as_of"] = None
        return cur

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
        # بكرا يندمج مع الأسبوع فقط إذا بكرا = جمعة الأسبوع (مثل الخميس→الجمعة)
        # يوم الجمعة: بكرا = الإثنين التالي — يظهر ولا يُدمج
        "tomorrow": (
            {"exp": None, "support": None, "resistance": None, "merged_into": "weekly",
             "prev_support": None, "prev_resistance": None}
            if (tomorrow_session == weekly_friday)
            else safe_levels(tomorrow_exp)
        ),
        "weekly": safe_levels(weekly_exp),
        "opx": safe_levels(opx_exp),
        "next_opx": safe_levels(next_opx_exp),
        "meta": {
            "today": today.isoformat(),
            "daily_ref": daily_ref.isoformat(),
            "tomorrow_cal": tomorrow_cal.isoformat(),
            "tomorrow_session": tomorrow_session.isoformat(),
            "weekly_friday": weekly_friday.isoformat(),
            "today_is_weekly": (daily_ref == weekly_friday),
            "tomorrow_merged_weekly": (tomorrow_session == weekly_friday),
            "weekly_is_next_week": weekly_is_next_week,
        },
        "path": path[-30:],
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
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

        # إغلاق آخر جلسة مكتملة (مثل الخاص) — ليس بالضرورة عمود session اليوم
        session_for_close = last_completed_session(date.today())
        close = get_close(ticker, as_of=session_for_close)
        print(f"[close] {ticker} as_of={session_for_close} → {close}")
        closes_map = hist.setdefault("closes", {})
        if close is not None and not (isinstance(close, float) and (math.isnan(close) or math.isinf(close))):
            close = float(close)
            close_label = f"{session_for_close.day}-{session_for_close.month}"
            closes_map[close_label] = close
            # اربط أيضًا بعمود الجلسة الحالي إن وُجد سحب لنفس اليوم
            closes_map[pull_date] = close
        else:
            close = closes_map.get(pull_date) or (list(closes_map.values())[-1] if closes_map else None)

        hist["updated_at"] = now
        _write_json(hist_path, hist)

        snap = build_public_snapshot(hist, ticker)
        _write_json(pub_path, snap)

        levels_all[ticker] = build_levels_for_ticker(hist, ticker, pull_date, close)
        index["tickers"].append(ticker)
        print(f"[saved] {pub_path.name} days={len(snap['pull_dates'])} exps={len(snap['expirations'])}")

    _write_json(DATA_DIR / "index.json", index, indent=2)
    _write_json(
        DATA_DIR / "levels.json",
        {"updated_at": datetime.utcnow().isoformat() + "Z", "tickers": levels_all},
        indent=2,
    )
    print("[saved] levels.json")

    # مهم لـ Cloudflare: نفس الملفات تحت web/data
    mirror_to_web_data()

    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
