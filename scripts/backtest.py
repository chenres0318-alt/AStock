#!/usr/bin/env python3
"""Compare daily T+1 A-share strategies on 2010-2015 and 2020-2026.

Prices are Tencent unadjusted (bfq) OHLC, stitched by date without rescaling.
Cash dividends are not added back, so long holds are slightly understated.
Not investment advice.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(__file__).resolve().parent / ".cache" / "bfq"
OUT_JSON = ROOT / "src" / "data" / "backtest.json"

UNIVERSE = [
    ("sh600519", "贵州茅台"),
    ("sz000858", "五粮液"),
    ("sz000568", "泸州老窖"),
    ("sz000002", "万科A"),
    ("sh600036", "招商银行"),
    ("sh601318", "中国平安"),
    ("sz000001", "平安银行"),
    ("sh600000", "浦发银行"),
    ("sh600030", "中信证券"),
    ("sz000063", "中兴通讯"),
    ("sh600276", "恒瑞医药"),
    ("sz000651", "格力电器"),
    ("sh601166", "兴业银行"),
    ("sh600887", "伊利股份"),
    ("sz002304", "洋河股份"),
    ("sh600009", "上海机场"),
    ("sh600585", "海螺水泥"),
    ("sh601088", "中国神华"),
    ("sh600019", "宝钢股份"),
    ("sz000725", "京东方A"),
    ("sh600104", "上汽集团"),
    ("sz000338", "潍柴动力"),
    ("sh600031", "三一重工"),
    ("sh601398", "工商银行"),
    ("sh601939", "建设银行"),
    ("sh600660", "福耀玻璃"),
    ("sh600048", "保利发展"),
    ("sz000895", "双汇发展"),
    ("sh600016", "民生银行"),
    ("sz000157", "中联重科"),
    ("sh600050", "中国联通"),
    ("sz000100", "TCL科技"),
    ("sh600028", "中国石化"),
    ("sh601857", "中国石油"),
    ("sz002142", "宁波银行"),
    ("sh600690", "海尔智家"),
]
INDEX = ("sh000300", "沪深300")
ENDS = [
    "2010-06-30",
    "2011-12-31",
    "2013-06-30",
    "2014-12-31",
    "2016-06-30",
    "2017-12-31",
    "2019-06-30",
    "2020-12-31",
    "2022-06-30",
    "2023-12-31",
    "2025-06-30",
    "2026-09-23",
]
PERIODS = {
    "2010-2015": ("2010-01-01", "2015-12-31"),
    "2020-2026": ("2020-01-01", "2026-09-23"),
}
COMMISSION = 0.00025
STAMP = 0.001
SLIP = 0.001
CASH0 = 200_000.0
MAX_JUMP = 0.15
MAX_JUMP_COUNT = 12
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
CACHE_LOCK = Lock()


@dataclass
class Bar:
    day: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Position:
    code: str
    shares: float
    entry: float
    entry_day: str
    stop: float | None = None
    take: float | None = None
    hold_left: int | None = None
    lot: int = 100


@dataclass
class Trade:
    code: str
    day: str
    ret: float
    reason: str


def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://gu.qq.com/"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_chunk(code: str, end: str) -> list:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"{code}_{end}.json"
    with CACHE_LOCK:
        if key.exists() and key.stat().st_size > 2:
            return json.loads(key.read_text())
    last_err: Exception | None = None
    for attempt in range(4):
        try:
            url = (
                "https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get"
                f"?param={code},day,2000-01-01,{end},640,bfq"
            )
            data = http_json(url)
            node = (data.get("data") or {}).get(code) or {}
            rows = node.get("day") or node.get("qfqday") or []
            with CACHE_LOCK:
                key.write_text(json.dumps(rows, ensure_ascii=False))
            return rows
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
            last_err = exc
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError(f"{code} {end}: {last_err}")


def parse_rows(raw: list) -> dict[str, Bar]:
    out: dict[str, Bar] = {}
    for row in raw:
        if not isinstance(row, list) or len(row) < 6:
            continue
        day = str(row[0])[:10]
        try:
            o, c, h, l = float(row[1]), float(row[2]), float(row[3]), float(row[4])
            v = float(row[5])
        except (TypeError, ValueError):
            continue
        if min(o, c, h, l) <= 0:
            continue
        out[day] = Bar(day, o, h, l, c, v)
    return out


def load_symbol(code: str) -> list[Bar]:
    merged: dict[str, Bar] = {}
    for end in reversed(ENDS):
        chunk = parse_rows(fetch_chunk(code, end))
        for day, bar in chunk.items():
            if day not in merged:
                merged[day] = bar
    return [merged[k] for k in sorted(merged)]


def jump_count(rows: list[Bar], start: str, end: str) -> int:
    n = 0
    prev: Bar | None = None
    for bar in rows:
        if bar.day < start or bar.day > end:
            continue
        if prev and prev.close > 0:
            ret = bar.close / prev.close - 1
            if abs(ret) >= MAX_JUMP:
                n += 1
        prev = bar
    return n


def ema(vals: list[float], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(vals)
    if len(vals) < n:
        return out
    k = 2 / (n + 1)
    prev = sum(vals[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(vals)):
        prev = vals[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def sma(vals: list[float], n: int, i: int) -> float | None:
    if i < n - 1 or i >= len(vals):
        return None
    return sum(vals[i - n + 1 : i + 1]) / n


def macd_series(closes: list[float]) -> list[tuple[float, float, float] | None]:
    e12 = ema(closes, 12)
    e26 = ema(closes, 26)
    difs: list[float] = []
    idx: list[int] = []
    for j, _close in enumerate(closes):
        if e12[j] is None or e26[j] is None:
            continue
        difs.append(e12[j] - e26[j])  # type: ignore[operator]
        idx.append(j)
    dea = ema(difs, 9)
    out: list[tuple[float, float, float] | None] = [None] * len(closes)
    for j, dif in enumerate(difs):
        if dea[j] is None:
            continue
        out[idx[j]] = (dif, dea[j], 2 * (dif - dea[j]))  # type: ignore[arg-type]
    return out


def first_stand(closes: list[float], i: int) -> bool:
    if i < 12:
        return False
    cur_ma = sma(closes, 5, i)
    if cur_ma is None or closes[i] <= cur_ma:
        return False
    above = 0
    k = i
    while k >= 4:
        m = sma(closes, 5, k)
        if m is None or closes[k] <= m:
            break
        above += 1
        k -= 1
    if above < 1 or above > 3:
        return False
    below = 0
    while k >= 4:
        m = sma(closes, 5, k)
        if m is None or closes[k] > m:
            break
        below += 1
        k -= 1
    return below >= 3


def atr(rows: list[Bar], i: int, n: int = 14) -> float | None:
    if i < n:
        return None
    total = 0.0
    for j in range(i - n + 1, i + 1):
        prev = rows[j - 1].close
        tr = max(rows[j].high - rows[j].low, abs(rows[j].high - prev), abs(rows[j].low - prev))
        total += tr
    return total / n


def trade_cost(notional: float, selling: bool) -> float:
    fee = max(5.0, abs(notional) * COMMISSION)
    if selling:
        fee += abs(notional) * STAMP
    return fee


def median(xs: list[float]) -> float | None:
    if not xs:
        return None
    return statistics.median(xs)


def max_drawdown(curve: list[float]) -> float:
    peak = curve[0] if curve else 0.0
    dd = 0.0
    for value in curve:
        peak = max(peak, value)
        if peak > 0:
            dd = min(dd, value / peak - 1)
    return dd


def cagr(total_ret: float, start: str, end: str) -> float:
    d0 = datetime.strptime(start, "%Y-%m-%d")
    d1 = datetime.strptime(end, "%Y-%m-%d")
    years = max((d1 - d0).days / 365.25, 1 / 12)
    if 1 + total_ret <= 0:
        return -1.0
    return (1 + total_ret) ** (1 / years) - 1


def payoff_from_rets(rets: list[float]) -> float | None:
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r < 0]
    if not wins and not losses:
        return None
    if not losses:
        return 9.99
    if not wins:
        return 0.0
    return (sum(wins) / len(wins)) / (abs(sum(losses) / len(losses)))


def month_key(day: str) -> str:
    return day[:7]


@dataclass
class EngineResult:
    end_equity: float
    total_return: float
    cagr: float
    max_drawdown: float
    payoff: float | None
    win_rate: float | None
    trades: int
    calmar: float
    monthly: list[float]
    best_month: float | None
    worst_month: float | None
    median_month: float | None
    curve: list[tuple[str, float]] = field(default_factory=list)


class Portfolio:
    def __init__(self, lot_by_code: dict[str, int]):
        self.cash = CASH0
        self.positions: dict[str, Position] = {}
        self.trades: list[Trade] = []
        self.lot_by_code = lot_by_code

    def equity(self, px: dict[str, float]) -> float:
        total = self.cash
        for pos in self.positions.values():
            total += pos.shares * px.get(pos.code, pos.entry)
        return total

    def sell(self, code: str, price: float, day: str, reason: str) -> None:
        pos = self.positions.pop(code, None)
        if pos is None:
            return
        px = max(price, 0.01)
        notional = pos.shares * px
        self.cash += notional - trade_cost(notional, True)
        self.trades.append(Trade(code, day, px / pos.entry - 1, reason))

    def buy(self, code: str, price: float, day: str, budget: float, stop: float | None, take: float | None, hold_left: int | None) -> bool:
        if code in self.positions or budget <= 0 or price <= 0:
            return False
        px = price * (1 + SLIP)
        lot = self.lot_by_code.get(code, 100)
        if lot <= 1:
            shares = math.floor(budget / px * 100) / 100
        else:
            shares = math.floor(budget / px / lot) * lot
        if shares <= 0:
            return False
        notional = shares * px
        fee = trade_cost(notional, False)
        if self.cash < notional + fee:
            shares = math.floor((self.cash - 5) / px / max(lot, 1)) * max(lot, 1) if lot > 1 else math.floor((self.cash - 5) / px * 100) / 100
            if shares <= 0:
                return False
            notional = shares * px
            fee = trade_cost(notional, False)
            if self.cash < notional + fee:
                return False
        self.cash -= notional + fee
        self.positions[code] = Position(code, shares, px, day, stop, take, hold_left, lot)
        return True


def calendar_days(bars_map: dict[str, list[Bar]], start: str, end: str) -> list[str]:
    days = {bar.day for rows in bars_map.values() for bar in rows if start <= bar.day <= end}
    return sorted(days)


def index_map(rows: list[Bar]) -> dict[str, int]:
    return {bar.day: i for i, bar in enumerate(rows)}


def last_px(rows: list[Bar], loc: dict[str, int], day: str, fallback: float) -> float:
    i = loc.get(day)
    if i is not None:
        return rows[i].close
    # halt: walk back
    keys = [d for d in loc if d <= day]
    if not keys:
        return fallback
    return rows[loc[max(keys)]].close


def manage_stops(port: Portfolio, bars_map: dict[str, list[Bar]], loc: dict[str, dict[str, int]], day: str) -> None:
    for code in list(port.positions):
        pos = port.positions[code]
        i = loc[code].get(day)
        if i is None:
            continue
        bar = bars_map[code][i]
        if bar.day <= pos.entry_day:
            continue
        o = bar.open * (1 - SLIP)
        if pos.hold_left is not None:
            pos.hold_left -= 1
        # gap through levels at open
        if pos.stop is not None and bar.open <= pos.stop:
            port.sell(code, o, day, "止损")
            continue
        if pos.take is not None and bar.open >= pos.take:
            port.sell(code, bar.open * (1 - SLIP), day, "止盈")
            continue
        stop_hit = pos.stop is not None and bar.low <= pos.stop
        take_hit = pos.take is not None and bar.high >= pos.take
        if stop_hit and take_hit:
            port.sell(code, pos.stop or o, day, "止损")
            continue
        if stop_hit:
            port.sell(code, pos.stop or o, day, "止损")
            continue
        if take_hit:
            port.sell(code, pos.take or o, day, "止盈")
            continue
        if pos.hold_left is not None and pos.hold_left <= 0:
            port.sell(code, o, day, "到期清仓")


def summarize(port: Portfolio, curve: list[tuple[str, float]], start: str, end: str, monthly_payoff: bool) -> EngineResult:
    if curve:
        end_eq = curve[-1][1]
    else:
        end_eq = port.cash
    total_ret = end_eq / CASH0 - 1
    dd = max_drawdown([v for _, v in curve]) if curve else 0.0
    cg = cagr(total_ret, start, end)
    by_month: dict[str, float] = {}
    for day, eq in curve:
        by_month[month_key(day)] = eq
    monthly: list[float] = []
    prev: float | None = None
    for mk in sorted(by_month):
        if prev:
            monthly.append(by_month[mk] / prev - 1)
        prev = by_month[mk]
    trade_rets = [t.ret for t in port.trades]
    if monthly_payoff or len(trade_rets) < 5:
        payoff = payoff_from_rets(monthly)
        win_rate = (sum(1 for r in monthly if r > 0) / len(monthly)) if monthly else None
    else:
        payoff = payoff_from_rets(trade_rets)
        win_rate = (sum(1 for r in trade_rets if r > 0) / len(trade_rets)) if trade_rets else None
    calmar = cg / abs(dd) if dd < 0 else (cg if cg > 0 else 0.0)
    return EngineResult(
        end_equity=end_eq,
        total_return=total_ret,
        cagr=cg,
        max_drawdown=dd,
        payoff=payoff,
        win_rate=win_rate,
        trades=len(trade_rets),
        calmar=calmar,
        monthly=monthly,
        best_month=max(monthly) if monthly else None,
        worst_month=min(monthly) if monthly else None,
        median_month=median(monthly),
        curve=curve,
    )


def run_hold(
    bars_map: dict[str, list[Bar]],
    start: str,
    end: str,
    codes: list[str],
    annual: bool,
    lot_by_code: dict[str, int],
) -> EngineResult:
    loc = {code: index_map(rows) for code, rows in bars_map.items()}
    cal = calendar_days(bars_map, start, end)
    port = Portfolio(lot_by_code)
    curve: list[tuple[str, float]] = []
    last_year = ""

    def rebalance(day: str) -> None:
        px = {}
        for code in list(port.positions):
            i = loc[code].get(day)
            if i is None:
                continue
            port.sell(code, bars_map[code][i].open * (1 - SLIP), day, "再平衡")
        live = []
        for code in codes:
            i = loc[code].get(day)
            if i is None:
                continue
            live.append(code)
        if not live:
            return
        budget = port.cash * 0.995 / len(live)
        for code in live:
            i = loc[code][day]
            port.buy(code, bars_map[code][i].open, day, budget, None, None, None)

    for di, day in enumerate(cal):
        year = day[:4]
        if di == 0 or (annual and year != last_year):
            rebalance(day)
            last_year = year
        px = {code: last_px(bars_map[code], loc[code], day, 0) for code in codes}
        curve.append((day, port.equity(px)))
    last = cal[-1]
    for code in list(port.positions):
        i = loc[code].get(last)
        px = bars_map[code][i].close if i is not None else port.positions[code].entry
        port.sell(code, px, last, "期末清仓")
    if curve:
        curve[-1] = (last, port.cash)
    return summarize(port, curve, start, end, monthly_payoff=True)


def run_index_ma(
    index_rows: list[Bar],
    start: str,
    end: str,
    ma_n: int,
    lot_by_code: dict[str, int],
) -> EngineResult:
    loc = index_map(index_rows)
    cal = [b.day for b in index_rows if start <= b.day <= end]
    closes = [b.close for b in index_rows]
    port = Portfolio(lot_by_code)
    curve: list[tuple[str, float]] = []
    code = INDEX[0]
    for di, day in enumerate(cal):
        i = loc[day]
        if di > 0:
            prev = loc[cal[di - 1]]
            ma = sma(closes, ma_n, prev)
            in_pos = code in port.positions
            if in_pos and (ma is None or closes[prev] < ma):
                port.sell(code, index_rows[i].open * (1 - SLIP), day, "跌破均线")
            elif (not in_pos) and ma is not None and closes[prev] > ma:
                port.buy(code, index_rows[i].open, day, port.cash * 0.995, None, None, None)
        px = {code: index_rows[i].close}
        curve.append((day, port.equity(px)))
    last = cal[-1]
    if code in port.positions:
        port.sell(code, index_rows[loc[last]].close, last, "期末清仓")
        curve[-1] = (last, port.cash)
    return summarize(port, curve, start, end, monthly_payoff=True)


def run_index_dual(
    index_rows: list[Bar],
    start: str,
    end: str,
    lot_by_code: dict[str, int],
) -> EngineResult:
    loc = index_map(index_rows)
    cal = [b.day for b in index_rows if start <= b.day <= end]
    closes = [b.close for b in index_rows]
    port = Portfolio(lot_by_code)
    curve: list[tuple[str, float]] = []
    code = INDEX[0]
    for di, day in enumerate(cal):
        i = loc[day]
        if di > 0:
            prev = loc[cal[di - 1]]
            m20 = sma(closes, 20, prev)
            m60 = sma(closes, 60, prev)
            bull = m20 is not None and m60 is not None and m20 > m60 and closes[prev] > m60
            in_pos = code in port.positions
            if in_pos and not bull:
                port.sell(code, index_rows[i].open * (1 - SLIP), day, "双均线转空")
            elif (not in_pos) and bull:
                port.buy(code, index_rows[i].open, day, port.cash * 0.995, None, None, None)
        px = {code: index_rows[i].close}
        curve.append((day, port.equity(px)))
    last = cal[-1]
    if code in port.positions:
        port.sell(code, index_rows[loc[last]].close, last, "期末清仓")
        curve[-1] = (last, port.cash)
    return summarize(port, curve, start, end, monthly_payoff=True)


def run_monthly_picks(
    bars_map: dict[str, list[Bar]],
    start: str,
    end: str,
    lot_by_code: dict[str, int],
    picker,
    max_pos: int,
) -> EngineResult:
    loc = {code: index_map(rows) for code, rows in bars_map.items()}
    cal = calendar_days(bars_map, start, end)
    port = Portfolio(lot_by_code)
    curve: list[tuple[str, float]] = []
    for di, day in enumerate(cal):
        if di > 0:
            prev = cal[di - 1]
            new_month = day[:7] != prev[:7]
            if new_month:
                for code in list(port.positions):
                    i = loc[code].get(day)
                    if i is None:
                        continue
                    port.sell(code, bars_map[code][i].open * (1 - SLIP), day, "月度再平衡")
                picks = picker(prev, loc, bars_map)[:max_pos]
                if picks:
                    budget = port.cash * 0.995 / len(picks)
                    for code in picks:
                        i = loc[code].get(day)
                        if i is None:
                            continue
                        port.buy(code, bars_map[code][i].open, day, budget, None, None, None)
        px = {code: last_px(rows, loc[code], day, 0) for code, rows in bars_map.items()}
        curve.append((day, port.equity(px)))
    last = cal[-1]
    for code in list(port.positions):
        i = loc[code].get(last)
        pxv = bars_map[code][i].close if i is not None else port.positions[code].entry
        port.sell(code, pxv, last, "期末清仓")
    if curve:
        curve[-1] = (last, port.cash)
    return summarize(port, curve, start, end, monthly_payoff=False)


def run_event(
    bars_map: dict[str, list[Bar]],
    start: str,
    end: str,
    lot_by_code: dict[str, int],
    signal_fn,
    max_pos: int,
    stop_pct: float | None,
    take_pct: float | None,
    max_hold: int | None,
    ma_exit: int | None,
) -> EngineResult:
    loc = {code: index_map(rows) for code, rows in bars_map.items()}
    cal = calendar_days(bars_map, start, end)
    port = Portfolio(lot_by_code)
    curve: list[tuple[str, float]] = []
    signals = {code: signal_fn(code, rows) for code, rows in bars_map.items()}

    for di, day in enumerate(cal):
        if di > 0:
            # rule exits from yesterday close
            prev = cal[di - 1]
            for code in list(port.positions):
                pos = port.positions[code]
                i_prev = loc[code].get(prev)
                i_today = loc[code].get(day)
                if i_prev is None or i_today is None or bars_map[code][i_today].day <= pos.entry_day:
                    continue
                rows = bars_map[code]
                closes = [b.close for b in rows]
                reason = None
                if ma_exit:
                    m = sma(closes, ma_exit, i_prev)
                    if m is not None and closes[i_prev] < m:
                        reason = f"跌破{ma_exit}日线"
                if reason:
                    port.sell(code, rows[i_today].open * (1 - SLIP), day, reason)
            manage_stops(port, bars_map, loc, day)
            candidates: list[tuple[float, str]] = []
            for code, rows in bars_map.items():
                if code in port.positions:
                    continue
                i_prev = loc[code].get(prev)
                i_today = loc[code].get(day)
                if i_prev is None or i_today is None:
                    continue
                scored = signals[code][i_prev]
                if scored is None:
                    continue
                candidates.append((scored, code))
            slots = max_pos - len(port.positions)
            if slots > 0 and candidates:
                candidates.sort(reverse=True)
                pick = candidates[:slots]
                equity = port.equity({c: last_px(bars_map[c], loc[c], prev, 0) for c in bars_map})
                budget = min(port.cash * 0.98, equity / max_pos)
                for _score, code in pick:
                    i_today = loc[code][day]
                    bar = bars_map[code][i_today]
                    stop = bar.open * (1 + SLIP) * (1 + stop_pct) if stop_pct is not None else None
                    take = bar.open * (1 + SLIP) * (1 + take_pct) if take_pct is not None else None
                    # stop_pct is negative
                    if stop_pct is not None:
                        stop = bar.open * (1 + SLIP) * (1 + stop_pct)
                    port.buy(code, bar.open, day, budget, stop, take, max_hold)
        px = {code: last_px(rows, loc[code], day, 0) for code, rows in bars_map.items()}
        curve.append((day, port.equity(px)))
    last = cal[-1]
    for code in list(port.positions):
        i = loc[code].get(last)
        pxv = bars_map[code][i].close if i is not None else port.positions[code].entry
        port.sell(code, pxv, last, "期末清仓")
    if curve:
        curve[-1] = (last, port.cash)
    return summarize(port, curve, start, end, monthly_payoff=False)


def screener_signal(golden_only: bool):
    def fn(_code: str, rows: list[Bar]) -> list[float | None]:
        closes = [b.close for b in rows]
        macds = macd_series(closes)
        out: list[float | None] = [None] * len(rows)
        for i in range(40, len(rows)):
            if not first_stand(closes, i):
                continue
            if i < 3 or closes[i - 3] <= 0:
                continue
            if (closes[i] / closes[i - 3] - 1) * 100 > 5:
                continue
            macd = macds[i]
            if macd is None:
                continue
            dif, dea, _hist = macd
            if closes[i] <= 0 or dif == dea:
                continue
            if max(abs(dif), abs(dea)) / closes[i] * 100 > 2:
                continue
            golden = dif > dea
            death = dif < dea
            if golden_only and not golden:
                continue
            if not golden_only and not (golden or death):
                continue
            m5 = sma(closes, 5, i) or closes[i]
            # smaller stand margin = more "just started"
            out[i] = -(closes[i] / m5 - 1)
        return out

    return fn


def dual_ma_signal(_code: str, rows: list[Bar]) -> list[float | None]:
    closes = [b.close for b in rows]
    out: list[float | None] = [None] * len(rows)
    for i in range(60, len(rows)):
        m20 = sma(closes, 20, i)
        m60 = sma(closes, 60, i)
        p20 = sma(closes, 20, i - 1)
        p60 = sma(closes, 60, i - 1)
        if None in (m20, m60, p20, p60):
            continue
        if p20 <= p60 and m20 > m60:  # type: ignore[operator]
            out[i] = m20 / m60 - 1  # type: ignore[operator]
    return out


def donchian_signal(_code: str, rows: list[Bar]) -> list[float | None]:
    out: list[float | None] = [None] * len(rows)
    for i in range(30, len(rows)):
        prior_high = max(b.high for b in rows[i - 20 : i])
        if rows[i].close > prior_high:
            atr_v = atr(rows, i)
            if atr_v and atr_v > 0:
                out[i] = (rows[i].close - prior_high) / atr_v
            else:
                out[i] = rows[i].close / prior_high - 1
    return out


def ma20_signal(_code: str, rows: list[Bar]) -> list[float | None]:
    closes = [b.close for b in rows]
    out: list[float | None] = [None] * len(rows)
    for i in range(25, len(rows)):
        m = sma(closes, 20, i)
        p = sma(closes, 20, i - 1)
        if m is None or p is None:
            continue
        if closes[i - 1] <= p and closes[i] > m:
            out[i] = closes[i] / m - 1
    return out


def pick_mom20(day: str, loc: dict[str, dict[str, int]], bars_map: dict[str, list[Bar]]) -> list[str]:
    scored: list[tuple[float, str]] = []
    for code, rows in bars_map.items():
        i = loc[code].get(day)
        if i is None or i < 20:
            continue
        prev = rows[i - 20].close
        if prev <= 0:
            continue
        scored.append((rows[i].close / prev - 1, code))
    scored.sort(reverse=True)
    return [code for _s, code in scored]


def pick_lowvol(day: str, loc: dict[str, dict[str, int]], bars_map: dict[str, list[Bar]]) -> list[str]:
    scored: list[tuple[float, str]] = []
    for code, rows in bars_map.items():
        i = loc[code].get(day)
        if i is None or i < 60:
            continue
        rets: list[float] = []
        for j in range(i - 59, i + 1):
            if rows[j - 1].close <= 0:
                continue
            rets.append(rows[j].close / rows[j - 1].close - 1)
        if len(rets) < 40:
            continue
        scored.append((statistics.pstdev(rets), code))
    scored.sort()
    return [code for _vol, code in scored]


def pick_ma60(day: str, loc: dict[str, dict[str, int]], bars_map: dict[str, list[Bar]]) -> list[str]:
    scored: list[tuple[float, str]] = []
    for code, rows in bars_map.items():
        i = loc[code].get(day)
        if i is None:
            continue
        closes = [b.close for b in rows]
        m = sma(closes, 60, i)
        if m is None or closes[i] <= m:
            continue
        scored.append((closes[i] / m - 1, code))
    scored.sort(reverse=True)
    return [code for _s, code in scored]


STRATEGIES = [
    {
        "id": "hs300_hold",
        "name": "沪深300买入持有",
        "family": "基准",
        "summary": "区间第一天买沪深300，最后一天卖出。用来对照，不是选股策略。",
        "rules": ["T+1 次日开盘建仓", "持有到区间结束", "佣金万2.5，卖出印花税千1，滑点万1"],
    },
    {
        "id": "ew36_hold",
        "name": "36只大盘股等权持有",
        "family": "基准",
        "summary": "期初把20万等权买入样本池，持有到期末。样本都是活到2026的大票，有存活偏差。",
        "rules": ["等权买入样本池", "不调仓", "忽略现金分红"],
    },
    {
        "id": "ew36_annual",
        "name": "36只大盘股年度再平衡",
        "family": "基准",
        "summary": "每年第一个交易日把持仓再平衡成等权。",
        "rules": ["每年再平衡一次等权", "最多持有全部样本"],
    },
    {
        "id": "banks_hold",
        "name": "银行股等权持有",
        "family": "基准",
        "summary": "工行、建行、招行、兴业、浦发、民生、平安银行、宁波银行等权买入持有。",
        "rules": ["8只银行股等权", "不调仓", "忽略现金分红"],
    },
    {
        "id": "index_ma20",
        "name": "沪深300 · 20日均线择时",
        "family": "择时",
        "summary": "收盘站上20日线则次日满仓沪深300，跌破则清仓。",
        "rules": ["信号看昨日收盘相对 MA20", "次日开盘换仓"],
    },
    {
        "id": "index_ma60",
        "name": "沪深300 · 60日均线择时",
        "family": "择时",
        "summary": "收盘站上60日线则次日开盘满仓沪深300，跌破则次日开盘清仓。",
        "rules": ["信号看昨日收盘相对 MA60", "次日开盘换仓", "空仓时收益率视为0"],
    },
    {
        "id": "index_ma120",
        "name": "沪深300 · 120日均线择时",
        "family": "择时",
        "summary": "收盘站上120日线则次日满仓沪深300，跌破则清仓。换手比60日线更低。",
        "rules": ["信号看昨日收盘相对 MA120", "次日开盘换仓"],
    },
    {
        "id": "index_dual",
        "name": "沪深300 · 20/60双均线",
        "family": "择时",
        "summary": "MA20在MA60上方且收盘高于60日线时持有沪深300，否则空仓。",
        "rules": ["MA20 > MA60 且 close > MA60 才持有", "次日开盘换仓"],
    },
    {
        "id": "stock_ma60_month",
        "name": "个股站上60日线 · 月度轮动",
        "family": "趋势",
        "summary": "每月初在收盘高于60日线的股票里，选偏离均线最多的4只等权持有一个月。",
        "rules": ["close > MA60", "按 close/MA60 排序取前4", "月度再平衡"],
    },
    {
        "id": "lowvol_month",
        "name": "低波动 · 月度轮动",
        "family": "防御",
        "summary": "每月初买入近60日波动最低的4只，持有一个月。",
        "rules": ["按60日收益标准差从低到高取4只", "月度再平衡"],
    },
    {
        "id": "mom20_month",
        "name": "20日动量 · 月度轮动",
        "family": "动量",
        "summary": "每月初买入近20个交易日涨幅最大的4只，持有一个月。",
        "rules": ["按20日涨幅排序", "最多4只", "月度再平衡"],
    },
    {
        "id": "dual_ma20_60",
        "name": "20/60双均线金叉",
        "family": "趋势",
        "summary": "MA20上穿MA60次日开盘买，跌破20日线次日开盘卖。最多4只。",
        "rules": ["金叉买入", "跌破20日线卖出", "止损-8%，止盈不设", "最多4只"],
    },
    {
        "id": "donchian20",
        "name": "20日突破（海龟简化）",
        "family": "趋势",
        "summary": "收盘创20日新高次日开盘买，跌破20日线或-12%止损。最多4只。",
        "rules": ["20日高点突破", "跌破20日线离场", "止损-12%", "最多4只"],
    },
    {
        "id": "screener_v2",
        "name": "选股模块现行规则",
        "family": "短线",
        "summary": "近期首次站上5日线，MACD金叉或死叉靠近0轴，近3日涨幅≤5%。-6%止损 / +12%止盈 / 破5日线 / 最多持有8日。",
        "rules": ["首次站上MA5（1–3日，此前至少3日在下方）", "MACD靠近0轴且金叉或死叉", "3日涨幅≤5%", "止损-6% 止盈+12% 破MA5 或持有8日", "最多4只"],
    },
    {
        "id": "screener_golden",
        "name": "首次站上五日线 · 只做金叉",
        "family": "短线",
        "summary": "与现行选股相同，但只保留MACD金叉，不做死叉。",
        "rules": ["首次站上MA5", "MACD金叉且靠近0轴", "3日涨幅≤5%", "止损-6% 止盈+12% 破MA5 或持有8日"],
    },
    {
        "id": "screener_loose",
        "name": "首次站上五日线 · 放宽出场",
        "family": "短线",
        "summary": "只做金叉；止损-8%，止盈+20%，最多持有20日，不因跌破5日线离场。",
        "rules": ["首次站上MA5 + MACD金叉近0轴", "止损-8% 止盈+20%", "持有最多20日", "最多4只"],
    },
]


def result_to_dict(res: EngineResult) -> dict:
    return {
        "endEquity": round(res.end_equity, 2),
        "totalReturn": res.total_return,
        "cagr": res.cagr,
        "maxDrawdown": res.max_drawdown,
        "payoff": res.payoff,
        "winRate": res.win_rate,
        "trades": res.trades,
        "calmar": res.calmar,
        "bestMonth": res.best_month,
        "worstMonth": res.worst_month,
        "medianMonth": res.median_month,
        "monthsGe30": sum(1 for r in res.monthly if r >= 0.30),
        "monthCount": len(res.monthly),
    }


def rank_key(item: dict) -> tuple:
    score = item["score"]
    return (
        score["minCalmar"],
        score["meanPayoff"],
        score["meanCagr"],
        -abs(score["meanDrawdown"]),
    )


def pick_winner(rows: list[dict]) -> dict:
    ranked = sorted(rows, key=rank_key, reverse=True)
    win = ranked[0]
    active = [r for r in rows if r["family"] not in {"基准"}]
    best_active = sorted(active, key=rank_key, reverse=True)[0] if active else win

    def best_by(metric: str, higher: bool) -> dict:
        def mkey(item: dict) -> float:
            val = item["score"][metric]
            return val if higher else -abs(val)

        return max(rows, key=mkey)

    both_positive = [
        r
        for r in rows
        if r["periods"]["2010-2015"]["totalReturn"] > 0 and r["periods"]["2020-2026"]["totalReturn"] > 0
    ]
    payoff_w = best_by("meanPayoff", True)
    cagr_pool = both_positive or rows
    cagr_w = max(cagr_pool, key=lambda item: item["score"]["meanCagr"])
    dd_w = min(rows, key=lambda item: abs(item["score"]["meanDrawdown"]))
    return {
        "id": win["id"],
        "name": win["name"],
        "reason": (
            "两段都要看：先比两段卡玛比率里较差的那一个（年化收益/最大回撤），"
            "再比盈亏比和收益率。最大回撤是越小越好。"
        ),
        "bestActive": {"id": best_active["id"], "name": best_active["name"]},
        "bothPeriodsPositive": [{"id": r["id"], "name": r["name"]} for r in both_positive],
        "byMetric": {
            "payoff": {"id": payoff_w["id"], "name": payoff_w["name"]},
            "cagr": {"id": cagr_w["id"], "name": cagr_w["name"]},
            "drawdown": {"id": dd_w["id"], "name": dd_w["name"]},
        },
    }


def run_all(stocks: dict[str, list[Bar]], index_rows: list[Bar]) -> dict:
    lot_by_code = {code: 100 for code in stocks}
    lot_by_code[INDEX[0]] = 1
    index_map_bars = {INDEX[0]: index_rows}

    quality = []
    usable: dict[str, list[Bar]] = {}
    for code, name in UNIVERSE:
        rows = stocks[code]
        jumps_a = jump_count(rows, *PERIODS["2010-2015"])
        jumps_b = jump_count(rows, *PERIODS["2020-2026"])
        ok = jumps_a <= MAX_JUMP_COUNT and jumps_b <= MAX_JUMP_COUNT and len(rows) >= 400
        quality.append(
            {
                "code": code,
                "name": name,
                "bars": len(rows),
                "start": rows[0].day if rows else None,
                "end": rows[-1].day if rows else None,
                "jumps2010": jumps_a,
                "jumps2020": jumps_b,
                "usable": ok,
            }
        )
        if ok:
            usable[code] = rows

    strategy_rows = []
    for spec in STRATEGIES:
        period_out = {}
        sid = spec["id"]
        for label, (start, end) in PERIODS.items():
            banks = [c for c in ("sh601398", "sh601939", "sh600036", "sh601166", "sh600000", "sh600016", "sz000001", "sz002142") if c in usable]
            if sid == "hs300_hold":
                res = run_hold(index_map_bars, start, end, [INDEX[0]], False, lot_by_code)
            elif sid == "ew36_hold":
                res = run_hold(usable, start, end, list(usable), False, lot_by_code)
            elif sid == "ew36_annual":
                res = run_hold(usable, start, end, list(usable), True, lot_by_code)
            elif sid == "banks_hold":
                res = run_hold(usable, start, end, banks, False, lot_by_code)
            elif sid == "index_ma20":
                res = run_index_ma(index_rows, start, end, 20, lot_by_code)
            elif sid == "index_ma60":
                res = run_index_ma(index_rows, start, end, 60, lot_by_code)
            elif sid == "index_ma120":
                res = run_index_ma(index_rows, start, end, 120, lot_by_code)
            elif sid == "index_dual":
                res = run_index_dual(index_rows, start, end, lot_by_code)
            elif sid == "stock_ma60_month":
                res = run_monthly_picks(usable, start, end, lot_by_code, pick_ma60, 4)
            elif sid == "lowvol_month":
                res = run_monthly_picks(usable, start, end, lot_by_code, pick_lowvol, 4)
            elif sid == "mom20_month":
                res = run_monthly_picks(usable, start, end, lot_by_code, pick_mom20, 4)
            elif sid == "dual_ma20_60":
                res = run_event(usable, start, end, lot_by_code, dual_ma_signal, 4, -0.08, None, None, 20)
            elif sid == "donchian20":
                res = run_event(usable, start, end, lot_by_code, donchian_signal, 4, -0.12, None, None, 20)
            elif sid == "screener_v2":
                res = run_event(usable, start, end, lot_by_code, screener_signal(False), 4, -0.06, 0.12, 8, 5)
            elif sid == "screener_golden":
                res = run_event(usable, start, end, lot_by_code, screener_signal(True), 4, -0.06, 0.12, 8, 5)
            elif sid == "screener_loose":
                res = run_event(usable, start, end, lot_by_code, screener_signal(True), 4, -0.08, 0.20, 20, None)
            else:
                raise RuntimeError(sid)
            period_out[label] = result_to_dict(res)
            print(
                f"{sid:20s} {label}  ret={res.total_return*100:7.1f}%  "
                f"cagr={res.cagr*100:6.2f}%  dd={res.max_drawdown*100:6.1f}%  "
                f"pay={res.payoff if res.payoff is not None else float('nan'):4.2f}  "
                f"calmar={res.calmar:5.2f}  n={res.trades}"
            )

        calmar_vals = [period_out[p]["calmar"] for p in PERIODS]
        payoff_vals = [period_out[p]["payoff"] or 0.0 for p in PERIODS]
        cagr_vals = [period_out[p]["cagr"] for p in PERIODS]
        dd_vals = [period_out[p]["maxDrawdown"] for p in PERIODS]
        strategy_rows.append(
            {
                **spec,
                "periods": period_out,
                "score": {
                    "minCalmar": min(calmar_vals),
                    "meanCalmar": sum(calmar_vals) / 2,
                    "meanPayoff": sum(payoff_vals) / 2,
                    "meanCagr": sum(cagr_vals) / 2,
                    "meanDrawdown": sum(dd_vals) / 2,
                },
            }
        )

    winner = pick_winner(strategy_rows)
    return {
        "meta": {
            "cash0": CASH0,
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dataSource": "腾讯财经未复权日线 bfq，按日期拼接，不做前复权缩放",
            "universeSize": len(usable),
            "index": {"code": INDEX[0], "name": INDEX[1], "bars": len(index_rows)},
            "assumptions": [
                "A股T+1：信号看收盘，次日开盘成交，加万1滑点",
                "佣金万一2.5（最低5元），卖出印花税千分之1",
                "止损止盈用当日高低价成交；若开盘跳空穿过则按开盘",
                "同一天既触及止盈又触及止损时，按止损（更差情况）",
                "未计入分红到账，长期持有收益会被低估",
                "样本是活到2026年的大盘股，有存活者偏差",
                "不能用日线诚实回测盘中做T",
                "不是投资建议",
            ],
        },
        "periods": {k: {"start": a, "end": b} for k, (a, b) in PERIODS.items()},
        "quality": quality,
        "strategies": strategy_rows,
        "winner": winner,
    }


def self_test() -> None:
    # max drawdown
    dd = max_drawdown([100, 120, 90, 95, 80, 130])
    assert abs(dd - (80 / 120 - 1)) < 1e-9, dd
    # first stand: below MA5 then 2 days above
    closes = [10.0] * 20
    for i in range(6):
        closes.append(closes[-1] * 0.985)
    closes.append(closes[-1] * 1.02)
    closes.append(closes[-1] * 1.015)
    i = len(closes) - 1
    assert first_stand(closes, i), "expected first stand"
    # payoff
    p = payoff_from_rets([0.12, 0.08, -0.04, -0.04])
    assert p is not None and abs(p - 2.5) < 1e-9, p
    # cagr 100% in 1 year
    g = cagr(1.0, "2010-01-01", "2011-01-01")
    assert abs(g - 1.0) < 0.01, g
    # synthetic hold should be positive on an uptrend
    rows = []
    px = 10.0
    day0 = datetime(2010, 1, 4)
    for n in range(260):
        d = day0.fromordinal(day0.toordinal() + n)
        if d.weekday() >= 5:
            continue
        o = px
        px *= 1.002
        rows.append(Bar(d.strftime("%Y-%m-%d"), o, px * 1.001, o * 0.999, px, 1000))
    res = run_hold({"sh000300": rows}, rows[0].day, rows[-1].day, ["sh000300"], False, {"sh000300": 1})
    assert res.total_return > 0.2, res.total_return
    # rng seed so import is used
    random.seed(1)
    print("self-test ok")


def load_all(workers: int) -> tuple[dict[str, list[Bar]], list[Bar]]:
    codes = [code for code, _name in UNIVERSE] + [INDEX[0]]
    stocks: dict[str, list[Bar]] = {}
    index_rows: list[Bar] = []

    def job(code: str) -> tuple[str, list[Bar]]:
        return code, load_symbol(code)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(job, code) for code in codes]
        for fut in as_completed(futs):
            code, rows = fut.result()
            print(f"loaded {code} {rows[0].day if rows else '-'} -> {rows[-1].day if rows else '-'} n={len(rows)}")
            if code == INDEX[0]:
                index_rows = rows
            else:
                stocks[code] = rows
    return stocks, index_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    self_test()
    stocks, index_rows = load_all(args.workers)
    if len(index_rows) < 400:
        raise SystemExit("沪深300行情不足")
    payload = run_all(stocks, index_rows)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT_JSON)
    print("winner", payload["winner"])


if __name__ == "__main__":
    main()
