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
