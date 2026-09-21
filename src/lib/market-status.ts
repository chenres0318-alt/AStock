import { formatClock, shanghaiParts } from "./format";
import type { MarketStatus, MarketPhase } from "./types";

export function getMarketStatus(date = new Date()): MarketStatus {
  const p = shanghaiParts(date);
  const weekday = !["Sat", "Sun"].includes(p.weekday);
  const minutes = p.hour * 60 + p.minute;
  const open = 9 * 60 + 15;
  const auctionEnd = 9 * 60 + 25;
  const amStart = 9 * 60 + 30;
  const amEnd = 11 * 60 + 30;
  const pmStart = 13 * 60;
  const pmEnd = 15 * 60;

  let phase: MarketPhase = "closed";
  if (!weekday) {
    phase = "closed";
  } else if (minutes >= open && minutes < auctionEnd) {
    phase = "auction";
  } else if (minutes >= auctionEnd && minutes < amStart) {
    phase = "pre";
  } else if (minutes >= amStart && minutes < amEnd) {
    phase = "trading";
  } else if (minutes >= amEnd && minutes < pmStart) {
    phase = "lunch";
  } else if (minutes >= pmStart && minutes < pmEnd) {
    phase = "trading";
  } else if (minutes >= pmEnd && minutes < pmEnd + 30) {
    phase = "post";
  }

  const labels: Record<MarketPhase, string> = {
    closed: weekday ? "已收盘" : "休市",
    pre: "开盘准备",
    auction: "集合竞价",
    trading: "交易中",
    lunch: "午间休市",
    post: "已收盘",
  };

  return {
    phase,
    label: labels[phase],
    trading: phase === "trading" || phase === "auction",
    weekday,
    serverTime: formatClock(date),
  };
}

export function pollInterval(status: MarketStatus): number {
  return status.trading ? 5000 : 20000;
}
