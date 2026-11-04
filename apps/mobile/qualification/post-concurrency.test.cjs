const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fork } = require('node:child_process');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const { startHttpCompanion } = require('./http-companion.cjs');
const { assertPostAudit } = require('./post-server.cjs');
const { POST_CHAIN_BODY, POST_BALANCE_BODY, POST_BODIES, POST_CONTROLS, POST_ROUTES, POST_RETRY_PAYLOAD } = require('./post-fixtures.ts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const completeAudit = (token, port) => ({ version: 1, token, port, invalid: 0, lostResponses: 1,
  counts: Object.fromEntries(POST_ROUTES.map(route => { const n = POST_CONTROLS.includes(route) ? 1 : POST_BODIES[route].length; return [route, { started: n, completed: n }]; })),
  closed: { declared: true, stream: true, abort: true },
  requests: Object.entries(POST_BODIES).flatMap(([route, bodies]) => bodies.map((body, i) => ({ route, ordinal: i + 1, id: JSON.parse(body).id,
    bytes: Buffer.byteLength(body), bodySha256: digest(body), payloadSha256: route === 'post-lost' ? digest(Buffer.from(POST_RETRY_PAYLOAD.slice(2), 'hex')) : null }))) });

for (const mode of ['excess', 'out-of-order']) test(`real child retains per-request identity after ${mode} arrivals`, { timeout: 10000 }, async () => {
  let child;
  const requests = [];
  const companion = await startHttpCompanion({ platform: 'ios', sourceRevision: 'a'.repeat(40),
    run() { throw Error('No device command belongs in this control'); },
    spawn(...args) { child = fork(...args); return child; } });
  try {
    const parameters = new URLSearchParams(await companion.begin('create', 'import'));
    const token = parameters.get('httpToken'), port = Number(parameters.get('httpPort'));
    const send = body => {
      let done;
      const result = new Promise(resolve => { done = resolve; });
      const request = http.request({ host: '127.0.0.1', port, path: `/${token}/post-balance?q=exact`, method: 'POST', agent: false,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache', Pragma: 'no-cache', 'Content-Length': Buffer.byteLength(body) } }, response => {
        response.resume(); response.once('end', () => done({ status: response.statusCode }));
      });
      request.once('error', error => done({ error: error.code })); requests.push(request); request.write(body[0]);
      return { finish: () => request.end(body.slice(1)), result };
    };
    const waitStarted = async n => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const state = (await companion.postDiagnostic()).server;
        if (state.counts['post-balance'].started === n) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('Requests did not arrive within the bounded fixture deadline');
    };
    const first = send(POST_CHAIN_BODY); await waitStarted(1);
    const second = send(POST_BALANCE_BODY); await waitStarted(2);
    if (mode === 'excess') {
      const third = send(POST_CHAIN_BODY); third.finish(); assert.equal((await third.result).status, 400);
      first.finish(); assert.equal((await first.result).status, 200);
      second.finish(); assert.equal((await second.result).status, 200);
    } else {
      second.finish(); assert.equal((await second.result).status, 200);
      first.finish(); assert.equal((await first.result).status, 200);
    }
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
    const observed = (await companion.postDiagnostic()).server;
    assert.deepEqual(observed.counts['post-balance'], { started: mode === 'excess' ? 3 : 2, completed: 2 });
    assert.deepEqual(observed.requests.map(row => row.ordinal), mode === 'excess' ? [1, 2] : [2, 1]);
    assert.equal(observed.requests.find(row => row.ordinal === 1).bodySha256, digest(POST_CHAIN_BODY));
    assert.equal(observed.requests.find(row => row.ordinal === 2).bodySha256, digest(POST_BALANCE_BODY));
    const audit = completeAudit(token, port);
    audit.invalid = observed.invalid; audit.counts['post-balance'] = observed.counts['post-balance'];
    audit.requests.splice(0, 2, ...observed.requests);
    assert.throws(() => assertPostAudit(audit, token, port), /POST_FIXTURE_AUDIT_FAILED/);
    assert.equal(companion.records.length, 0); assert.throws(() => companion.assertComplete(1));
  } finally {
    for (const request of requests) request.destroy();
    await companion.close();
  }
});
