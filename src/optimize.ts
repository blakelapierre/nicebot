/**
 * Split each algorithm's book across coins, then spend BTC from the top of the ROI list.
 * One algorithm is one book. A coin never receives more than maxNetworkFraction of its nethash.
 */

import type { BotConfig } from './config.ts';
import {
  type BookOrder,
  type CoinStats,
  type MarketUnits,
  describeBook,
  quoteSlice,
  revenuePerPriceUnit,
  type SliceQuote,
} from './roi.ts';

export interface PoolRef {
  tag: string;
  poolId: string;
}

export interface CoinCandidate extends CoinStats {
  nicehashAlgorithm: string;
  pool?: PoolRef;
  /** Consecutive cycles this coin has cleared the ROI gate. */
  cyclesAboveGate?: number;
}

export interface LiveOrder {
  id: string;
  algorithm: string;
  market: string;
  coin: string;
  price: number;
  /** Limit in market-factor units (GH for NexaPow, TH for KawPow). */
  limit: number;
  acceptedSpeed: number;
  workers?: number;
  btcRemaining?: number;
  createdAt?: number;
  /** When ROI for this coin last fell to the gate or below. */
  belowSince?: number;
  poolId?: string;
}

export interface DesiredOrder {
  algorithm: string;
  market: string;
  coin: string;
  price: number;
  limit: number;
  poolId: string;
  hashes: number;
  spendBtcPerDay: number;
  roi: number;
  roiBeforeFee: number;
  networkFraction: number;
}

export type OrderAction =
  | { op: 'create'; order: DesiredOrder }
  | { op: 'updatePriceAndLimit'; id: string; order: DesiredOrder; reason: string }
  | { op: 'setMinLimit'; id: string; limit: number; reason: string }
  | { op: 'delete'; id: string; reason: string }
  | { op: 'hold'; id: string };

export interface PlanInput {
  coins: CoinCandidate[];
  books: Record<string, { units: MarketUnits; orders: BookOrder[] }>;
  /** BTC that can be committed today: free NiceHash BTC plus BTC already in flight to it. */
  spendableBtc: number;
  market?: string;
}

export interface Plan {
  desired: DesiredOrder[];
  /** Coins that cleared the gate but were skipped, with the reason. */
  skipped: { tag: string; reason: string }[];
}

export function limitInMarketUnits(hashes: number, units: MarketUnits): number {
  return hashes / units.marketFactor;
}

export function planOrders(input: PlanInput, config: BotConfig): Plan {
  const market = input.market ?? 'BTC';
  const skipped: { tag: string; reason: string }[] = [];
  const byAlgo = new Map<string, CoinCandidate[]>();

  for (const coin of input.coins) {
    if (coin.lagging) {
      skipped.push({ tag: coin.tag, reason: 'lagging feed' });
      continue;
    }
    if (coin.unitUnconfirmed) {
      skipped.push({ tag: coin.tag, reason: 'nethash unit unconfirmed' });
      continue;
    }
    if (!coin.pool) {
      skipped.push({ tag: coin.tag, reason: 'no pool' });
      continue;
    }
    if (!(coin.nethash > 0)) {
      skipped.push({ tag: coin.tag, reason: 'missing nethash' });
      continue;
    }
    const list = byAlgo.get(coin.nicehashAlgorithm) ?? [];
    list.push(coin);
    byAlgo.set(coin.nicehashAlgorithm, list);
  }

  const slices: DesiredOrder[] = [];

  for (const [algorithm, coins] of byAlgo) {
    const book = input.books[algorithm];
    if (!book) {
      for (const c of coins) skipped.push({ tag: c.tag, reason: 'no order book' });
      continue;
    }
    const delivered = describeBook(book.orders, book.units, config.dustFraction);
    if (!delivered) {
      for (const c of coins) skipped.push({ tag: c.tag, reason: 'empty book' });
      continue;
    }
    const ranked = [...coins].sort((a, b) => {
      const ra = revenuePerPriceUnit(a, book.units.priceFactor);
      const rb = revenuePerPriceUnit(b, book.units.priceFactor);
      return rb - ra;
    });
    let remaining = delivered.totalHashes;
    const step = Math.abs(book.units.priceStep ?? config.defaultPriceStep);

    for (const coin of ranked) {
      if (!(remaining > 0)) {
        skipped.push({ tag: coin.tag, reason: 'book already allocated to higher ROI coins' });
        continue;
      }
      const revenue = revenuePerPriceUnit(coin, book.units.priceFactor);
      const capHashes = Math.min(coin.nethash * config.maxNetworkFraction, remaining);
      const quote = quoteSlice(delivered, book.units, capHashes, revenue, config.buyerFee, step);
      if (!quote || quote.roi <= config.roiMin) {
        skipped.push({ tag: coin.tag, reason: 'ROI at or below 1 after fee' });
        // A cheaper coin on this book pays the same front price, so it cannot clear either.
        for (const rest of ranked.slice(ranked.indexOf(coin) + 1)) {
          skipped.push({ tag: rest.tag, reason: 'ROI at or below 1 after fee' });
        }
        break;
      }
      slices.push(toDesired(coin, algorithm, market, book.units, quote));
      remaining -= quote.hashes;
    }
  }

  slices.sort((a, b) => b.roi - a.roi);

  const desired: DesiredOrder[] = [];
  let left = Math.max(0, input.spendableBtc);
  for (const slice of slices) {
    if (!(left > 0)) {
      skipped.push({ tag: slice.coin, reason: 'budget exhausted' });
      continue;
    }
    if (slice.spendBtcPerDay <= left) {
      desired.push(slice);
      left -= slice.spendBtcPerDay;
      continue;
    }
    const scale = left / slice.spendBtcPerDay;
    desired.push({
      ...slice,
      hashes: slice.hashes * scale,
      limit: slice.limit * scale,
      spendBtcPerDay: left,
      networkFraction: slice.networkFraction * scale,
    });
    left = 0;
  }

  return { desired, skipped };
}

function toDesired(
  coin: CoinCandidate,
  algorithm: string,
  market: string,
  units: MarketUnits,
  quote: SliceQuote,
): DesiredOrder {
  return {
    algorithm,
    market,
    coin: coin.tag,
    price: quote.postedPrice,
    limit: limitInMarketUnits(quote.hashes, units),
    poolId: coin.pool!.poolId,
    hashes: quote.hashes,
    spendBtcPerDay: quote.spendBtcPerDay,
    roi: quote.roi,
    roiBeforeFee: quote.roiBeforeFee,
    networkFraction: quote.hashes / coin.nethash,
  };
}

export function diffOrders(
  desired: DesiredOrder[],
  live: LiveOrder[],
  config: BotConfig,
  now: number,
  minLimit: Record<string, number> = {},
): OrderAction[] {
  const actions: OrderAction[] = [];
  const used = new Set<string>();

  for (const want of desired) {
    const have = live.find(o => o.algorithm === want.algorithm && o.coin === want.coin && !used.has(o.id));
    if (!have) {
      actions.push({ op: 'create', order: want });
      continue;
    }
    used.add(have.id);
    const priceGap = Math.abs(have.price - want.price) / want.price;
    const starved = have.limit > 0 && have.acceptedSpeed < have.limit * 0.5
      && (now - (have.createdAt ?? now)) >= config.starveForMs;
    if (priceGap > config.repriceBand || starved) {
      const reason = starved ? 'accepted speed under half the limit' : 'price gap outside reprice band';
      actions.push({ op: 'updatePriceAndLimit', id: have.id, order: want, reason });
    } else if (Math.abs(have.limit - want.limit) / want.limit > config.repriceBand) {
      actions.push({ op: 'updatePriceAndLimit', id: have.id, order: want, reason: 'limit differs' });
    } else {
      actions.push({ op: 'hold', id: have.id });
    }
  }

  for (const order of live) {
    if (used.has(order.id)) continue;
    const since = order.belowSince ?? now;
    const floor = minLimit[order.algorithm] ?? 0;
    if (now - since >= config.pauseGraceMs) {
      actions.push({ op: 'delete', id: order.id, reason: 'below ROI gate past pause grace' });
    } else {
      actions.push({ op: 'setMinLimit', id: order.id, limit: floor, reason: 'below ROI gate, inside pause grace' });
    }
  }

  return actions;
}

export function spendableBtc(nhFree: number, inFlight: number, reserve: number): number {
  return Math.max(0, nhFree + inFlight - reserve);
}
