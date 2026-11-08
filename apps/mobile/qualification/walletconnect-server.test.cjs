const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
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

test('reviewed public SDK and production adapter satisfy the loopback protocol probe', async () => {
  const { qualifyNativeWalletConnect } = require('./walletconnect-native.ts');
  const server = await createHttpFixture();
  const token = 'cd'.repeat(16);
  server.begin(token);
  try {
    const report = await qualifyNativeWalletConnect({
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
      walletFetch: globalThis.fetch,
    });
    assert.equal(report.candidateIdentity, 'node-host-protocol-test');
    assertWalletConnectAudit(server.inspectWalletConnect(token));
  } finally {
    await server.close();
  }
});
