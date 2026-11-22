import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { StratumProxy } from '../src/proxy.ts';

function listen(onLine: (line: string, socket: net.Socket) => void): Promise<net.Server & { port: number }> {
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      let buf = '';
      socket.on('data', chunk => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || line[0] !== '{') continue;
          onLine(line, socket);
        }
      });
    }) as net.Server & { port: number };
    server.listen(0, '127.0.0.1', () => {
      server.port = (server.address() as net.AddressInfo).port;
      resolve(server);
    });
  });
}

function waitMessage(socket: net.Socket, id: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), 2000);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line[0] !== '{') continue;
        const msg = JSON.parse(line);
        if (msg.id === id) {
          clearTimeout(timer);
          socket.off('data', onData);
          resolve(msg);
        }
      }
    };
    socket.on('data', onData);
  });
}

test('switching upstream does not drop the miner, and retries an unacked share', async () => {
  const gotA: number[] = [];
  const gotB: number[] = [];
  const a = await listen((line, socket) => {
    const msg = JSON.parse(line);
    gotA.push(msg.id);
    if (msg.id === 10) socket.write(JSON.stringify({ id: 10, result: true, error: null }) + '\n');
  });
  const b = await listen(line => {
    gotB.push(JSON.parse(line).id);
  });
  const proxy = new StratumProxy();
  const miner = net.connect(await proxy.listen(0), '127.0.0.1');
  try {
    proxy.setUpstream('KAWPOW.NEOX', { host: '127.0.0.1', port: a.port });
    await new Promise(resolve => miner.once('connect', resolve));
    miner.write(JSON.stringify({ id: 1, method: 'mining.subscribe', params: [] }) + '\n');
    await waitMessage(miner, 1);
    miner.write(JSON.stringify({ id: 2, method: 'mining.authorize', params: ['KAWPOW.NEOX.1', 'x'] }) + '\n');
    await waitMessage(miner, 2);

    miner.write(JSON.stringify({ id: 10, method: 'mining.submit', params: ['KAWPOW.NEOX.1', 'job', 'n1'] }) + '\n');
    await waitMessage(miner, 10);
    assert.ok(gotA.includes(10));

    miner.write(JSON.stringify({ id: 11, method: 'mining.submit', params: ['KAWPOW.NEOX.1', 'job', 'n2'] }) + '\n');
    await new Promise(r => setTimeout(r, 40));
    assert.ok(gotA.includes(11));

    proxy.setUpstream('KAWPOW.NEOX', { host: '127.0.0.1', port: b.port });
    await new Promise(r => setTimeout(r, 80));
    assert.equal(miner.destroyed, false);
    assert.ok(gotB.includes(11), `retried ids ${gotB.join(',')}`);
  } finally {
    miner.destroy();
    await proxy.close();
    await new Promise<void>(resolve => a.close(() => resolve()));
    await new Promise<void>(resolve => b.close(() => resolve()));
  }
});
