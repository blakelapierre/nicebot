/**
 * Modern NiceHash ROI Prototype
 * 
 * Scans current NiceHash marketplace and calculates ROI for candidate coins.
 * Rule: Only ramp up or create orders when ROI > 1.0
 * 
 * Uses:
 * - NiceHash public API for order books / algorithm info
 * - CoinGecko for live prices (TradeOgre is no longer available)
 * - Placeholder network stats (to be replaced with live daemon or WhatToMine data)
 */

import * as https from 'https';

interface AlgorithmInfo {
  algo: number;
  name: string;
  speedText: string;
}

interface OrderBookEntry {
  price: number;        // BTC per unit per day
  limit_speed: number;
  workers: number;
}

interface CoinCandidate {
  symbol: string;
  algorithm: string;
  networkHashrate: number;  // in same units as NiceHash speed
  blockReward: number;
  blockTimeSeconds: number;
  priceBTC: number;
}

// Minimal fetch helper
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getNiceHashAlgorithms(): Promise<AlgorithmInfo[]> {
  // Public endpoint for algorithm list / buy info
  const data = await fetchJson('https://api2.nicehash.com/main/api/v2/public/buy/info');
  return (data.miningAlgorithms || []).map((a: any) => ({
    algo: a.algo,
    name: a.name,
    speedText: a.speed_text
  }));
}

async function getOrderBook(algo: number, market: number = 0): Promise<OrderBookEntry[]> {
  // market 0 = EU, 1 = USA (legacy mapping)
  const data = await fetchJson(
    `https://api2.nicehash.com/main/api/v2/public/orders?algorithm=${algo}&market=${market}`
  );
  const orders = data.list || [];
  return orders.map((o: any) => ({
    price: parseFloat(o.price),
    limit_speed: parseFloat(o.limit_speed || 0),
    workers: parseInt(o.workers || 0, 10)
  })).filter(o => o.price > 0);
}

async function getCoinPriceBTC(symbol: string): Promise<number> {
  // CoinGecko simple price
  const idMap: Record<string, string> = {
    'XMR': 'monero',
    'RVN': 'ravencoin',
    'ERG': 'ergo',
    'ETC': 'ethereum-classic',
    'BTC': 'bitcoin'
  };
  const id = idMap[symbol];
  if (!id) return 0;
  const data = await fetchJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=btc`
  );
  return data[id]?.btc || 0;
}

/**
 * Simplified ROI calculation.
 * ROI = (expected revenue in BTC) / (cost of hashrate in BTC)
 * > 1 means profitable.
 */
function calculateROI(
  hashrateUnits: number,          // units of speed you would buy
  pricePerUnitPerDay: number,     // from NiceHash order book
  networkHashrate: number,
  blockReward: number,
  blockTimeSeconds: number,
  coinPriceBTC: number
): number {
  if (networkHashrate <= 0 || pricePerUnitPerDay <= 0) return 0;

  const blocksPerDay = 86400 / blockTimeSeconds;
  const expectedCoinsPerDay = (hashrateUnits / networkHashrate) * blocksPerDay * blockReward;
  const revenueBTC = expectedCoinsPerDay * coinPriceBTC;
  const costBTC = hashrateUnits * pricePerUnitPerDay;

  return costBTC > 0 ? revenueBTC / costBTC : 0;
}

async function main() {
  console.log('=== NiceHash Modern ROI Prototype ===\n');

  try {
    const algorithms = await getNiceHashAlgorithms();
    console.log(`Found ${algorithms.length} algorithms on NiceHash\n`);

    // Example candidates (expand later with WhatToMine / live data)
    const candidates: CoinCandidate[] = [
      { symbol: 'XMR', algorithm: 'RandomXmonero', networkHashrate: 1_500_000_000, blockReward: 0.6, blockTimeSeconds: 120, priceBTC: 0 },
      { symbol: 'RVN', algorithm: 'KAWPOW', networkHashrate: 5_000_000_000_000, blockReward: 2500, blockTimeSeconds: 60, priceBTC: 0 },
      { symbol: 'ERG', algorithm: 'Autolykos', networkHashrate: 200_000_000_000, blockReward: 30, blockTimeSeconds: 120, priceBTC: 0 },
    ];

    // Fetch live prices
    for (const c of candidates) {
      c.priceBTC = await getCoinPriceBTC(c.symbol);
      console.log(`${c.symbol} price: ${c.priceBTC.toFixed(8)} BTC`);
    }
    console.log('');

    // Map algorithm names to IDs
    const algoMap = new Map(algorithms.map(a => [a.name, a.algo]));

    for (const coin of candidates) {
      const algoId = algoMap.get(coin.algorithm);
      if (algoId === undefined) {
        console.log(`Algorithm ${coin.algorithm} not found for ${coin.symbol}`);
        continue;
      }

      const book = await getOrderBook(algoId, 0); // EU market
      if (book.length === 0) {
        console.log(`No orders for ${coin.algorithm}`);
        continue;
      }

      // Use the cheapest (lowest price) tier that has speed as a reference
      const bestPrice = Math.min(...book.map(o => o.price));
      const sampleHashrate = 1; // 1 unit of the algorithm's speed

      const roi = calculateROI(
        sampleHashrate,
        bestPrice,
        coin.networkHashrate,
        coin.blockReward,
        coin.blockTimeSeconds,
        coin.priceBTC
      );

      console.log(`${coin.symbol} (${coin.algorithm})`);
      console.log(`  Best marketplace price: ${bestPrice.toFixed(8)} BTC/unit/day`);
      console.log(`  Calculated ROI: ${roi.toFixed(3)}`);
      console.log(`  Action: ${roi > 1 ? 'RAMP / CREATE ORDERS' : 'PAUSE / MIN SPEED / DELETE'}`);
      console.log('');
    }

    console.log('Prototype finished. Next steps: live network stats, more coins, actual order placement.');
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
