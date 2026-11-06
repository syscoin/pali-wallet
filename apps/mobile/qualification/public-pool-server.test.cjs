const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const process = require('node:process');
const { after, before, test } = require('node:test');
const { createPublicPoolFixture } = require('./public-pool-server.cjs');
const { readPublicPoolCa } = require('./public-pool-ca.cjs');
const { readPublicPoolCiBuild, runHostedPublicPool } = require('./public-pool-ci.cjs');
const { parseQualificationLaunch } = require('./launch-parameters.ts');
const { qualifyNativePublicPool } = require('./public-pool-native.ts');
const { PUBLIC_POOL_ID, PUBLIC_POOL_PATH, PUBLIC_POOL_ROOT, publicPoolAnchorPath } = require('./public-pool-contract.ts');
const { createPublicSnapshotTransport } = require('../src/privacy/publicSnapshotTransport.ts');
const { PRIVACY_POOL_ABI } = require('../../../source/utils/privacy/publicSyncProtocol.ts');
const { evaluateMerkleBatch } = require('../tests/publicMerkleBatchFixture.ts');

let dir, tls, certPath, keyPath;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'pali-public-pool-tls-'));
  const config = join(dir, 'openssl.cnf');
  certPath = join(dir, 'fixture.pem'); keyPath = join(dir, 'fixture.key');
  writeFileSync(config, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=Pali disposable fixture\n[ext]\nbasicConstraints=critical,CA:TRUE\nsubjectAltName=IP:127.0.0.1\n');
  execFileSync('openssl', ['req', '-new', '-x509', '-nodes', '-newkey', 'rsa:2048', '-config', config,
    '-days', '1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore', timeout: 10_000 });
  tls = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  assert.match(readPublicPoolCa(certPath).sha256, /^[0-9a-f]{64}$/);
});
after(() => { if (dir) rmSync(dir, { force: true, recursive: true }); });

const headers = { 'user-agent': 'PaliWallet', 'accept-encoding': 'identity' };
function request(url, body, ca = tls.cert) {
  const client = url.startsWith('https:') ? https : http;
  const options = body === undefined ? { headers } : {
    ca, method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  };
  return new Promise((resolve, reject) => {
    const call = client.request(url, { ...options, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) }));
    });
    call.setTimeout(5000, () => call.destroy(Error('FIXTURE_TEST_TIMEOUT')));
    call.once('error', reject);
    call.end(body);
  });
}

/** Node replaces only the platform modules. App qualification supplies the real Expo modules. */
function snapshotBridge({ mutateGet, mutateAnchor } = {}) {
  let active;
  let generation = 0;
  const reserve = (load) => {
    assert.equal(active, undefined);
    active = { token: String(++generation), load, offset: 0 };
    return active.token;
  };
  return createPublicSnapshotTransport({
    preparePublicSnapshot(pool, origin) {
      assert.equal(pool, PUBLIC_POOL_ID);
      return reserve(async () => {
        const result = await request(origin + PUBLIC_POOL_PATH);
        return mutateGet ? mutateGet(result) : result;
      });
    },
    preparePublicSnapshotAnchor(endpoint, address, blockNumber, root, kind, id) {
      const block = '0x' + blockNumber.toString(16);
      let method, params;
      if (kind === 'chainId') { method = 'eth_chainId'; params = []; }
      else if (kind === 'block') { method = 'eth_getBlockByNumber'; params = [block, false]; }
      else {
        method = 'eth_call';
        params = [{ to: address, data: PRIVACY_POOL_ABI.encodeFunctionData(kind, kind === 'isKnownRoot' ? [root] : []) },
          kind === 'isKnownRoot' ? 'latest' : block];
      }
      return reserve(async () => {
        const result = await request(endpoint, JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        return mutateAnchor ? mutateAnchor(kind, result) : result;
      });
    },
    async startPublicSnapshot(token) {
      assert.equal(token, active.token);
      const result = await active.load();
      active.bytes = result.bytes;
      return { status: result.status, byteCount: result.bytes.byteLength };
    },
    async pullPublicSnapshot(token) {
      assert.equal(token, active.token);
      if (active.offset === active.bytes.length) return null;
      const value = active.bytes.subarray(active.offset, active.offset + 64 * 1024);
      active.offset += value.length;
      return value;
    },
    async releasePublicSnapshot(token) { assert.equal(token, active.token); active = undefined; },
  });
}

test('public pool launch accepts only separate loopback fixture ports with an exact token', () => {
  const token = 'b'.repeat(32);
  const base = 'pali-wallet-qualification://run?phase=create&scenario=import';
  const parameters = `&poolSnapshotPort=41000&poolAnchorPort=41001&poolToken=${token}`;
  assert.deepEqual(parseQualificationLaunch(base + parameters).publicPool, { snapshotPort: 41000, anchorPort: 41001, token });
  for (const launch of [
    base + parameters.replace('41001', '41000'), base + parameters + '&poolHost=external.invalid',
    base + parameters + `&httpPort=41000&httpToken=${token}`, base + '&poolSnapshotPort=41000',
    base.replace('scenario=import', 'scenario=generate') + parameters,
  ]) assert.throws(() => parseQualificationLaunch(launch));
});

test('hosted runner accepts a matching report after shared verification and both strict HTTPS passes', { timeout: 15_000 }, async () => {
  const build = { version: 1, sourceRevision: 'a'.repeat(40), lockfileSha256: 'b'.repeat(64) };
  const caSha256 = readPublicPoolCa(certPath).sha256;
  const receiptPath = join(dir, 'build.json');
  writeFileSync(receiptPath, JSON.stringify({ identifier: 'com.paliwallet.qualification',
    qualificationEntry: 'qualification/index.tsx', publicPool: { build, caSha256 } }));
  const config = readPublicPoolCiBuild({ CI: 'true', GITHUB_ACTIONS: 'true', PALI_NATIVE_QUALIFICATION: '1',
    PALI_NATIVE_PUBLIC_POOL_QUALIFICATION: '1', PALI_NATIVE_HTTP_QUALIFICATION: '0',
    PALI_PUBLIC_POOL_FIXTURE_CA: certPath, PALI_PUBLIC_POOL_FIXTURE_CERT: certPath,
    PALI_PUBLIC_POOL_FIXTURE_KEY: keyPath, GITHUB_SHA: build.sourceRevision }, receiptPath);
  let result;
  const verified = await runHostedPublicPool({
    platform: 'android', output: dir, config,
    execute: async ({ uri, report, ports }) => {
      const { publicPool: launch } = parseQualificationLaunch(uri);
      assert.equal(report, `pali-native-public-pool-${launch.token}.json`);
      assert.deepEqual(ports, [launch.snapshotPort, launch.anchorPort]);
      result = await qualifyNativePublicPool({ launch, transport: snapshotBridge(),
        executeMerkleBatch: evaluateMerkleBatch, lifetime: new AbortController().signal });
      assert.equal(result.root, PUBLIC_POOL_ROOT);
      return JSON.stringify({ ...build, caSha256, platform: 'android', kind: 'native-public-pool',
        status: 'passed', token: launch.token, networkCalls: 0, sessionId: '00000000-0000-4000-8000-000000000000', result });
    },
  });
  assert.deepEqual(verified, { passed: true, ...build, platform: 'android', caSha256, result });
});

test('fixture refuses a forged anchor call and records it even if it later receives correct calls', async () => {
  const fixture = await createPublicPoolFixture(tls);
  try {
    const { snapshotPort, anchorPort, token } = fixture.launch;
    assert.equal((await request(`http://127.0.0.1:${snapshotPort}${PUBLIC_POOL_PATH}`)).status, 200);
    const endpoint = `https://127.0.0.1:${anchorPort}${publicPoolAnchorPath(token)}`;
    assert.equal((await request(endpoint, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0x'] }))).status, 400);
    assert.equal((await request(endpoint, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }))).status, 200);
    assert.equal((await request(endpoint, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }))).status, 400);
    assert.throws(() => fixture.assertComplete(null), /AUDIT_FAILED/);
  } finally { await fixture.close(); }
});

test('changed leaf, expired root and wrong final RPC ID all prevent a verified report', async () => {
  for (const mode of ['leaf', 'root-ring', 'rpc-id']) {
    const fixture = await createPublicPoolFixture(tls);
    let knownRoots = 0;
    try {
      const transport = snapshotBridge({
        mutateGet(result) {
          if (mode !== 'leaf') return result;
          const body = JSON.parse(result.bytes);
          body.leaves[0] = body.leaves[1];
          return { ...result, bytes: Buffer.from(JSON.stringify(body)) };
        },
        mutateAnchor(kind, result) {
          if (kind !== 'isKnownRoot' || ++knownRoots !== 2 || mode === 'leaf') return result;
          const body = JSON.parse(result.bytes);
          if (mode === 'root-ring') body.result = '0x' + '0'.repeat(64);
          else body.id += 1;
          return { ...result, bytes: Buffer.from(JSON.stringify(body)) };
        },
      });
      await assert.rejects(qualifyNativePublicPool({ launch: fixture.launch, transport,
        executeMerkleBatch: evaluateMerkleBatch, lifetime: new AbortController().signal }), /QUALIFICATION_FAILED/);
      assert.equal(knownRoots, mode === 'leaf' ? 1 : 2);
    } finally { await fixture.close(); }
  }
});

test('public pool CA is admitted only for its dedicated qualification identity and exact digest', () => {
  const configure = require('./withHttpFixture.cjs');
  const saved = process.env.PALI_PUBLIC_POOL_FIXTURE_CA;
  const { sha256 } = readPublicPoolCa(certPath);
  const build = { version: 1, sourceRevision: 'a'.repeat(40), lockfileSha256: 'b'.repeat(64) };
  const config = (identifier, caSha256, http = false) => ({
    ios: { bundleIdentifier: identifier }, android: { package: identifier },
    extra: { paliPublicPoolQualification: { build, caSha256 }, ...(http ? { paliHttpQualification: build } : {}) },
  });
  const fixture = 'com.paliwallet.qualification';
  try {
    process.env.PALI_PUBLIC_POOL_FIXTURE_CA = certPath;
    assert.throws(() => configure(config('com.paliwallet.mobile', sha256)), /isolated qualification identity/);
    assert.throws(() => configure(config(fixture, sha256, true)), /isolated qualification identity/);
    assert.throws(() => configure(config(fixture, '0'.repeat(64))), /CA_CHANGED/);
    assert.deepEqual(configure(config(fixture, sha256)).ios.infoPlist.NSAppTransportSecurity, {
      NSExceptionDomains: { '127.0.0.1': { NSExceptionAllowsInsecureHTTPLoads: true } },
    });
  } finally {
    if (saved === undefined) delete process.env.PALI_PUBLIC_POOL_FIXTURE_CA;
    else process.env.PALI_PUBLIC_POOL_FIXTURE_CA = saved;
  }
});
