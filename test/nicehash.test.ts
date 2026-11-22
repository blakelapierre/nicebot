import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS } from '../src/config.ts';
import { runCycle } from '../src/main.ts';
import { createOrderClient, signRequest, type HttpClient } from '../src/nicehash.ts';
import type { CoinCandidate } from '../src/optimize.ts';

test('the signature covers method, path, and body, and a dry client sends nothing', async () => {
  const signed = signRequest(
    { apiKey: 'key', apiSecret: 'secret', organizationId: 'org' },
    'POST',
    '/main/api/v2/hashpower/order',
    '',
    '{"limit":"1"}',
    1_700_000_000_000,
    'nonce-1',
  );
  assert.match(signed.headers['X-Auth'], /^key:[0-9a-f]{64}$/);
  assert.equal(signed.headers['X-Organization-Id'], 'org');
  assert.equal(signed.headers['X-Time'], '1700000000000');

  const calls: string[] = [];
  const http: HttpClient = async (url, init) => {
    calls.push(init.method + ' ' + url);
    return { status: 200, body: '{"miningAlgorithms":[]}', headers: {} };
  };
  const client = createOrderClient({ live: false, http });
  await client.getAlgorithms();
  assert.equal(calls.length, 1);
  await assert.rejects(() => client.createOrder({ limit: '1' }), /LIVE=1/);
  assert.equal(client.sent.length, 0);
  assert.equal(calls.length, 1);
});

test('runCycle with LIVE unset does not call the private client', async () => {
  delete process.env.LIVE;
  const calls: string[] = [];
  const http: HttpClient = async (url, init) => {
    calls.push(init.method);
    return { status: 200, body: '{}', headers: {} };
  };
  const client = createOrderClient({ live: false, http });
  const coin: CoinCandidate = {
    tag: 'NEXA', algorithm: 'NexaPow', nicehashAlgorithm: 'NEXAPOW',
    nethash: 1e12, blockTime: 120, blockReward: 5e6, btcPerCoin: 1e-11,
    pool: { tag: 'NEXA', poolId: 'p1' },
  };
  const result = await runCycle({
    coins: [coin],
    books: {
      NEXAPOW: {
        units: { priceFactor: 1e12, marketFactor: 1e9, priceStep: 0 },
        orders: [{ price: 0.008, acceptedSpeed: 10, alive: true }],
      },
    },
    liveOrders: [],
    nhFreeBtc: 0.01,
    inFlightBtc: 0,
    btcUsd: 59000,
    config: { ...DEFAULTS, reserveBtc: 0.001 },
  }, client);
  assert.equal(result.live, false);
  assert.equal(result.sentPrivateCalls, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.actions[0]?.op, 'create');
});
