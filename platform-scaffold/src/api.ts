// Minimal HTTP API over the core (Node built-in http — zero deps).
// This mirrors the /v1 surface in the Technical Blueprint. A real build swaps this
// for NestJS controllers; the service layer underneath is unchanged.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.ts';

const app = buildApp();

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

export function startServer(port = 3000) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'POST' && path === '/v1/quotes') {
        const body = await readBody(req);
        const q = await app.ordering.resolveAndQuote(String(body.url ?? ''), String(body.customerId ?? 'CUST-1'));
        return send(res, 200, q);
      }
      if (method === 'POST' && path === '/v1/orders') {
        const body = await readBody(req);
        const o = app.ordering.createOrder(String(body.quoteId), String(body.customerId ?? 'CUST-1'));
        return send(res, 201, { id: o.id, state: o.state });
      }
      const m = path.match(/^\/v1\/orders\/([^/]+)(\/(pay|procure|fulfil))?$/);
      if (m) {
        const id = m[1];
        const action = m[3];
        if (method === 'GET') {
          const o = app.orders.get(id);
          return o ? send(res, 200, o) : send(res, 404, { error: 'not found' });
        }
        if (method === 'POST' && action === 'pay') { await app.ordering.pay(id); return send(res, 200, app.orders.get(id)); }
        if (method === 'POST' && action === 'procure') { await app.ordering.procure(id); return send(res, 200, app.orders.get(id)); }
        if (method === 'POST' && action === 'fulfil') { await app.ordering.fulfil(id); return send(res, 200, app.orders.get(id)); }
      }
      if (method === 'GET' && path === '/v1/admin/orders') {
        return send(res, 200, app.orders.all().map((o) => ({ id: o.id, state: o.state })));
      }
      send(res, 404, { error: 'route not found', path });
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
    }
  });
  server.listen(port, () => console.log(`API listening on http://localhost:${port}  (try POST /v1/quotes {"url":"https://www.amazon.ae/dp/X"})`));
  return server;
}
