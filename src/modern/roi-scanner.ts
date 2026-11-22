/**
 * Modern NiceHash ROI Scanner
 * 
 * Goals:
 * - Live, accurate ROI using WhatToMine network stats + CoinGecko prices + NiceHash order books
 * - Strict rule: only ramp / create when ROI > 1.0; otherwise pause / min-speed / delete
 * - Analyze full order book tiers (not just cheapest price)
 * - Document pool requirement (buyers must supply a pool)
 *
 * Run: npx ts-node src/modern/roi-scanner.ts
 */

import * as https from 'https';

const ROI_THRESHOLD = 1.0;
const SAMPLE_HASHRATE = 1; // 1 unit of algorithm speed for comparison

interface WTMCoin {
  id: number;
  tag: string;
  name: string;
  algorithm: string;
  nethash: number;
  difficulty: number;
  block_reward: number;
  block_time: number;
  exchange_rate: number; // BTC
  lagging: boolean;
}

interface Order {
  price: number;
  limit_speed: number;
  workers: number;
  accepted_speed?: number;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'nicebot-roi/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getWhatToMineCoins(): Promise<WTMCoin[]> {
  // Public WhatToMine coins endpoint
  const data = await fetchJson('https://whattomine.com/api/v1/coins');
  return (data || []).map((c: any) => ({
    id: c.id,
    tag: c.tag,
    name: c.name,
    algorithm: c.algorithm,
    nethash: Number(c.nethash) || 0,
    difficulty: Number(c.difficulty) || 0,
    block_reward: Number(c.block_reward) || 0,
    block_time: Number(c.block_time) || 0,
    exchange_rate: Number(c.exchange_rate) || 0,
    lagging: !!c.lagging
  })).filter(c => c.nethash > 0 && c.block_time > 0 && c.exchange_rate > 0 && !c.lagging);
}

async function getNiceHashAlgorithms(): Promise<Map<string, number>> {
  const data = await fetchJson('https://api2.nicehash.com/main/api/v2/public/buy/info');
  const map = new Map<string, number>();
  for (const a of data.miningAlgorithms || []) {
    map.set(a.name, a.algo);
  }
  return map;
}

async function getOrderBook(algoId: number, market = 0): Promise<Order[]> {
  const data = await fetchJson(
    `https://api2.nicehash.com/main/api/v2/public/orders?algorithm=${algoId}&market=${market}&size=100`
  );
  return (data.list || [])
    .map((o: any) => ({
      price: parseFloat(o.price),
      limit_speed: parseFloat(o.limit_speed || 0),
      workers: parseInt(o.workers || 0, 10),
      accepted_speed: parseFloat(o.accepted_speed || 0)
    }))
    .filter(o => o.price > 0)
    .sort((a, b) => a.price - b.price); // cheapest first
}

function calculateROI(
  hashrate: number,
  pricePerUnitDay: number,
  networkHashrate: number,
  blockReward: number,
  blockTimeSec: number,
  coinPriceBTC: number
): number {
  if (networkHashrate <= 0 || pricePerUnitDay <= 0 || blockTimeSec <= 0) return 0;
  const blocksPerDay = 86400 / blockTimeSec;
  const share = hashrate / networkHashrate;
  const coinsPerDay = share * blocksPerDay * blockReward;
  const revenue = coinsPerDay * coinPriceBTC;
  const cost = hashrate * pricePerUnitDay;
  return cost > 0 ? revenue / cost : 0;
}

function analyzeTiers(orders: Order[], coin: WTMCoin): { bestROI: number; bestPrice: number; action: string } {
  let bestROI = 0;
  let bestPrice = 0;

  for (const order of orders.slice(0, 15)) { // top 15 cheapest tiers
    const roi = calculateROI(
      SAMPLE_HASHRATE,
      order.price,
      coin.nethash,
      coin.block_reward,
      coin.block_time,
      coin.exchange_rate
    );
    if (roi > bestROI) {
      bestROI = roi;
      bestPrice = order.price;
    }
  }

  const action = bestROI > ROI_THRESHOLD
    ? 'RAMP_OR_CREATE'
    : 'PAUSE_MIN_OR_DELETE';

  return { bestROI, bestPrice, action };
}

async function main() {
  console.log('=== Modern NiceHash ROI Scanner ===');
  console.log(`ROI threshold: ${ROI_THRESHOLD} (strict)\n`);

  const [wtmCoins, algoMap] = await Promise.all([
    getWhatToMineCoins(),
    getNiceHashAlgorithms()
  ]);

  console.log(`WhatToMine coins with live stats: ${wtmCoins.length}`);
  console.log(`NiceHash algorithms: ${algoMap.size}\n`);

  // Focus on coins whose algorithm exists on NiceHash
  const interesting = wtmCoins.filter(c => algoMap.has(c.algorithm));

  console.log(`Coins with matching NiceHash algorithm: ${interesting.length}\n`);

  const results: any[] = [];

  for (const coin of interesting.slice(0, 20)) { // limit for prototype
    const algoId = algoMap.get(coin.algorithm)!;
    try {
      const book = await getOrderBook(algoId, 0); // EU
      if (book.length === 0) continue;

      const analysis = analyzeTiers(book, coin);
      results.push({
        coin: coin.tag,
        algo: coin.algorithm,
        nethash: coin.nethash,
        priceBTC: coin.exchange_rate,
        bestPrice: analysis.bestPrice,
        bestROI: analysis.bestROI,
        action: analysis.action
      });

      console.log(
        `${coin.tag.padEnd(8)} ${coin.algorithm.padEnd(16)} ` +
        `ROI=${analysis.bestROI.toFixed(3)} ` +
        `price=${analysis.bestPrice.toFixed(8)} ` +
        `→ ${analysis.action}`
      );
    } catch (e) {
      console.error(`Error for ${coin.tag}:`, (e as Error).message);
    }
  }

  console.log('\n=== Summary ===');
  const profitable = results.filter(r => r.action === 'RAMP_OR_CREATE');
  console.log(`Profitable opportunities (ROI > ${ROI_THRESHOLD}): ${profitable.length}`);
  if (profitable.length) {
    console.log('Top ones:');
    profitable
      .sort((a, b) => b.bestROI - a.bestROI)
      .slice(0, 5)
      .forEach(r => console.log(`  ${r.coin} ${r.algo} ROI=${r.bestROI.toFixed(2)}`));
  }

  console.log('\nPool note: NiceHash buyers must still supply a mining pool address.');
  console.log('For zero-fee mining, run your own pool or use a documented zero-fee pool for the coin.');
  console.log('NiceHash does not currently provide a built-in zero-fee buyer pool for marketplace orders.');
}

main().catch(console.error);
