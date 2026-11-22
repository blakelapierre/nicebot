import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPoolConfig, buildSteps, execute, planVm, PoolConfigError, readyForVm, type PoolConfig } from '../src/pools/builder.ts';
import { assertHealthy, PoolHealthError } from '../src/pools/supervisor.ts';

const good: PoolConfig = {
  tag: 'NEXA',
  fee: 0,
  maturity: 0,
  payoutThreshold: 0,
  walletAddress: 'nexa:qqqq',
  daemonEndpoint: '127.0.0.1:7227',
  sourceRepo: 'https://gitlab.com/nexa/nexa.git',
  sourceRevision: 'deadbeef',
  buildCommand: 'cmake --build build',
};

test('a pool that charges a fee or freezes blocks is refused', () => {
  assert.throws(() => assertPoolConfig({ ...good, fee: 0.01 }), PoolConfigError);
  assert.throws(() => assertPoolConfig({ ...good, maturity: 100 }), PoolConfigError);
  assert.doesNotThrow(() => assertPoolConfig(good));
});

test('renting past the cap is refused and logged, and the plan has no exchange keys', () => {
  const local = planVm({ config: good, local: { canFit: true }, rentCapUsd: 5 });
  assert.equal(local.rented, false);
  assert.equal(local.host, 'local');

  assert.throws(
    () => planVm({
      config: good,
      local: { canFit: false, reason: 'disk' },
      rent: { provider: 'example', usdPerDay: 9 },
      rentCapUsd: 5,
    }),
    /exceeds cap/,
  );

  const rented = planVm({
    config: good,
    local: { canFit: false, reason: 'disk' },
    rent: { provider: 'example', usdPerDay: 4, address: '10.0.0.8' },
    rentCapUsd: 5,
  });
  assert.equal(rented.rented, true);
  assert.equal(JSON.stringify(rented).includes('apiSecret'), false);
  assert.equal(readyForVm(2, 3), false);
  assert.equal(readyForVm(3, 3), true);
});

test('execute will not clone unless LIVE_POOLS=1', async () => {
  const plan = planVm({ config: good, local: { canFit: true }, rentCapUsd: 1 });
  const steps = buildSteps(plan, '/tmp/pools');
  assert.match(steps[0].cmd, /git clone/);
  assert.match(steps[1].cmd, /deadbeef/);
  await assert.rejects(() => execute(plan, '/tmp/pools', { run: async () => undefined }, {}), /LIVE_POOLS/);
});

test('supervisor rejects a pool whose fee or maturity drifted', () => {
  assert.throws(() => assertHealthy({
    tag: 'NEXA', host: 'local', revision: 'deadbeef', height: 1, networkHeight: 1,
    peers: 8, hashrate: 1, fee: 0.01, maturity: 0, blocksFound: 0,
  }, good), PoolHealthError);
  assert.doesNotThrow(() => assertHealthy({
    tag: 'NEXA', host: 'local', revision: 'deadbeef', height: 1, networkHeight: 1,
    peers: 8, hashrate: 1, fee: 0, maturity: 0, blocksFound: 1,
  }, good));
});
