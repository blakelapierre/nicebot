import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS } from '../src/config.ts';
import { diffOrders, planOrders, type CoinCandidate } from '../src/optimize.ts';
import type { BookOrder, MarketUnits } from '../src/roi.ts';

const USD = 59208;

interface Spec {
  tag: string;
  algo: string;
  roi: number;
  bookUsd: number;
  frac: number;
  marketFactor?: number;
  pool?: boolean;
}

function build(specs: Spec[]) {
  const coins: CoinCandidate[] = [];
  const books: Record<string, { units: MarketUnits; orders: BookOrder[] }> = {};
  const price = 0.05;
  for (const spec of specs) {
    const priceFactor = 1e12;
    const marketFactor = spec.marketFactor ?? 1e12;
    const bookHashes = (spec.bookUsd / USD) / price * priceFactor;
    const units: MarketUnits = { priceFactor, marketFactor, priceStep: 0 };
    if (!books[spec.algo]) {
      books[spec.algo] = {
        units,
        orders: [{ price, acceptedSpeed: bookHashes / marketFactor, alive: true }],
      };
    }
    const blockTime = 60;
    const btcPerCoin = 1e-8;
    const nethash = bookHashes / spec.frac;
    const coinsPerDay = (spec.roi * price) / btcPerCoin;
    const share = priceFactor / nethash;
    const blockReward = coinsPerDay / (share * (86400 / blockTime));
    coins.push({
      tag: spec.tag,
      algorithm: spec.algo,
      nicehashAlgorithm: spec.algo,
      nethash,
      blockTime,
      blockReward,
      btcPerCoin,
      pool: spec.pool === false ? undefined : { tag: spec.tag, poolId: `pool-${spec.tag}` },
    });
  }
  return { coins, books };
}

const MARKET: Spec[] = [
  { tag: 'NEXA', algo: 'NEXAPOW', roi: 2.465, bookUsd: 4.56, frac: 0.0073, marketFactor: 1e9 },
  { tag: 'BEAM', algo: 'BEAMV3', roi: 2.035, bookUsd: 25.0749, frac: 0.333 },
  { tag: 'NEOX', algo: 'KAWPOW', roi: 1.526, bookUsd: 616, frac: 13.575 },
  { tag: 'KRGN', algo: 'KAWPOW', roi: 1.496, bookUsd: 616, frac: 73.778 },
  { tag: 'ALPH', algo: 'ALEPHIUM', roi: 1.417, bookUsd: 53.3748, frac: 0.114 },
  { tag: 'ETC', algo: 'ETCHASH', roi: 1.304, bookUsd: 16.08, frac: 0.0004 },
  { tag: 'QUAI', algo: 'KAWPOW', roi: 1.223, bookUsd: 616, frac: 0.998 },
  { tag: 'CKB', algo: 'EAGLESONG', roi: 1.15, bookUsd: 143, frac: 0.047 },
  { tag: 'ZEC', algo: 'EQUIHASH', roi: 1.02, bookUsd: 12000, frac: 0.012 },
  { tag: 'GHOST', algo: 'NEXAPOW', roi: 9, bookUsd: 4.56, frac: 0.0073, marketFactor: 1e9, pool: false },
];

test('a $100 budget fills the measured order and stops', () => {
  const { coins, books } = build(MARKET);
  const plan = planOrders({
    coins,
    books,
    spendableBtc: 100 / USD,
  }, DEFAULTS);

  const tags = plan.desired.map(d => d.coin);
  assert.deepEqual(tags, ['NEXA', 'BEAM', 'NEOX', 'KRGN', 'ALPH', 'ETC', 'QUAI']);

  const usd = (tag: string) => plan.desired.find(d => d.coin === tag)!.spendBtcPerDay * USD;
  assert.ok(Math.abs(usd('NEXA') - 4.56) < 0.02);
  assert.ok(Math.abs(usd('BEAM') - 7.53) < 0.02);
  assert.ok(Math.abs(usd('NEOX') - 4.54) < 0.02);
  assert.ok(Math.abs(usd('KRGN') - 0.83) < 0.02);
  assert.ok(Math.abs(usd('ALPH') - 46.82) < 0.05);
  assert.ok(Math.abs(usd('ETC') - 16.08) < 0.02);
  assert.ok(Math.abs(usd('QUAI') - 19.64) < 0.05);

  const spent = plan.desired.reduce((s, d) => s + d.spendBtcPerDay * USD, 0);
  assert.ok(Math.abs(spent - 100) < 0.05, `spent ${spent}`);

  const neox = plan.desired.find(d => d.coin === 'NEOX')!;
  assert.ok(Math.abs(neox.networkFraction - 0.10) < 1e-9);
  assert.ok(neox.networkFraction * 13.575 < 2, 'did not buy the whole KawPow book');

  assert.ok(plan.skipped.some(s => s.tag === 'CKB' && s.reason === 'budget exhausted'));
  assert.ok(plan.skipped.some(s => s.tag === 'ZEC' && s.reason.includes('ROI')));
  assert.ok(plan.skipped.some(s => s.tag === 'GHOST' && s.reason === 'no pool'));
});

test('an order below the gate is paused, then deleted after the grace', () => {
  const live = [{
    id: 'o1', algorithm: 'KAWPOW', market: 'BTC', coin: 'RVN',
    price: 0.08, limit: 0.1, acceptedSpeed: 0.1, belowSince: 0,
  }];
  const paused = diffOrders([], live, DEFAULTS, DEFAULTS.pauseGraceMs - 1);
  assert.equal(paused[0].op, 'setMinLimit');
  const gone = diffOrders([], live, DEFAULTS, DEFAULTS.pauseGraceMs);
  assert.equal(gone[0].op, 'delete');
});

test('a small reprice is held', () => {
  const { coins, books } = build([MARKET[0]]);
  const plan = planOrders({ coins, books, spendableBtc: 1 }, DEFAULTS);
  const want = plan.desired[0];
  const actions = diffOrders(plan.desired, [{
    id: 'keep', algorithm: want.algorithm, market: 'BTC', coin: want.coin,
    price: want.price * 1.001, limit: want.limit, acceptedSpeed: want.limit, createdAt: 0,
  }], DEFAULTS, 1000);
  assert.equal(actions[0].op, 'hold');
});
