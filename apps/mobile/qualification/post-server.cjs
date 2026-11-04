const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { POST_BODIES, POST_CONTROLS, POST_ROUTES, POST_REQUEST_LIMIT, POST_QUANTITY, POST_RETRY_PAYLOAD } = require('./post-fixtures.ts');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const expectedCount = route => POST_CONTROLS.includes(route) ? 1 : POST_BODIES[route].length;
const expectedRecord = (route, ordinal) => {
  const body = POST_BODIES[route][ordinal - 1];
  return { route, ordinal, id: JSON.parse(body).id, bytes: Buffer.byteLength(body), bodySha256: sha(body),
    payloadSha256: route === 'post-lost' ? sha(Buffer.from(POST_RETRY_PAYLOAD.slice(2), 'hex')) : null };
};
function createPostState(token, port) {
  return { token, port, invalid: 0, counts: Object.fromEntries(POST_ROUTES.map(route => [route, { started: 0, completed: 0 }])),
    closed: { declared: false, stream: false, abort: false }, lostResponses: 0, requests: [], waiters: new Set() };
}
function postSnapshot(state) {
  return { version: 1, token: state.token, port: state.port, invalid: state.invalid,
    counts: Object.fromEntries(Object.entries(state.counts).map(([route, count]) => [route, { ...count }])),
    closed: { ...state.closed }, lostResponses: state.lostResponses, requests: state.requests.map(record => ({ ...record })) };
}
function assertPostAudit(value, token, port) {
  if (!exact(value, ['version', 'token', 'port', 'invalid', 'counts', 'closed', 'lostResponses', 'requests']) ||
      value.version !== 1 || value.token !== token || value.port !== port || value.invalid !== 0 || value.lostResponses !== 1 ||
      !exact(value.counts, POST_ROUTES) || !exact(value.closed, ['declared', 'stream', 'abort']) || Object.values(value.closed).some(v => v !== true) ||
      !Array.isArray(value.requests) || value.requests.length !== Object.values(POST_BODIES).reduce((n, bodies) => n + bodies.length, 0))
    throw Error('POST_FIXTURE_AUDIT_FAILED');
  for (const route of POST_ROUTES) {
    const count = value.counts[route], expected = expectedCount(route);
    if (!exact(count, ['started', 'completed']) || count.started !== expected || count.completed !== expected) throw Error('POST_FIXTURE_AUDIT_FAILED');
  }
  const expected = Object.entries(POST_BODIES).flatMap(([route, bodies]) => bodies.map((_body, i) => expectedRecord(route, i + 1)));
  if (value.requests.some((record, i) => !exact(record, ['route', 'ordinal', 'id', 'bytes', 'bodySha256', 'payloadSha256']) ||
      JSON.stringify(record) !== JSON.stringify(expected[i]))) throw Error('POST_FIXTURE_AUDIT_FAILED');
}
function partialPostAudit(value, token, port) {
  if (!exact(value, ['version', 'token', 'port', 'invalid', 'counts', 'closed', 'lostResponses', 'requests']) || value.version !== 1 ||
      value.token !== token || value.port !== port || !Number.isSafeInteger(value.invalid) || value.invalid < 0 || value.invalid > 100000 ||
      !Number.isSafeInteger(value.lostResponses) || value.lostResponses < 0 || value.lostResponses > 100000 ||
      !exact(value.counts, POST_ROUTES) || !exact(value.closed, ['declared', 'stream', 'abort']) || Object.values(value.closed).some(v => typeof v !== 'boolean') ||
      !Array.isArray(value.requests) || value.requests.length > 32) return null;
  for (const count of Object.values(value.counts)) if (!exact(count, ['started', 'completed']) ||
      Object.values(count).some(n => !Number.isSafeInteger(n) || n < 0 || n > 100000)) return null;
  for (const record of value.requests) if (!exact(record, ['route', 'ordinal', 'id', 'bytes', 'bodySha256', 'payloadSha256']) ||
      !Object.hasOwn(POST_BODIES, record.route) || !Number.isSafeInteger(record.ordinal) || record.ordinal < 1 || record.ordinal > 32 ||
      !Number.isSafeInteger(record.id) || record.id < 1 || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > POST_REQUEST_LIMIT ||
      !/^[0-9a-f]{64}$/.test(record.bodySha256) || record.payloadSha256 !== null && !/^[0-9a-f]{64}$/.test(record.payloadSha256)) return null;
  return { ...value, counts: structuredClone(value.counts), closed: { ...value.closed }, requests: value.requests.map(r => ({ ...r })) };
}
function handlePostRoute(request, response, route, state) {
  const count = state.counts[route]; count.started++;
  const invalid = () => { state.invalid++; if (!response.destroyed) { response.writeHead(400); response.end(); } };
  const headers = request.headers;
  if (count.started > expectedCount(route) || headers.cookie !== undefined || headers.cookie2 !== undefined || headers.referer !== undefined ||
      headers.accept !== 'application/json' || headers['cache-control'] !== 'no-store, no-cache' || headers.pragma !== 'no-cache') { invalid(); return; }
  const notify = () => { for (const [predicate, complete] of [...state.waiters]) if (predicate()) complete(); };
  const ok = body => { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(body); };
  if (POST_CONTROLS.includes(route)) {
    if (request.method !== 'GET' || headers['content-length'] !== undefined || headers['transfer-encoding'] !== undefined) { invalid(); return; }
    count.completed++;
    const predicate = route === 'post-ready' ? () => state.counts['post-abort'].completed === 1 : () => Object.values(state.closed).every(Boolean);
    if (predicate()) { ok('{"ok":true}'); return; }
    const entry = [predicate, () => { clearTimeout(timer); state.waiters.delete(entry); if (!response.destroyed) ok('{"ok":true}'); }];
    const timer = setTimeout(() => { state.waiters.delete(entry); invalid(); }, 6000);
    state.waiters.add(entry); response.once('close', () => { clearTimeout(timer); state.waiters.delete(entry); }); return;
  }
  const length = headers['content-length'];
  if (request.method !== 'POST' || headers['content-type'] !== 'application/json' ||
      length !== undefined && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > POST_REQUEST_LIMIT) ||
      headers['transfer-encoding'] !== undefined && headers['transfer-encoding'] !== 'chunked' ||
      length !== undefined && headers['transfer-encoding'] !== undefined) { invalid(); return; }
  let size = 0, ended = false, failed = false;
  const chunks = [];
  const failBody = () => { if (failed) return; failed = true; state.invalid++; clearTimeout(bodyTimer); request.destroy(); };
  const bodyTimer = setTimeout(failBody, 6000);
  request.on('data', chunk => { size += chunk.length; if (size > POST_REQUEST_LIMIT) failBody(); else chunks.push(chunk); });
  request.once('aborted', failBody);
  request.once('error', () => { if (!ended) failBody(); });
  request.once('end', () => {
    ended = true; clearTimeout(bodyTimer); if (failed) return;
    const bytes = Buffer.concat(chunks), expected = POST_BODIES[route][count.started - 1];
    if (length !== undefined && Number(length) !== size || !bytes.equals(Buffer.from(expected))) { invalid(); return; }
    count.completed++;
    if (state.requests.length >= 32) { invalid(); return; }
    const actual = JSON.parse(bytes.toString('utf8'));
    state.requests.push({ route, ordinal: count.completed, id: actual.id, bytes: size, bodySha256: sha(bytes),
      payloadSha256: route === 'post-lost' ? sha(Buffer.from(actual.params[0].slice(2), 'hex')) : null }); notify();
    const id = JSON.parse(expected).id;
    const result = route === 'post-zero' && id === 2 ? '0x0' : id === 1 ? '0x1' : POST_QUANTITY;
    const body = JSON.stringify({ jsonrpc: '2.0', id, result });
    if (route === 'post-lost' && count.completed === 1) { state.lostResponses++; response.destroy(); return; }
    if (route === 'post-id') { ok(JSON.stringify({ jsonrpc: '2.0', id: id + 1, result })); return; }
    if (route === 'post-error') { ok(JSON.stringify({ jsonrpc: '2.0', id, result, error: { code: -32603, message: 'fixture error' } })); return; }
    if (route === 'post-malformed') { ok('{"jsonrpc":'); return; }
    if (route === 'post-type') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end(body); return; }
    if (['post-declared', 'post-stream', 'post-abort'].includes(route)) {
      const name = route.slice(5); let selfClosed = false, interval;
      const timer = setTimeout(() => { selfClosed = true; response.destroy(); }, 7000);
      response.once('close', () => { clearTimeout(timer); clearInterval(interval); state.closed[name] = !selfClosed && !response.writableFinished; notify(); });
      if (route === 'post-declared') { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '16385' }); response.flushHeaders(); }
      if (route === 'post-stream') {
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"jsonrpc":"2.0","id":1,"result":"'); let sent = 0;
        interval = setInterval(() => { if (response.destroyed) return; response.write('A'.repeat(1024)); sent += 1024;
          if (sent >= 65536) { selfClosed = true; response.end('"}'); clearInterval(interval); } }, 5);
      }
      return;
    }
    // Deliberately split a valid JSON response across native stream boundaries.
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.write(body.slice(0, 11));
    const timer = setTimeout(() => response.end(body.slice(11)), 2); response.once('close', () => clearTimeout(timer));
  });
}
module.exports = { createPostState, postSnapshot, assertPostAudit, partialPostAudit, handlePostRoute };
