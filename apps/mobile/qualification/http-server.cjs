const http = require('node:http');
const { Buffer } = require('node:buffer');
const { timingSafeEqual } = require('node:crypto');
const { QUOTE_EARLY_REJECTIONS, STALLED_QUOTE_ROUTE, PUBLIC_SNAPSHOT_FIXTURE_PATH,
  PUBLIC_SNAPSHOT_FIXTURE_BODY } = require('./http-contract.ts');
const { POST_ROUTES } = require('./post-fixtures.ts');
const { createPostState, postSnapshot, handlePostRoute } = require('./post-server.cjs');

const QUOTE_ROUTES = [...QUOTE_EARLY_REJECTIONS.map(({ route }) => route), STALLED_QUOTE_ROUTE];
const HELD_ROUTES = Object.freeze(['before', 'body', 'oversize', ...QUOTE_ROUTES]);
const ROUTES = Object.freeze(['exact', 'identify', 'redirect', 'target', 'seed', 'cookie-present', 'cookie-omitted', 'clear-cookie',
  'before', 'before-ready', 'before-closed', 'body', 'body-closed', 'oversize', 'oversize-closed',
  ...QUOTE_ROUTES.flatMap((route) => [route, `${route}-closed`]), 'public-snapshot', 'healthy']);
const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** No upstream client or proxy exists. Every socket binds only 127.0.0.1. */
async function createHttpFixture() {
  const sockets = new Set();
  let active;
  let port;
  const server = http.createServer((request, response) => {
    if (!active || request.headers.host !== `127.0.0.1:${port}` ||
        typeof request.url !== 'string' || request.url.length > 256) {
      if (active) active.invalid++;
      response.writeHead(400); response.end(); return;
    }
    // The production downloader appends a fixed path, so this public fixture
    // is tied to the active launch's dedicated port instead of a URL token.
    if (request.url === PUBLIC_SNAPSHOT_FIXTURE_PATH) {
      if (request.method !== 'GET' || request.headers['user-agent'] !== 'PaliWallet' ||
          request.headers['accept-encoding'] !== 'identity' ||
          ['cookie', 'authorization', 'referer', 'proxy-authorization', 'content-length', 'transfer-encoding']
            .some((key) => request.headers[key] !== undefined)) {
        active.invalid++; response.writeHead(400); response.end(); return;
      }
      active.counts['public-snapshot']++;
      response.writeHead(200, { 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(PUBLIC_SNAPSHOT_FIXTURE_BODY), 'Cache-Control': 'no-store' });
      response.end(PUBLIC_SNAPSHOT_FIXTURE_BODY);
      return;
    }
    const quote = /^\/([0-9a-f]{32})\/(quote-(?:non-ok|oversize|stalled))\/api\/v2\/tickers\/currency$/.exec(request.url);
    const match = quote ?? /^\/([0-9a-f]{32})\/([a-z-]+)\?q=exact$/.exec(request.url);
    if (!match || !equal(match[1], active.token) || ![...ROUTES, ...POST_ROUTES].includes(match[2]) ||
        QUOTE_ROUTES.includes(match[2]) !== !!quote) {
      active.invalid++; response.writeHead(400); response.end(); return;
    }
    const state = active;
    const route = match[2];
    if (POST_ROUTES.includes(route)) { handlePostRoute(request, response, route, state.post); return; }
    if (route === 'identify') {
      state.counts[route]++;
      const parts = [];
      let bytes = 0;
      request.on('data', part => { bytes += part.length; if (bytes > 128) request.destroy(); else parts.push(part); });
      request.on('end', () => {
        if (request.method !== 'POST' || request.headers['user-agent'] !== 'PaliWallet' ||
            request.headers.authorization !== 'Bearer public-http-fixture' || Buffer.concat(parts).toString() !== 'pali-http-identity-fixture') {
          state.invalid++; response.writeHead(400); response.end(); return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}');
      });
      return;
    }
    if (request.method !== 'GET' || request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined) {
      state.invalid++; response.writeHead(400); response.end(); return;
    }
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
    if (HELD_ROUTES.includes(route)) {
      let selfClosed = false;
      // The production quote deadline is eight seconds. Server retirement
      // must be later and can never count as proof that the client cancelled.
      const timeout = setTimeout(() => { selfClosed = true; response.destroy(); }, route === STALLED_QUOTE_ROUTE ? 12_000 : 7000);
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
      if (quote) {
        const { status, length } = QUOTE_EARLY_REJECTIONS.find((entry) => entry.route === route) ?? { status: 200, length: '64' };
        response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': length, 'Cache-Control': 'no-store' });
        // Foundation may withhold the response callback until a body byte
        // arrives. Only the stall case withholds every byte; the two early
        // refusals must see headers while the connection is still held open.
        if (route === STALLED_QUOTE_ROUTE) response.flushHeaders();
        else response.write('{');
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
      active = { token, counts: Object.fromEntries(ROUTES.map((route) => [route, 0])), invalid: 0,
        closed: Object.fromEntries(HELD_ROUTES.map((route) => [route, false])), waiters: new Set(), post: createPostState(token, port) };
    },
    inspect(token) {
      if (!active || !equal(token, active.token)) throw Error('HTTP_FIXTURE_TOKEN_INVALID');
      return { token: active.token, port, counts: { ...active.counts }, invalid: active.invalid, closed: { ...active.closed } };
    },
    snapshot(token) {
      const result = this.inspect(token);
      active = undefined;
      return result;
    },
    inspectAll(token) { const get = this.inspect(token); return { get, post: postSnapshot(active.post) }; },
    snapshotAll(token) { const result = this.inspectAll(token); active = undefined; return result; },
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
        else if (['snapshot', 'inspect', 'snapshotAll', 'inspectAll'].includes(message.kind)) process.send({ id: message.id, ok: true, value: fixture[message.kind](message.token) });
        else if (message.kind === 'close') void stop();
        else throw Error('HTTP_FIXTURE_MESSAGE_INVALID');
      } catch { process.send({ id: message?.id, ok: false }); }
    });
  }).catch(() => process.exit(1));
}
/** Node control for the fixture tests only. The app uses the Expo bridge. */
const snapshotFixtureControl = {
  prepareSnapshot(pool, origin, signal) {
    if (pool !== 'eth-1') throw Error('HTTP_FIXTURE_POOL_INVALID');
    let bytes, offset = 0;
    return {
      async start(check) {
        check();
        const response = await fetch(origin + PUBLIC_SNAPSHOT_FIXTURE_PATH, { signal, redirect: 'error',
          headers: { 'User-Agent': 'PaliWallet', 'Accept-Encoding': 'identity' } });
        bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, byteCount: bytes.byteLength };
      },
      async pull(check) {
        check();
        if (offset === bytes.length) return null;
        const chunk = bytes.slice(offset, offset + 64 * 1024); offset += chunk.length;
        return chunk;
      },
      async release() { bytes = undefined; },
    };
  },
};
module.exports = { createHttpFixture, ROUTES, HELD_ROUTES, snapshotFixtureControl };
