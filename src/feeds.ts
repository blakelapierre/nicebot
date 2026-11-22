/**
 * WhatToMine for network stats and price. Daemon stats override nethash and reward once synced.
 * BTCUSD is display and USD-quote conversion only. ROI is BTC over BTC.
 */

import https from 'node:https';
import { btcPerCoinFromFeed, nethashMatchesDifficulty, type CoinStats } from './roi.ts';

/** WhatToMine algorithm -> NiceHash algorithm. Keys are normalized (no punctuation). */
export const ALGO_MAP: Record<string, string> = {
  kawpow: 'KAWPOW',
  nexapow: 'NEXAPOW',
  beamhashiii: 'BEAMV3',
  autolykos: 'AUTOLYKOS',
  etchash: 'ETCHASH',
  ethash: 'DAGGERHASHIMOTO',
  octopus: 'OCTOPUS',
  equihash: 'EQUIHASH',
  randomx: 'RANDOMXMONERO',
  scrypt: 'SCRYPT',
  sha256: 'SHA256ASICBOOST',
  x11: 'X11',
  eaglesong: 'EAGLESONG',
  kheavyhash: 'KHEAVYHASH',
  blake3: 'ALEPHIUM',
};

/** Sol algorithms do not use the hash identity difficulty * 2^32 / time. */
const SOL_ALGOS = new Set(['EQUIHASH', 'BEAMV3', 'ZHASH']);

export function normalizeAlgo(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function nicehashAlgorithm(whatToMineName: string): string | undefined {
  return ALGO_MAP[normalizeAlgo(whatToMineName)];
}

export interface RawCoin {
  tag?: string;
  algorithm?: string;
  nethash?: number | string;
  difficulty?: number | string;
  block_time?: number | string;
  block_reward?: number | string;
  exchange_rate?: number | string;
  exchange_rate_curr?: string;
  lagging?: boolean;
}

export interface ParsedCoin extends CoinStats {
  nicehashAlgorithm: string;
}

export function parseWhatToMine(coins: Record<string, RawCoin> | RawCoin[], btcUsd: number): ParsedCoin[] {
  const list = Array.isArray(coins) ? coins : Object.values(coins);
  const out: ParsedCoin[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const tag = raw.tag || '';
    const nh = nicehashAlgorithm(raw.algorithm || '');
    if (!nh || tag === 'NICEHASH' || raw.lagging) continue;
    const key = `${tag}|${nh}`;
    if (seen.has(key)) continue;
    const btc = btcPerCoinFromFeed(tag, Number(raw.exchange_rate), raw.exchange_rate_curr || 'BTC', btcUsd);
    const nethash = Number(raw.nethash);
    const blockTime = Number(raw.block_time);
    const blockReward = Number(raw.block_reward);
    if (!btc || !(nethash > 0) || !(blockTime > 0) || !(blockReward > 0)) continue;
    seen.add(key);
    const coin: ParsedCoin = {
      tag,
      algorithm: raw.algorithm || '',
      nicehashAlgorithm: nh,
      nethash,
      difficulty: Number(raw.difficulty) || undefined,
      blockTime,
      blockReward,
      btcPerCoin: btc,
    };
    if (!SOL_ALGOS.has(nh) && coin.difficulty && !nethashMatchesDifficulty(coin)) {
      coin.unitUnconfirmed = true;
    }
    out.push(coin);
  }
  return out;
}

export interface DaemonStats {
  height: number;
  difficulty: number;
  blockReward: number;
  nethash?: number;
  synced: boolean;
  networkHeight?: number;
}

/** Daemon numbers replace WhatToMine nethash and reward. Price stays on the feed until a fill. */
export function applyDaemon<T extends CoinStats>(coin: T, daemon: DaemonStats): T {
  if (!daemon.synced) return coin;
  const next: T = { ...coin, difficulty: daemon.difficulty, blockReward: daemon.blockReward };
  if (daemon.nethash && daemon.nethash > 0) next.nethash = daemon.nethash;
  else if (daemon.difficulty > 0) {
    next.nethash = daemon.difficulty * 2 ** 32 / coin.blockTime;
  }
  next.unitUnconfirmed = false;
  return next;
}

export function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'nicebot', Accept: 'application/json' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`${res.statusCode} ${url}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`timeout ${url}`)));
  });
}

export async function loadPublicCoins(btcUsd?: number): Promise<{ coins: ParsedCoin[]; btcUsd: number }> {
  const price = btcUsd ?? await loadBtcUsd();
  const [gpu, asic] = await Promise.all([
    fetchJson('https://whattomine.com/coins.json') as Promise<{ coins: Record<string, RawCoin> }>,
    fetchJson('https://whattomine.com/asic.json') as Promise<{ coins: Record<string, RawCoin> }>,
  ]);
  const coins = parseWhatToMine({ ...asic.coins, ...gpu.coins }, price);
  return { coins, btcUsd: price };
}

export async function loadBtcUsd(): Promise<number> {
  try {
    const spot = await fetchJson('https://api.coinbase.com/v2/prices/BTC-USD/spot') as { data?: { amount?: string } };
    const n = Number(spot.data?.amount);
    if (n > 0) return n;
  } catch {
    // fall through
  }
  const gecko = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd') as { bitcoin?: { usd?: number } };
  const n = Number(gecko.bitcoin?.usd);
  if (!(n > 0)) throw new Error('no BTCUSD');
  return n;
}
