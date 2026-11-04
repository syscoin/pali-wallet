const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { createNativeHttpFetch } = require('../src/platform/httpPolicy.ts');
const { createHttpFixture } = require('./http-server.cjs');
const { assertAudit } = require('./http-companion.cjs');
const { assertPostAudit, partialPostAudit } = require('./post-server.cjs');
const { POST_CASES, assertPostReport, postDiagnosticCase, validPostFailureDetail } = require('./post-contract.ts');
const { POST_CHAIN_BODY, POST_RETRY_BODY, POST_RETRY_PAYLOAD } = require('./post-fixtures.ts');
const { qualifyNativePost, PostQualificationError } = require('./post-native.ts');
const { qualifyNativeHttp } = require('./http-native.ts');
const token = 'c'.repeat(32), build = { version: 1, sourceRevision: 'a'.repeat(40), lockfileSha256: 'b'.repeat(64) };
const expected = { sourceRevision: build.sourceRevision, lockfileSha256: build.lockfileSha256, token, phase: 'create', scenario: 'import', platform: 'ios' };
const report = () => ({ ...build, kind: 'native-post', status: 'passed', nativePostQualified: true, token,
  phase: 'create', scenario: 'import', platform: 'ios', sessionId: '11111111-1111-1111-1111-111111111111', networkCalls: 0, cases: [...POST_CASES] });
const options = (fixture, walletFetch = createNativeHttpFetch(fetch)) => ({ launch: { port: fixture.port, token }, build,
  walletFetch, phase: 'create', scenario: 'import', platform: 'ios', sessionId: report().sessionId, networkCalls: () => 0 });
let validAudit;
test('actual Node loopback control retains seven GET cases and independently validates five POST cases', async () => {
  const fixture = await createHttpFixture(); fixture.begin(token);
  let cookie;
  try {
    const get = await qualifyNativeHttp({ ...options(fixture), cookieFetch: async (url, init) => {
      const headers = new Headers(init.headers); if (cookie) headers.set('Cookie', cookie);
      const value = await fetch(url, { ...init, headers }); const set = value.headers.get('set-cookie');
      if (set) cookie = set.includes('Max-Age=0') ? undefined : set.split(';')[0]; return value;
    } });
    assert.equal(get.cases.length, 7);
    const post = await qualifyNativePost(options(fixture)); assertPostReport(post, expected);
    const all = fixture.snapshotAll(token); assertAudit(all.get, token, fixture.port); assertPostAudit(all.post, token, fixture.port);
    validAudit = all.post;
    const lost = all.post.requests.filter(r => r.route === 'post-lost'); assert.equal(lost.length, 2);
    assert.equal(lost[0].bodySha256, createHash('sha256').update(POST_RETRY_BODY).digest('hex'));
    assert.equal(lost[0].bodySha256, lost[1].bodySha256);
    assert.equal(lost[0].payloadSha256, createHash('sha256').update(Buffer.from(POST_RETRY_PAYLOAD.slice(2), 'hex')).digest('hex'));
  } finally { await fixture.close(); }
});
test('POST report requires exact source, session shape, cases, and schema; failed diagnostics cannot pass', () => {
  assertPostReport(report(), expected);
  for (const field of Object.keys(report())) { const bad = report(); delete bad[field]; assert.throws(() => assertPostReport(bad, expected)); }
  for (const patch of [{ nativePostQualified: false }, { token: 'd'.repeat(32) }, { sourceRevision: 'd'.repeat(40) }, { lockfileSha256: 'd'.repeat(64) },
    { platform: 'android' }, { phase: 'restart' }, { scenario: 'generate' }, { sessionId: 'wrong' }, { networkCalls: 1 }, { cases: [...POST_CASES].reverse() },
    { kind: 'native-http' }, { unexpected: true }]) assert.throws(() => assertPostReport({ ...report(), ...patch }, expected));
  const diagnostic = { ...build, ...expected, kind: 'native-post-diagnostic', status: 'failed', diagnosticOnly: true, failedCase: POST_CASES[0],
    failureDetail: { route: 'post-balance', attempt: 0, rejection: 'none' }, sessionId: report().sessionId };
  assert.equal(postDiagnosticCase(diagnostic, expected), POST_CASES[0]); assert.throws(() => assertPostReport(diagnostic, expected));
  for (const detail of [null, {}, { ...diagnostic.failureDetail, route: 'https://untrusted.invalid' }, { ...diagnostic.failureDetail, attempt: 3 },
    { ...diagnostic.failureDetail, rejection: 'private error text' }, { ...diagnostic.failureDetail, raw: 'body' }]) {
    assert.equal(validPostFailureDetail(detail), false); assert.equal(postDiagnosticCase({ ...diagnostic, failureDetail: detail }, expected), undefined);
  }
});
test('host rejects missing/different digests, request counts and lost-response or close evidence', () => {
  assert(validAudit);
  for (const mutate of [v => { v.requests.pop(); }, v => { v.requests[0].bodySha256 = '0'.repeat(64); }, v => { v.requests.at(-1).payloadSha256 = null; },
    v => { v.counts['post-lost'].started = 3; }, v => { v.counts['post-balance'].completed = 1; }, v => { v.closed.abort = false; },
    v => { v.closed.stream = false; }, v => { v.closed.declared = false; }, v => { v.lostResponses = 0; }, v => { v.invalid = 1; },
    v => { v.requests[0].rawBody = POST_CHAIN_BODY; }]) { const value = structuredClone(validAudit); mutate(value); assert.throws(() => assertPostAudit(value, token, validAudit.port)); }
  assert(partialPostAudit(validAudit, token, validAudit.port));
  const raw = structuredClone(validAudit); raw.requests[0].rawBody = POST_CHAIN_BODY; assert.equal(partialPostAudit(raw, token, validAudit.port), null);
});
test('body rewrite, wrong headers and accidental automatic retry fail the native POST gate', async () => {
  for (const mode of ['body', 'header', 'retry']) {
    const fixture = await createHttpFixture(); fixture.begin(token);
    try {
      const native = createNativeHttpFetch(fetch);
      const changed = async (url, init) => {
        if (mode === 'body') return native(url, { ...init, body: String(init.body) + ' ' });
        if (mode === 'header') return native(url, { ...init, headers: { ...init.headers, 'Content-Type': 'text/plain' } });
        if (!url.includes('/post-lost?')) return native(url, init);
        try {
          const response = await native(url, init);
          // Model a hidden full-response retry, including failure after headers.
          await response.clone().arrayBuffer(); return response;
        } catch { return native(url, init); }
      };
      await assert.rejects(qualifyNativePost(options(fixture, changed)));
      // Hidden retry can reproduce the final byte counts; the native outcome
      // check must independently reject its falsely successful first attempt.
      if (mode !== 'retry') assert.throws(() => assertPostAudit(fixture.inspectAll(token).post, token, fixture.port));
    } finally { await fixture.close(); }
  }
});

test('bounded diagnostics distinguish size-route errors from explicit retry outcomes', async () => {
  for (const mode of ['declared-error', 'first-success', 'second-error']) {
    const fixture = await createHttpFixture(); fixture.begin(token);
    try {
      const native = createNativeHttpFetch(fetch); let explicitAttempts = 0;
      const changed = async (url, init) => {
        if (mode === 'declared-error' && url.includes('/post-declared?')) throw Error('private transport detail');
        if (url.includes('/post-lost?')) {
          explicitAttempts++;
          if (mode === 'first-success') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 47, result: '0x20000000000001' }),
            { headers: { 'Content-Type': 'application/json' } });
          if (mode === 'second-error' && explicitAttempts === 2) throw Error('private transport detail');
        }
        return native(url, init);
      };
      // Supply the captured response URL to model a valid successful first call.
      const fetcher = async (url, init) => {
        const response = await changed(url, init);
        if (mode === 'first-success' && url.includes('/post-lost?')) Object.defineProperty(response, 'url', { value: url });
        return response;
      };
      await assert.rejects(qualifyNativePost(options(fixture, fetcher)), error => {
        assert(error instanceof PostQualificationError);
        assert.deepEqual(error.failureDetail, mode === 'declared-error'
          ? { route: 'post-declared', attempt: 0, rejection: 'other' }
          : { route: 'post-lost', attempt: mode === 'first-success' ? 1 : 2, rejection: mode === 'first-success' ? 'none' : 'other' });
        assert(!JSON.stringify(error).includes('private transport detail')); return true;
      });
      if (mode === 'first-success') assert.equal(explicitAttempts, 1);
    } finally { await fixture.close(); }
  }
});
