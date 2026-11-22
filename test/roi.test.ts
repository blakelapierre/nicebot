import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  describeBook,
  nethashFromDifficulty,
  nethashMatchesDifficulty,
  quoteSlice,
  revenuePerPriceUnit,
  roiAtPrice,
  roiBeforeFee,
  type CoinStats,
} from '../src/roi.ts';

function load(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

test('ravencoin revenue, weighted price, and dust', () => {
  const fx = load('rvn-kawpow.json');
  const coin: CoinStats = {
    tag: 'RVN', nethash: fx.nethash, difficulty: fx.difficulty,
    blockTime: fx.blockTime, blockReward: fx.blockReward, btcPerCoin: fx.btcPerCoin,
  };
  const units = { priceFactor: fx.priceFactor, marketFactor: fx.marketFactor };
  const revenue = revenuePerPriceUnit(coin, units.priceFactor);
  assert.ok(Math.abs(revenue - 0.05304) / 0.05304 < 0.002, `revenue ${revenue}`);

  const book = describeBook(fx.orders, units, 0.005);
  assert.ok(book);
  assert.equal(book!.orders.length, 2);
  assert.equal(book!.frontPrice, 0.0801);
  assert.ok(Math.abs(book!.weightedPrice - 0.0717) < 1e-9, `weighted ${book!.weightedPrice}`);

  const atWeighted = roiBeforeFee(revenue, book!.weightedPrice);
  const atFront = roiBeforeFee(revenue, book!.frontPrice);
  assert.ok(Math.abs(atWeighted - 0.74) < 0.01, `weighted roi ${atWeighted}`);
  assert.ok(Math.abs(atFront - 0.66) < 0.01, `front roi ${atFront}`);
  assert.ok(atFront < 1 && atWeighted < 1);

  const slice = quoteSlice(book!, units, units.priceFactor, revenue, 0.03, 0);
  assert.ok(slice);
  assert.equal(slice!.postedPrice, 0.0801);
  assert.notEqual(slice!.postedPrice, book!.weightedPrice);
  assert.ok(slice!.roi < 1);
});

test('the first slice pays the front price, not the average', () => {
  const units = { priceFactor: 1e12, marketFactor: 1e12, priceStep: 0.0001 };
  const book = describeBook([
    { price: 0.08, acceptedSpeed: 1, alive: true },
    { price: 0.04, acceptedSpeed: 1, alive: true },
  ], units, 0.005);
  assert.ok(book);
  assert.ok(Math.abs(book!.weightedPrice - 0.06) < 1e-12);
  const slice = quoteSlice(book!, units, 1e12, 0.05, 0.03, 0.0001);
  assert.equal(slice!.postedPrice, 0.0801);
  assert.ok(Math.abs(slice!.spendBtcPerDay - 0.0801) < 1e-12);
  assert.ok(slice!.marginalBookPrice <= 0.08);
});

test('nexa GH speed against a TH price', () => {
  const fx = load('nexa-nexapow.json');
  const coin: CoinStats = {
    tag: 'NEXA', nethash: fx.nethash, difficulty: fx.difficulty,
    blockTime: fx.blockTime, blockReward: fx.blockReward, btcPerCoin: fx.btcPerCoin,
  };
  assert.ok(nethashMatchesDifficulty(coin));
  assert.ok(Math.abs(nethashFromDifficulty(fx.difficulty, fx.blockTime) - fx.nethash) < 1);

  const units = { priceFactor: fx.priceFactor, marketFactor: fx.marketFactor };
  const revenue = revenuePerPriceUnit(coin, units.priceFactor);
  assert.ok(Math.abs(revenue - 0.019748) / 0.019748 < 0.001, `revenue ${revenue}`);

  const book = describeBook(fx.orders, units, 0.005);
  assert.ok(book);
  assert.equal(book!.orders.length, 1);
  assert.equal(book!.frontPrice, 0.008);
  const th = book!.totalHashes / 1e12;
  assert.ok(Math.abs(th - 0.00982115855) < 1e-12, `TH ${th}`);

  const before = roiBeforeFee(revenue, 0.008);
  const after = roiAtPrice(revenue, 0.008, 0.03);
  assert.ok(Math.abs(before - 2.4685) < 0.002, `before ${before}`);
  assert.ok(Math.abs(after - 2.3966) < 0.002, `after ${after}`);

  const wholeBookUsd = book!.totalHashes / units.priceFactor * 0.008 * fx.btcUsd;
  assert.ok(Math.abs(wholeBookUsd - 4.59) < 0.08, `usd ${wholeBookUsd}`);
  assert.ok(book!.totalHashes / fx.nethash < 0.01);

  const wtmHashes = fx.wtmReferenceRewards * fx.nethash / (86400 / fx.blockTime * fx.blockReward);
  const scaled = (fx.wtmReferenceRewards * fx.btcPerCoin) * (units.priceFactor / wtmHashes);
  assert.ok(Math.abs(scaled - revenue) / revenue < 1e-9);
});
