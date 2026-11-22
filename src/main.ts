/**
 * One dry-run cycle by default. Private NiceHash calls require LIVE=1.
 * Does not import the historical src/index.ts bot.
 */

import { configFromEnv, liveOrdersEnabled, type BotConfig } from './config.ts';
import { loadPublicCoins } from './feeds.ts';
import { createOrderClient, poolUser, type HttpClient, type OrderClient } from './nicehash.ts';
import { diffOrders, planOrders, spendableBtc, type CoinCandidate, type LiveOrder, type Plan } from './optimize.ts';
import type { BookOrder, MarketUnits } from './roi.ts';
import { describeBook } from './roi.ts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startGui, type GuiServer } from './gui/server.ts';
import { StratumProxy } from './proxy.ts';

export interface CycleInput {
  coins: CoinCandidate[];
  books: Record<string, { units: MarketUnits; orders: BookOrder[] }>;
  liveOrders: LiveOrder[];
  nhFreeBtc: number;
  inFlightBtc: number;
  btcUsd: number;
  now?: number;
  config?: BotConfig;
}

export interface CycleResult {
  plan: Plan;
  actions: ReturnType<typeof diffOrders>;
  live: boolean;
  sentPrivateCalls: number;
}

export async function runCycle(input: CycleInput, client: OrderClient): Promise<CycleResult> {
  const config = input.config ?? configFromEnv();
  const live = liveOrdersEnabled();
  const plan = planOrders({
    coins: input.coins,
    books: input.books,
    spendableBtc: spendableBtc(input.nhFreeBtc, input.inFlightBtc, config.reserveBtc),
  }, config);
  const actions = diffOrders(plan.desired, input.liveOrders, config, input.now ?? Date.now());

  if (live) {
    for (const action of actions) {
      if (action.op === 'create') {
        const user = poolUser(action.order.algorithm, action.order.coin, 'pending');
        await client.createPool({
          algorithm: action.order.algorithm,
          name: user,
          username: user,
          password: 'x',
          stratumHostname: process.env.PROXY_HOST || '127.0.0.1',
          stratumPort: Number(process.env.PROXY_PORT || 3333),
        });
        await client.createOrder({
          algorithm: action.order.algorithm,
          amount: action.order.spendBtcPerDay.toFixed(8),
          price: action.order.price.toFixed(8),
          limit: action.order.limit.toFixed(8),
          market: action.order.market,
          poolId: action.order.poolId,
        });
      } else if (action.op === 'updatePriceAndLimit') {
        await client.updatePriceAndLimit({
          id: action.id,
          price: action.order.price.toFixed(8),
          limit: action.order.limit.toFixed(8),
        });
      } else if (action.op === 'delete') {
        await client.deleteOrder(action.id);
      }
    }
  }

  return { plan, actions, live, sentPrivateCalls: client.sent.length };
}

export function formatCycle(result: CycleResult, btcUsd: number): string {
  const lines = [
    result.live ? 'LIVE' : 'DRY RUN (set LIVE=1 to send orders)',
    `desired ${result.plan.desired.length}  actions ${result.actions.length}  private calls ${result.sentPrivateCalls}`,
  ];
  for (const order of result.plan.desired) {
    lines.push(
      `${order.coin.padEnd(6)} ${order.algorithm.padEnd(16)} $${(order.spendBtcPerDay * btcUsd).toFixed(2).padStart(8)}  roi ${order.roi.toFixed(3)}  fraction ${(order.networkFraction * 100).toFixed(2)}%`,
    );
  }
  for (const action of result.actions) {
    if (action.op === 'create') lines.push(`CREATE ${action.order.coin} ${action.order.algorithm} @ ${action.order.price}`);
    else if (action.op === 'hold') lines.push(`HOLD ${action.id}`);
    else lines.push(`${action.op} ${action.id} ${'reason' in action ? action.reason : ''}`);
  }
  return lines.join('\n');
}

export function snapshotFrom(input: CycleInput, result: CycleResult, proxy?: StratumProxy) {
  return {
    capital: {
      freeBtc: input.nhFreeBtc,
      inFlightBtc: input.inFlightBtc,
      reserveBtc: (input.config ?? configFromEnv()).reserveBtc,
    },
    coins: input.coins.map(c => ({
      tag: c.tag,
      algorithm: c.nicehashAlgorithm,
      nethash: c.nethash,
      pool: !!c.pool,
    })),
    books: Object.entries(input.books).map(([algorithm, book]) => {
      const d = describeBook(book.orders, book.units, (input.config ?? configFromEnv()).dustFraction);
      return {
        algorithm,
        frontPrice: d?.frontPrice,
        weightedPrice: d?.weightedPrice,
        totalHashes: d?.totalHashes,
      };
    }),
    orders: input.liveOrders,
    actions: result.actions.map(a => a.op === 'create'
      ? { op: a.op, coin: a.order.coin }
      : { op: a.op, id: 'id' in a ? a.id : '', reason: 'reason' in a ? a.reason : '' }),
    plan: result.plan.desired,
    proxy: proxy?.snapshot(),
    log: result.live ? [] : ['dry run: no private calls sent'],
  };
}

async function main(): Promise<void> {
  const config = configFromEnv();
  if (config.reserveBtc <= 0) {
    console.error('RESERVE_BTC is 0. Set a reserve before a production run. Continuing as a dry read.');
  }
  const client = createOrderClient({
    live: false,
    http: publicOnlyHttp(),
  });
  const { coins, btcUsd } = await loadPublicCoins();
  const books: CycleInput['books'] = {};
  const algos = await client.getAlgorithms() as { miningAlgorithms: { algorithm: string; priceFactor: string; marketFactor: string; priceDownStep: string }[] };
  const wanted = new Set(coins.map(c => c.nicehashAlgorithm));
  for (const algo of algos.miningAlgorithms) {
    if (!wanted.has(algo.algorithm)) continue;
    try {
      const raw = await client.getOrderBook(algo.algorithm) as { stats?: { BTC?: { orders?: { price: string; acceptedSpeed: string; alive: boolean; limit: string }[] } } };
      const orders = raw.stats?.BTC?.orders ?? [];
      books[algo.algorithm] = {
        units: {
          priceFactor: Number(algo.priceFactor),
          marketFactor: Number(algo.marketFactor),
          priceStep: Math.abs(Number(algo.priceDownStep)) || config.defaultPriceStep,
        },
        orders: orders.map(o => ({
          price: Number(o.price),
          acceptedSpeed: Number(o.acceptedSpeed),
          limitSpeed: Number(o.limit),
          alive: o.alive,
        })),
      };
    } catch (error) {
      console.error('book', algo.algorithm, (error as Error).message);
    }
  }
  const withPools: CoinCandidate[] = coins.map(c => ({ ...c, pool: undefined }));
  const result = await runCycle({
    coins: withPools,
    books,
    liveOrders: [],
    nhFreeBtc: 0,
    inFlightBtc: 0,
    btcUsd,
    config,
  }, client);
  console.log(formatCycle(result, btcUsd));
  console.log('no pools are configured, so every coin is skipped until a VM is up');
  if (process.env.GUI === '1') {
    const gui: GuiServer = await startGui(Number(process.env.GUI_PORT || 5555));
    gui.publish(snapshotFrom({
      coins: withPools, books, liveOrders: [], nhFreeBtc: 0, inFlightBtc: 0, btcUsd, config,
    }, result));
    console.log(`gui http://127.0.0.1:${gui.port}`);
  }
}

function publicOnlyHttp(): HttpClient {
  return async (url, init) => {
    if (init.method !== 'GET') throw new Error(`dry client blocked ${init.method} ${url}`);
    const { nodeHttpClient } = await import('./nicehash.ts');
    return nodeHttpClient()(url, init);
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
