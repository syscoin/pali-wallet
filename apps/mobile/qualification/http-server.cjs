const http = require('node:http');
const { Buffer } = require('node:buffer');
const { timingSafeEqual } = require('node:crypto');

const ROUTES = Object.freeze(['exact', 'redirect', 'target', 'seed', 'cookie-present', 'cookie-omitted', 'clear-cookie',
  'before', 'before-ready', 'before-closed', 'body', 'body-closed', 'oversize', 'oversize-closed', 'healthy']);
const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** No upstream client or proxy exists. Every socket binds only 127.0.0.1. */
async function createHttpFixture() {
  const sockets = new Set();
  let active;
  let port;
  const server = http.createServer((request, response) => {
    if (!active || request.method !== 'GET' || request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined ||
        request.headers.host !== `127.0.0.1:${port}` ||
        typeof request.url !== 'string' || request.url.length > 256) {
      if (active) active.invalid++;
      response.writeHead(400); response.end(); return;
    }
    const match = /^\/([0-9a-f]{32})\/([a-z-]+)\?q=exact$/.exec(request.url);
    if (!match || !equal(match[1], active.token) || !ROUTES.includes(match[2])) {
      active.invalid++; response.writeHead(400); response.end(); return;
    }
    const state = active;
    const route = match[2];
    state.counts[route]++;
    const ok = () => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end('{"ok":true}'); };
    const bad = () => { state.invalid++; response.writeHead(400); response.end(); };
    const cookie = `pali_native_http=${state.token}`;
    if (route === 'cookie-present' ? request.headers.cookie !== cookie : route !== 'clear-cookie' && request.headers.cookie !== undefined) {
      bad(); return;
    }
    const notify = () => {
      for (const [predicate, complete] of [...state.waiters]) if (predicate()) complete();
    };
    const wait = (predicate) => {
      if (predicate()) { ok(); return; }
      const item = [predicate, () => { clearTimeout(timer); state.waiters.delete(item); if (!response.destroyed) ok(); }];
      const timer = setTimeout(() => { state.waiters.delete(item); if (!response.destroyed) { state.invalid++; response.writeHead(408); response.end(); } }, 6000);
      state.waiters.add(item);
      response.once('close', () => { clearTimeout(timer); state.waiters.delete(item); });
    };
    if (route === 'target') { state.invalid++; ok(); return; }
    if (route === 'redirect') {
      response.writeHead(302, { Location: `http://127.0.0.1:${port}/${state.token}/target?q=exact`, 'Cache-Control': 'no-store' }); response.end(); return;
    }
    if (route === 'seed' || route === 'clear-cookie') {
      response.setHeader('Set-Cookie', `${cookie}; Path=/${state.token}/; HttpOnly; Max-Age=${route === 'seed' ? '60' : '0'}`);
      ok(); return;
    }
    if (route === 'before-ready') { wait(() => state.counts.before === 1); return; }
    if (route.endsWith('-closed')) { wait(() => state.closed[route.slice(0, -7)] === true); return; }
    if (['before', 'body', 'oversize'].includes(route)) {
      let selfClosed = false;
      const timeout = setTimeout(() => { selfClosed = true; response.destroy(); }, 7000);
      let interval;
      response.once('close', () => {
        clearTimeout(timeout); clearInterval(interval);
        state.closed[route] = !selfClosed && !response.writableFinished;
        notify();
      });
      if (route === 'body') { response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); response.write('start'); }
      if (route === 'oversize') {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        let sent = 0;
        interval = setInterval(() => {
          if (response.destroyed) return;
          sent += 1024;
          response.write(Buffer.alloc(1024, 65));
          if (sent >= 256 * 1024) { selfClosed = true; response.end(); clearInterval(interval); }
        }, 5);
      }
      notify(); return;
    }
    ok();
  });
  server.maxHeadersCount = 24;
  server.maxConnections = 12;
  server.headersTimeout = 5000;
  server.requestTimeout = 10_000;
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  return {
    port,
    begin(token) {
      if (active || typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) throw Error('HTTP_FIXTURE_BEGIN_INVALID');
      active = { token, counts: Object.fromEntries(ROUTES.map((route) => [route, 0])), invalid: 0, closed: { before: false, body: false, oversize: false }, waiters: new Set() };
    },
    snapshot(token) {
      if (!active || !equal(token, active.token)) throw Error('HTTP_FIXTURE_TOKEN_INVALID');
      const result = { token: active.token, port, counts: { ...active.counts }, invalid: active.invalid, closed: { ...active.closed } };
      active = undefined;
      return result;
    },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}

if (require.main === module) {
  if (!process.send || process.env.PALI_HTTP_FIXTURE !== '1') throw Error('HTTP_FIXTURE_PARENT_REQUIRED');
  let fixture;
  const stop = async () => { await fixture?.close(); process.exit(0); };
  process.once('disconnect', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  const lifetime = setTimeout(() => { void stop(); }, 20 * 60_000);
  lifetime.unref();
  createHttpFixture().then((value) => {
    fixture = value; process.send({ kind: 'ready', port: fixture.port });
    process.on('message', (message) => {
      try {
        if (!message || !Number.isSafeInteger(message.id)) throw Error('HTTP_FIXTURE_MESSAGE_INVALID');
        if (message.kind === 'begin') { fixture.begin(message.token); process.send({ id: message.id, ok: true }); }
        else if (message.kind === 'snapshot') process.send({ id: message.id, ok: true, value: fixture.snapshot(message.token) });
        else if (message.kind === 'close') void stop();
        else throw Error('HTTP_FIXTURE_MESSAGE_INVALID');
      } catch { process.send({ id: message?.id, ok: false }); }
    });
  }).catch(() => process.exit(1));
}
module.exports = { createHttpFixture, ROUTES };
