/**
 * Stratum v1 proxy. NiceHash only ever sees this process.
 * The orchestrator chooses the upstream. The proxy does not compute ROI.
 */

import net from 'node:net';

export interface Upstream {
  host: string;
  port: number;
}

export interface ShareStats {
  user: string;
  worker: string;
  upstream: string;
  accepted: number;
  rejected: number;
  lastShareAt?: number;
}

interface PendingShare {
  id: number;
  line: string;
}

interface Downstream {
  socket: net.Socket;
  user?: string;
  buf: string;
  upstream?: net.Socket;
  upstreamBuf: string;
  upstreamKey?: string;
  pending: PendingShare[];
  alive: boolean;
  accepted: number;
  rejected: number;
  lastShareAt?: number;
}

export interface ProxySnapshot {
  listening: boolean;
  port: number;
  connections: ShareStats[];
  switches: { user: string; to: string; at: number }[];
}

export class StratumProxy {
  private server?: net.Server;
  private port = 0;
  private routes = new Map<string, Upstream>();
  private conns = new Set<Downstream>();
  private switches: { user: string; to: string; at: number }[] = [];

  async listen(port = 0, host = '127.0.0.1'): Promise<number> {
    this.server = net.createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => resolve());
    });
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  /** Route key is the pool username (`ALGORITHM.COIN.ORDER`) or its ALGORITHM.COIN prefix. */
  setUpstream(user: string, upstream: Upstream): void {
    this.routes.set(user, upstream);
    for (const conn of this.conns) {
      if (!conn.user || !routeMatches(user, conn.user)) continue;
      this.switches.push({ user: conn.user, to: `${upstream.host}:${upstream.port}`, at: Date.now() });
      this.attachUpstream(conn, upstream);
    }
  }

  snapshot(): ProxySnapshot {
    return {
      listening: !!this.server?.listening,
      port: this.port,
      connections: [...this.conns].filter(c => c.alive).map(c => ({
        user: c.user || '',
        worker: (c.user || '').split('.')[0],
        upstream: c.upstreamKey || '',
        accepted: c.accepted,
        rejected: c.rejected,
        lastShareAt: c.lastShareAt,
      })),
      switches: this.switches.slice(-50),
    };
  }

  async close(): Promise<void> {
    for (const c of this.conns) {
      c.alive = false;
      c.upstream?.destroy();
      c.socket.destroy();
    }
    if (!this.server) return;
    await new Promise<void>(resolve => this.server!.close(() => resolve()));
  }

  private accept(socket: net.Socket): void {
    const conn: Downstream = {
      socket, buf: '', upstreamBuf: '', pending: [], alive: true, accepted: 0, rejected: 0,
    };
    this.conns.add(conn);
    socket.on('data', chunk => this.onMiner(conn, chunk.toString('utf8')));
    socket.on('close', () => {
      conn.alive = false;
      conn.upstream?.destroy();
      this.conns.delete(conn);
    });
    socket.on('error', () => socket.destroy());
  }

  private onMiner(conn: Downstream, text: string): void {
    conn.buf += text;
    let nl: number;
    while ((nl = conn.buf.indexOf('\n')) >= 0) {
      const line = conn.buf.slice(0, nl).trim();
      conn.buf = conn.buf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; method?: string; params?: unknown[] };
      try { msg = JSON.parse(line); }
      catch { continue; }
      if (msg.method === 'mining.subscribe') {
        send(conn.socket, { id: msg.id, result: [[['mining.notify', 'proxy']], '00000000', 4], error: null });
      } else if (msg.method === 'mining.authorize') {
        conn.user = String(msg.params?.[0] ?? '');
        send(conn.socket, { id: msg.id, result: true, error: null });
        send(conn.socket, { id: null, method: 'mining.set_difficulty', params: [1] });
        const route = this.findRoute(conn.user);
        if (route) this.attachUpstream(conn, route);
      } else if (msg.method === 'mining.submit' && msg.id !== undefined) {
        const pending: PendingShare = { id: msg.id, line: JSON.stringify(msg) };
        conn.pending.push(pending);
        conn.lastShareAt = Date.now();
        if (conn.upstream && !conn.upstream.destroyed) conn.upstream.write(pending.line + '\n');
      }
    }
  }

  private findRoute(user: string): Upstream | undefined {
    if (this.routes.has(user)) return this.routes.get(user);
    const parts = user.split('.');
    if (parts.length >= 2) {
      const prefix = `${parts[0]}.${parts[1]}`;
      if (this.routes.has(prefix)) return this.routes.get(prefix);
    }
    return undefined;
  }

  private attachUpstream(conn: Downstream, upstream: Upstream): void {
    const key = `${upstream.host}:${upstream.port}`;
    if (conn.upstream && conn.upstreamKey === key && !conn.upstream.destroyed) return;
    conn.upstream?.destroy();
    conn.upstreamKey = key;
    const sock = net.connect(upstream.port, upstream.host);
    conn.upstream = sock;
    sock.on('data', chunk => this.onUpstream(conn, chunk.toString('utf8')));
    sock.on('error', () => undefined);
    sock.on('connect', () => {
      for (const share of conn.pending) sock.write(share.line + '\n');
    });
  }

  private onUpstream(conn: Downstream, text: string): void {
    conn.upstreamBuf += text;
    let nl: number;
    while ((nl = conn.upstreamBuf.indexOf('\n')) >= 0) {
      const line = conn.upstreamBuf.slice(0, nl).trim();
      conn.upstreamBuf = conn.upstreamBuf.slice(nl + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown };
      try { msg = JSON.parse(line); }
      catch { continue; }
      if (msg.id === undefined) continue;
      const idx = conn.pending.findIndex(p => p.id === msg.id);
      if (idx >= 0) conn.pending.splice(idx, 1);
      if (msg.result === true) conn.accepted++;
      else conn.rejected++;
      if (conn.alive) send(conn.socket, JSON.parse(line));
    }
  }
}

function routeMatches(routeKey: string, user: string): boolean {
  return user === routeKey || user.startsWith(routeKey + '.');
}

function send(socket: net.Socket, msg: unknown): void {
  if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n');
}
