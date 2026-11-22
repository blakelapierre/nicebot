/**
 * ROI is BTC out / BTC spent over the same window. Time cancels.
 * Price is the v2 order book, never simplemultialgo.paying.
 */

export interface BookOrder {
  id?: string;
  price: number;
  acceptedSpeed: number;
  limitSpeed?: number;
  alive?: boolean;
  rigs?: number;
}

export interface MarketUnits {
  /** Hashes (or sols) represented by a price of 1. */
  priceFactor: number;
  /** Hashes (or sols) represented by an acceptedSpeed of 1. */
  marketFactor: number;
  priceStep?: number;
}

export interface CoinStats {
  tag: string;
  algorithm: string;
  nethash: number;
  difficulty?: number;
  blockTime: number;
  blockReward: number;
  /** BTC per coin. Already converted; never a raw USD quote. */
  btcPerCoin: number;
  lagging?: boolean;
  /** Set when nethash disagrees with difficulty * 2^32 / blockTime. */
  unitUnconfirmed?: boolean;
  mergeGroup?: string;
}

export interface DeliveredBook {
  orders: BookOrder[];
  frontPrice: number;
  weightedPrice: number;
  totalHashes: number;
}

const TWO_32 = 2 ** 32;

export function nethashFromDifficulty(difficulty: number, blockTime: number): number {
  return difficulty * TWO_32 / blockTime;
}

/** True when published nethash matches the hash identity within 1%. */
export function nethashMatchesDifficulty(coin: CoinStats): boolean {
  if (!coin.difficulty || !(coin.blockTime > 0)) return false;
  const implied = nethashFromDifficulty(coin.difficulty, coin.blockTime);
  if (!(implied > 0)) return false;
  return Math.abs(coin.nethash - implied) / implied < 0.01;
}

export function btcPerCoinFromFeed(tag: string, exchangeRate: number, currency: string, btcUsd: number): number | undefined {
  if (!(exchangeRate > 0)) return undefined;
  const curr = (currency || 'BTC').toUpperCase();
  if (tag === 'BTC' && exchangeRate > 10) return 1;
  if (curr === 'USD' || curr === 'USDT') {
    if (!(btcUsd > 0)) return undefined;
    return exchangeRate / btcUsd;
  }
  if (curr !== 'BTC') return undefined;
  return exchangeRate;
}

/** BTC earned per price-unit per day. priceFactor is 1 TH, 1 EH, 1 GSol, ... */
export function revenuePerPriceUnit(coin: CoinStats, priceFactor: number): number {
  if (!(coin.nethash > 0) || !(coin.blockTime > 0) || !(coin.blockReward > 0) || !(coin.btcPerCoin > 0)) return 0;
  const share = priceFactor / coin.nethash;
  const coinsPerDay = share * (86400 / coin.blockTime) * coin.blockReward;
  return coinsPerDay * coin.btcPerCoin;
}

export function hashesToPriceUnits(hashes: number, units: MarketUnits): number {
  return hashes / units.priceFactor;
}

export function acceptedSpeedToHashes(acceptedSpeed: number, units: MarketUnits): number {
  return acceptedSpeed * units.marketFactor;
}

export function spendPerDay(priceUnits: number, orderPrice: number): number {
  return priceUnits * orderPrice;
}

/** ROI after the buyer fee is applied to cost. Gate is this value, not the raw ratio. */
export function roiAtPrice(revenuePerUnit: number, orderPrice: number, buyerFee: number): number {
  const cost = orderPrice * (1 + buyerFee);
  if (!(cost > 0)) return 0;
  return revenuePerUnit / cost;
}

export function roiBeforeFee(revenuePerUnit: number, orderPrice: number): number {
  if (!(orderPrice > 0)) return 0;
  return revenuePerUnit / orderPrice;
}

/**
 * Alive orders with real accepted speed, highest price first.
 * Dust is an order whose speed is below dustFraction of the largest filled order.
 */
export function deliveredOrders(orders: BookOrder[], dustFraction: number): BookOrder[] {
  const alive = orders.filter(o => o.alive !== false && o.acceptedSpeed > 0 && o.price > 0);
  if (alive.length === 0) return [];
  const largest = alive.reduce((m, o) => Math.max(m, o.acceptedSpeed), 0);
  const floor = largest * dustFraction;
  return alive
    .filter(o => o.acceptedSpeed >= floor)
    .sort((a, b) => b.price - a.price);
}

export function describeBook(orders: BookOrder[], units: MarketUnits, dustFraction: number): DeliveredBook | undefined {
  const kept = deliveredOrders(orders, dustFraction);
  if (kept.length === 0) return undefined;
  let totalSpeed = 0;
  let weighted = 0;
  let totalHashes = 0;
  for (const o of kept) {
    totalSpeed += o.acceptedSpeed;
    weighted += o.acceptedSpeed * o.price;
    totalHashes += acceptedSpeedToHashes(o.acceptedSpeed, units);
  }
  return {
    orders: kept,
    frontPrice: kept[0].price,
    weightedPrice: weighted / totalSpeed,
    totalHashes,
  };
}

export interface SliceQuote {
  hashes: number;
  priceUnits: number;
  /** What we post: one tick above the front order that actually has speed. */
  postedPrice: number;
  /** Price of the cheapest delivered order included. Diagnostic, not what we pay. */
  marginalBookPrice: number;
  /** Weighted mean of the whole delivered book. Must not be used as the buy price. */
  weightedPrice: number;
  spendBtcPerDay: number;
  revenueBtcPerDay: number;
  roi: number;
  roiBeforeFee: number;
}

/**
 * Cost of taking `hashesWanted` off the book.
 * One order has one price, and rigs move to the highest order, so the whole
 * slice is priced at one tick above the front. That is not the average.
 */
export function quoteSlice(
  book: DeliveredBook,
  units: MarketUnits,
  hashesWanted: number,
  revenuePerUnit: number,
  buyerFee: number,
  priceStep: number,
): SliceQuote | undefined {
  if (!(hashesWanted > 0) || book.orders.length === 0) return undefined;
  const take = Math.min(hashesWanted, book.totalHashes);
  if (!(take > 0)) return undefined;
  const tick = Math.abs(priceStep) || 0;
  const postedPrice = book.frontPrice + tick;
  let covered = 0;
  let marginal = book.frontPrice;
  for (const order of book.orders) {
    const hashes = acceptedSpeedToHashes(order.acceptedSpeed, units);
    covered += hashes;
    marginal = order.price;
    if (covered >= take) break;
  }
  const priceUnits = hashesToPriceUnits(take, units);
  const spend = spendPerDay(priceUnits, postedPrice);
  const revenue = priceUnits * revenuePerUnit;
  return {
    hashes: take,
    priceUnits,
    postedPrice,
    marginalBookPrice: marginal,
    weightedPrice: book.weightedPrice,
    spendBtcPerDay: spend,
    revenueBtcPerDay: revenue,
    roi: roiAtPrice(revenuePerUnit, postedPrice, buyerFee),
    roiBeforeFee: roiBeforeFee(revenuePerUnit, postedPrice),
  };
}

export interface MergeMember {
  tag: string;
  revenuePerUnit: number;
}

/** Scrypt aux coins flagged with the same mergeGroup add. Unflagged coins do not. */
export function combinedRevenue(members: MergeMember[]): number {
  return members.reduce((s, m) => s + m.revenuePerUnit, 0);
}
