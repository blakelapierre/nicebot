/** Local page plus a websocket of orchestrator state. The page is a view. No third-party websocket library. */

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface GuiSocket {
  send(text: string): void;
  close(): void;
}

export interface GuiServer {
  port: number;
  publish(snapshot: unknown): void;
  confirmed(): unknown[];
  close(): Promise<void>;
}

export async function startGui(port = 5555): Promise<GuiServer> {
  const page = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'index.html'));
  const clients = new Set<GuiSocket>();
  const clicks: unknown[] = [];
  let last = JSON.stringify({ type: 'snapshot', state: null });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const client = wrap(socket as net.Socket, msg => {
      try {
        const parsed = JSON.parse(msg);
        if (parsed && parsed.type === 'confirm') clicks.push(parsed);
      } catch {
        clicks.push({ type: 'bad', raw: msg });
      }
    });
    clients.add(client);
    client.send(last);
    socket.on('close', () => clients.delete(client));
  });

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', () => resolve()));
  const bound = (server.address() as { port: number }).port;

  return {
    port: bound,
    publish(snapshot) {
      last = JSON.stringify({ type: 'snapshot', state: snapshot });
      for (const c of clients) c.send(last);
    },
    confirmed: () => clicks.slice(),
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

function wrap(socket: net.Socket, onText: (text: string) => void): GuiSocket {
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const frame = takeFrame(buf);
      if (!frame) break;
      buf = buf.subarray(frame.rest);
      if (frame.opcode === 0x8) socket.end();
      else if (frame.opcode === 0x1) onText(frame.payload.toString('utf8'));
    }
  });
  return {
    send(text: string) { if (!socket.destroyed) socket.write(encodeText(text)); },
    close() { socket.destroy(); },
  };
}

function encodeText(text: string): Buffer {
  const payload = Buffer.from(text);
  const len = payload.length;
  if (len < 126) return Buffer.concat([Buffer.from([0x81, len]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(len, 2);
  return Buffer.concat([header, payload]);
}

function takeFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: number } | undefined {
  if (buf.length < 2) return undefined;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return undefined;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) return undefined;
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return undefined;
  const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, rest: offset + maskLen + len };
}
