/**
 * NiceHash v2 client. Public reads need no key.
 * Private calls are signed and are not sent unless LIVE=1.
 */

import crypto from 'node:crypto';
import https from 'node:https';

export const API_BASE = 'https://api2.nicehash.com';

export interface NiceHashCredentials {
  apiKey: string;
  apiSecret: string;
  organizationId: string;
}

export interface SignedRequest {
  method: string;
  path: string;
  query: string;
  body: string;
  headers: Record<string, string>;
}

export function signRequest(
  creds: NiceHashCredentials,
  method: string,
  path: string,
  query = '',
  body = '',
  now = Date.now(),
  nonce = crypto.randomUUID(),
): SignedRequest {
  const time = String(now);
  const upper = method.toUpperCase();
  const payload = [
    creds.apiKey,
    time,
    nonce,
    '',
    creds.organizationId,
    '',
    upper,
    path,
    query,
    body,
  ].join('\0');
  const signature = crypto.createHmac('sha256', creds.apiSecret).update(payload).digest('hex');
  return {
    method: upper,
    path,
    query,
    body,
    headers: {
      'X-Time': time,
      'X-Nonce': nonce,
      'X-Organization-Id': creds.organizationId,
      'X-Request-Id': nonce,
      'X-Auth': `${creds.apiKey}:${signature}`,
      'Content-Type': 'application/json',
    },
  };
}

export interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type HttpClient = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResult>;

export function nodeHttpClient(): HttpClient {
  return (url, init) => new Promise((resolve, reject) => {
    const req = https.request(url, { method: init.method, headers: init.headers }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: data,
        headers: res.headers as HttpResult['headers'],
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (init.body) req.write(init.body);
    req.end();
  });
}

export interface OrderClient {
  getAlgorithms(): Promise<unknown>;
  getOrderBook(algorithm: string): Promise<unknown>;
  getSimpleMultiAlgo(): Promise<unknown>;
  getBalance(): Promise<unknown>;
  getMyOrders(): Promise<unknown>;
  createPool(body: unknown): Promise<unknown>;
  createOrder(body: unknown): Promise<unknown>;
  updatePriceAndLimit(body: unknown): Promise<unknown>;
  deleteOrder(id: string): Promise<unknown>;
  /** Private calls attempted. Empty when dry-run. */
  sent: SignedRequest[];
}

export interface ClientOptions {
  live: boolean;
  creds?: NiceHashCredentials;
  http?: HttpClient;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export function createOrderClient(opts: ClientOptions): OrderClient {
  const sent: SignedRequest[] = [];
  const http = opts.http ?? nodeHttpClient();
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 4;

  async function publicGet(path: string, query = ''): Promise<unknown> {
    const url = API_BASE + path + (query ? `?${query}` : '');
    let wait = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await http(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (res.status === 429 && attempt < maxRetries) {
        const retry = Number(header(res, 'retry-after'));
        await sleep(Number.isFinite(retry) && retry > 0 ? retry * 1000 : wait);
        wait *= 2;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`NiceHash ${res.status} ${path}`);
      }
      return JSON.parse(res.body);
    }
    throw new Error(`NiceHash gave up on ${path}`);
  }

  async function privateSend(method: string, path: string, query = '', body: unknown = undefined): Promise<unknown> {
    if (!opts.live) {
      throw new Error(`refusing private ${method} ${path}: set LIVE=1 to send orders`);
    }
    if (!opts.creds) throw new Error('missing NiceHash credentials');
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signed = signRequest(opts.creds, method, path, query, raw);
    sent.push(signed);
    const url = API_BASE + path + (query ? `?${query}` : '');
    const res = await http(url, { method: signed.method, headers: signed.headers, body: raw || undefined });
    if (res.status < 200 || res.status >= 300) throw new Error(`NiceHash ${res.status} ${path} ${res.body.slice(0, 180)}`);
    return res.body ? JSON.parse(res.body) : {};
  }

  return {
    sent,
    getAlgorithms: () => publicGet('/main/api/v2/mining/algorithms'),
    getOrderBook: (algorithm) => publicGet('/main/api/v2/hashpower/orderBook', `algorithm=${encodeURIComponent(algorithm)}&page=0&size=1000`),
    getSimpleMultiAlgo: () => publicGet('/main/api/v2/public/simplemultialgo/info'),
    getBalance: () => privateSend('GET', '/main/api/v2/accounting/accounts2'),
    getMyOrders: () => privateSend('GET', '/main/api/v2/hashpower/myOrders'),
    createPool: (body) => privateSend('POST', '/main/api/v2/pool', '', body),
    createOrder: (body) => privateSend('POST', '/main/api/v2/hashpower/order', '', body),
    updatePriceAndLimit: (body) => privateSend('POST', '/main/api/v2/hashpower/order/updatePriceAndLimit', '', body),
    deleteOrder: (id) => privateSend('DELETE', '/main/api/v2/hashpower/order', `id=${encodeURIComponent(id)}`),
  };
}

function header(res: HttpResult, name: string): string | undefined {
  const v = res.headers[name] ?? res.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Build the pool username the proxy routes on. */
export function poolUser(algorithm: string, coin: string, orderId: string): string {
  return `${algorithm}.${coin}.${orderId}`;
}
