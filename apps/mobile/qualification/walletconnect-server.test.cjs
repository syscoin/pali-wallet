/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const WebSocket = require('ws');
const { createHttpFixture } = require('./http-server.cjs');
const {
  assertWalletConnectAudit,
  assertWalletConnectReport,
} = require('./walletconnect-contract.ts');

test('loopback relay records open and cancelled-handshake socket retirement', async () => {
  const server = await createHttpFixture();
  const token = 'ab'.repeat(16);
  server.begin(token);
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/${token}/wc-open`);
    await once(ws, 'open');
    const response = once(ws, 'message');
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'irn_subscribe',
        params: { topic: 'a1'.repeat(32) },
      })
    );
    assert.equal(JSON.parse((await response)[0].toString()).id, 1);
    const closed = once(ws, 'close');
    ws.close();
    await closed;
    const pending = new WebSocket(
      `ws://127.0.0.1:${server.port}/${token}/wc-pending`
    );
    pending.on('error', () => undefined);
    const pendingClosed = new Promise((resolve) =>
      pending.once('close', resolve)
    );
    const started = Date.now();
    while (
      server.inspectWalletConnect(token).pending !== 1 &&
      Date.now() - started < 2000
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(server.inspectWalletConnect(token).pending, 1);
    pending.close();
    await pendingClosed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertWalletConnectAudit(server.inspectWalletConnect(token));
    assert.throws(() =>
      assertWalletConnectAudit({
        ...server.inspectWalletConnect(token),
        pendingClosed: 0,
      })
    );
  } finally {
    await server.close();
  }
});

test('native connection evidence is bound to the exact candidate identity', () => {
  const expected = {
    sourceRevision: 'a'.repeat(40),
    lockfileSha256: 'b'.repeat(64),
    token: 'c'.repeat(32),
    phase: 'create',
    scenario: 'import',
    platform: 'android',
    sessionId: 'session',
    candidateIdentity: 'candidate',
  };
  const report = {
    version: 1,
    kind: 'native-walletconnect',
    status: 'passed',
    ...expected,
  };
  assertWalletConnectReport(report, expected);
  assert.throws(() =>
    assertWalletConnectReport(
      { ...report, candidateIdentity: 'official-2.26.0' },
      expected
    )
  );
});

test('guarded native-entry sequencing reaches the reviewed SDK through a restricted socket', async () => {
  const {
    withWalletConnectQualificationScope,
  } = require('./walletconnect-scope.ts');
  const server = await createHttpFixture();
  const token = 'cd'.repeat(16);
  server.begin(token);
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'crypto'
  );
  const socketDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'WebSocket'
  );
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const nativeCrypto = globalThis.crypto,
    NativeWebSocket = globalThis.WebSocket,
    nativeFetch = globalThis.fetch;
  let forbidden = 0;
  const blocked = function () {
    forbidden++;
    throw Error('QUALIFICATION_NETWORK_FORBIDDEN');
  };
  const serviceKeys = ['Application', 'NetInfo', 'Linking', 'Platform'];
  const services = serviceKeys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  );
  const productionSource = fs.readFileSync(
    path.join(__dirname, '../src/platform/walletConnectRuntime.native.ts'),
    'utf8'
  );
  const compiled = ts.transpileModule(productionSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  let preparations = 0;
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    globalThis,
    require(name) {
      if (name === 'expo-application') return {};
      if (name === '@react-native-community/netinfo')
        return {
          fetch: async () => ({ isConnected: true }),
          addEventListener: () => () => undefined,
        };
      if (name === 'react-native')
        return { Linking: {}, Platform: { OS: 'android' } };
      if (name === 'base-64') return require('base-64');
      if (name === './cryptoBootstrap')
        return {
          async ensureNativeCryptoReady() {
            preparations++;
            return nativeCrypto;
          },
        };
      throw Error(`Unexpected preparation import ${name}`);
    },
  });
  const { prepareWalletConnectRuntime } = module.exports;
  const observedCrypto = Object.freeze({
    subtle: nativeCrypto.subtle,
    getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    randomUUID: nativeCrypto.randomUUID.bind(nativeCrypto),
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: observedCrypto,
  });
  globalThis.WebSocket = blocked;
  globalThis.fetch = blocked;
  try {
    await assert.rejects(
      prepareWalletConnectRuntime(),
      /NATIVE_CONNECTION_UNAVAILABLE/
    );
    const report = await withWalletConnectQualificationScope(
      {
        crypto: nativeCrypto,
        WebSocket: NativeWebSocket,
        launch: { port: server.port, token },
        onForbidden: blocked,
      },
      async () => {
        await prepareWalletConnectRuntime();
        assert.equal(globalThis.crypto, nativeCrypto);
        const {
          qualifyNativeWalletConnect,
        } = require('./walletconnect-native.ts');
        return qualifyNativeWalletConnect({
          launch: { port: server.port, token },
          build: {
            version: 1,
            sourceRevision: 'a'.repeat(40),
            lockfileSha256: 'b'.repeat(64),
          },
          candidateIdentity: 'node-host-protocol-test',
          platform: 'android',
          phase: 'create',
          scenario: 'import',
          sessionId: '11111111-1111-1111-1111-111111111111',
          walletFetch: nativeFetch,
        });
      }
    );
    assert.equal(report.candidateIdentity, 'node-host-protocol-test');
    assertWalletConnectAudit(server.inspectWalletConnect(token));
    assert.equal(globalThis.crypto, observedCrypto);
    assert.equal(globalThis.WebSocket, blocked);
    assert.equal(globalThis.fetch, blocked);
    assert.equal(forbidden, 0);
    assert.equal(preparations, 2);
  } finally {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    Object.defineProperty(globalThis, 'WebSocket', socketDescriptor);
    Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    serviceKeys.forEach((key, index) => {
      if (services[index])
        Object.defineProperty(globalThis, key, services[index]);
      else Reflect.deleteProperty(globalThis, key);
    });
    await server.close();
  }
});

test('WalletConnect diagnostics use closed fields and redact arbitrary error text', () => {
  const { WalletConnectQualificationError, isWalletConnectQualificationDiagnostic } = require('./walletconnect-native.ts');
  const secret = 'wc:PRIVATE_PAIRING_KEY@2?secret=PRIVATE_URI';
  const error = Object.assign(new TypeError(secret), { code: secret });
  const diagnostic = new WalletConnectQualificationError('init', error).diagnostic;
  assert.deepEqual(diagnostic, { substage: 'init', errorName: 'TypeError', errorCode: 'UNCLASSIFIED' });
  assert(!JSON.stringify(diagnostic).includes('PRIVATE'));
  assert(isWalletConnectQualificationDiagnostic(diagnostic));
  assert.deepEqual(new WalletConnectQualificationError('close', Object.assign(Error(secret), { code: 'CONNECTION_UNAVAILABLE' })).diagnostic,
    { substage: 'close', errorName: 'Error', errorCode: 'CONNECTION_UNAVAILABLE' });
  const hostile = new Proxy({}, { getPrototypeOf() { throw Error(secret); }, getOwnPropertyDescriptor() { throw Error(secret); } });
  assert.deepEqual(new WalletConnectQualificationError('init', hostile).diagnostic,
    { substage: 'init', errorName: 'UnknownError', errorCode: 'UNCLASSIFIED' });
  for (const invalid of [
    { ...diagnostic, substage: secret }, { ...diagnostic, errorName: secret },
    { ...diagnostic, errorCode: secret }, { ...diagnostic, message: secret },
    { ...diagnostic, counts: { opened: 1 } },
    { ...diagnostic, counts: { opened: 0, closed: 0, pending: 0, pendingClosed: 0, frames: -1, invalid: 0 } },
  ]) assert.equal(isWalletConnectQualificationDiagnostic(invalid), false);
});

function failingQualification(stage, targetError = Object.assign(Error('PRIVATE_PAIRING_URI'), { code: 'CONNECTION_UNAVAILABLE' })) {
  const failures = new Set(Array.isArray(stage) ? stage : [stage]);
  const source = fs.readFileSync(path.join(__dirname, 'walletconnect-native.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const counts = { opened: 0, closed: 0, pending: 0, pendingClosed: 0, frames: 0, invalid: 0 };
  let statusReads = 0;
  const load = (name) => {
    if (name === '@walletconnect/core') return { Core: class {
      constructor(options) { this.options = options; this.signal = { aborted: false }; this.heartbeat = this.relayer = { events: { eventNames: () => failures.has('disposal-listeners') ? ['retained'] : [] } }; }
    } };
    if (name === '@walletconnect/sign-client') return { SESSION_REQUEST_EXPIRY_BOUNDARIES: { min: 1, max: 2 }, SignClient: { init: async ({ core }) => ({ core, signal: { aborted: false } }) } };
    if (name === '@walletconnect/utils') return { parseUri() {} };
    if (name === './walletconnect-contract.ts') return require(name);
    if (name === '../src/connections/walletConnect.ts') return { async openWalletConnectTransport(options) {
      if (failures.has('init')) throw targetError;
      const sdk = await options.loadSdk();
      const core = sdk.createCore({});
      const client = await sdk.initialize({ metadata: { icons: [] } });
      const pending = core.options.relayUrl.includes('wc-pending');
      let closed = false;
      return {
        pair() {
          if (failures.has('pair')) return Promise.reject(targetError);
          if (!pending) { counts.opened++; counts.frames++; return Promise.resolve({}); }
          counts.pending++;
          return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => failures.has('abort-accepted') ? resolve({}) : reject(targetError), { once: true }));
        },
        async close() {
          if (failures.has('close')) throw targetError;
          core.signal.aborted = true;
          client.signal.aborted = !failures.has('disposal-signal');
          if (!closed) { closed = true; if (pending) counts.pendingClosed++; else counts.closed++; }
        },
      };
    } };
    throw Error('Unexpected fixture import');
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: load, AbortController, setTimeout, clearTimeout });
  return { run: () => module.exports.qualifyNativeWalletConnect({
    launch: { port: 12345, token: 'ab'.repeat(16) }, build: {}, candidateIdentity: 'candidate', platform: 'android', phase: 'create', scenario: 'import', sessionId: 'session',
    async walletFetch() {
      if (failures.has('request') && ++statusReads === 2) throw targetError;
      return { ok: !failures.has('status-http'), json: async () => ({ ...counts }) };
    },
  }), counts, statusReads: () => statusReads };
}

for (const [failure, stage, code] of [
  ['status-http', 'request', 'WALLETCONNECT_NATIVE_STATUS_HTTP'],
  ['disposal-signal', 'close', 'WALLETCONNECT_NATIVE_DISPOSAL_SIGNAL'],
  ['disposal-listeners', 'close', 'WALLETCONNECT_NATIVE_DISPOSAL_LISTENERS'],
  ['abort-accepted', 'pair', 'WALLETCONNECT_NATIVE_ABORT_ACCEPTED'],
]) {
  test(`qualification assertion ${failure} retains its fixed diagnostic code`, async () => {
    const fixture = failingQualification(failure);
    await assert.rejects(fixture.run(), (error) => {
      assert.equal(error.diagnostic.substage, stage);
      assert.equal(error.diagnostic.errorCode, code);
      assert(!JSON.stringify(error.diagnostic).includes('PRIVATE'));
      return true;
    });
  });
}

test('pair failure remains primary when final transport cleanup also fails', async () => {
  const fixture = failingQualification(['pair', 'close']);
  await assert.rejects(fixture.run(), (error) => {
    assert.equal(error.diagnostic.substage, 'pair');
    assert.equal(error.diagnostic.errorCode, 'CONNECTION_UNAVAILABLE');
    return true;
  });
});

test('non-cancelled pairing retains the allowlisted transport rejection diagnostic', async () => {
  const { WalletConnectTransportError } = require('../src/connections/walletConnect.ts');
  const fixture = failingQualification('pair', new WalletConnectTransportError());
  await assert.rejects(fixture.run(), (error) => {
    assert.deepEqual(JSON.parse(JSON.stringify(error.diagnostic)), {
      substage: 'pair', errorName: 'WalletConnectTransportError', errorCode: 'CONNECTION_UNAVAILABLE',
    });
    assert.equal(fixture.statusReads(), 0);
    return true;
  });
});

for (const stage of ['init', 'pair', 'request', 'close']) {
  test(`real qualification flow records fixed ${stage} failure without private error text`, async () => {
    const fixture = failingQualification(stage);
    await assert.rejects(fixture.run(), (error) => {
      assert.equal(error.diagnostic.substage, stage);
      assert(!JSON.stringify(error.diagnostic).includes('PRIVATE'));
      if (stage === 'request') assert.deepEqual(JSON.parse(JSON.stringify(error.diagnostic.counts)), { ...fixture.counts, pendingClosed: 0 });
      else assert.equal(error.diagnostic.counts, undefined);
      assert.equal(fixture.statusReads(), stage === 'request' ? 2 : 0);
      return true;
    });
  });
}

test('actual entrypoint captures a runtime preparation throw as a redacted init failure', async () => {
  const { WalletConnectQualificationError } = require('./walletconnect-native.ts');
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const parsed = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let target;
  function find(node) {
    if (ts.isTryStatement(node) && node.catchClause?.block.getText(parsed).includes('walletConnectDiagnostic =')) target = node;
    ts.forEachChild(node, find);
  }
  find(parsed);
  assert(target);
  const body = `exports.run = async () => { let connectionEvidence; let walletConnectDiagnostic; try { ${target.getText(parsed)} } catch {} return walletConnectDiagnostic; };`;
  const compiled = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, WalletConnectQualificationError,
    nativeCrypto: {}, NativeWebSocket: class {}, launch: {}, build: {}, candidateIdentity: 'candidate',
    walletFetch() {}, phase: 'create', scenario: 'import', Platform: { OS: 'android' }, Constants: { sessionId: 'session' },
    withWalletConnectQualificationScope: async (_options, operation) => operation(),
    qualifyNativeWalletConnect() { assert.fail('runtime preparation must finish first'); },
    require(name) {
      if (name === './walletconnect-native.ts') return { WalletConnectQualificationError };
      assert.equal(name, '../src/platform/walletConnectRuntime.native');
      return { async prepareWalletConnectRuntime() { throw Object.assign(Error('PRIVATE_PAIRING_KEY'), { code: 'NATIVE_CONNECTION_UNAVAILABLE' }); } };
    },
  });
  const result = await module.exports.run();
  assert.equal(result.substage, 'init');
  assert.equal(result.errorCode, 'NATIVE_CONNECTION_UNAVAILABLE');
  assert(!JSON.stringify(result).includes('PRIVATE'));
});
