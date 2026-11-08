const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  withWalletConnectQualificationScope,
} = require('./walletconnect-scope.ts');

function globals() {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const socket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  return () => {
    if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
    if (socket) Object.defineProperty(globalThis, 'WebSocket', socket);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  };
}

test('scoped preparation restores native crypto, restricts socket construction, then restores entropy observation', async () => {
  const restore = globals();
  let nativeEntropy = 0,
    observedEntropy = 0,
    forbidden = 0;
  const addresses = [],
    frames = [];
  const native = {
    getRandomValues(value) {
      nativeEntropy++;
      return value;
    },
  };
  const observed = {
    getRandomValues(value) {
      observedEntropy++;
      return native.getRandomValues(value);
    },
  };
  const blocked = function () {
    throw Error('Global network guard');
  };
  class NativeSocket {
    constructor(address) {
      addresses.push(address);
    }
    send(data) {
      frames.push(data);
    }
  }
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: observed,
    writable: false,
  });
  globalThis.WebSocket = blocked;
  let captured, connected;
  try {
    await withWalletConnectQualificationScope(
      {
        crypto: native,
        WebSocket: NativeSocket,
        launch: { port: 12345, token: 'ab'.repeat(16) },
        onForbidden() {
          forbidden++;
          throw Error('Forbidden target');
        },
      },
      async () => {
        assert.equal(globalThis.crypto, native);
        globalThis.crypto.getRandomValues(new Uint8Array(16));
        captured = globalThis.WebSocket;
        connected = new captured(
          `ws://127.0.0.1:12345/${'ab'.repeat(16)}/wc-open?auth=public-test`
        );
        connected.send('public frame');
        for (const url of [
          'wss://example.com/',
          `ws://127.0.0.1:12346/${'ab'.repeat(16)}/wc-open`,
          `ws://127.0.0.1:12345/wrong-token/wc-open`,
        ])
          assert.throws(() => new captured(url), /Forbidden target/);
      }
    );
    assert.equal(globalThis.crypto, observed);
    assert.equal(globalThis.WebSocket, blocked);
    globalThis.crypto.getRandomValues(new Uint8Array(16));
    assert.equal(nativeEntropy, 2);
    assert.equal(observedEntropy, 1);
    assert.throws(
      () => new captured(`ws://127.0.0.1:12345/${'ab'.repeat(16)}/wc-open`),
      /Forbidden target/
    );
    assert.throws(() => connected.send('late frame'), /Forbidden target/);
    assert.deepEqual(frames, ['public frame']);
    assert.equal(addresses.length, 1);
    assert.equal(forbidden, 5);
  } finally {
    restore();
  }
});

test('a failed scoped import restores both guards', async () => {
  const restore = globals();
  const observed = {},
    blocked = function () {};
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: observed,
  });
  globalThis.WebSocket = blocked;
  try {
    await assert.rejects(
      withWalletConnectQualificationScope(
        {
          crypto: {},
          WebSocket: class {},
          launch: { port: 12345, token: 'ab'.repeat(16) },
          onForbidden() {
            throw Error('Forbidden');
          },
        },
        async () => {
          throw Error('Import failed');
        }
      ),
      /Import failed/
    );
    assert.equal(globalThis.crypto, observed);
    assert.equal(globalThis.WebSocket, blocked);
  } finally {
    restore();
  }
});

test('native entry captures its socket before guarding and scopes preparation before SDK loading', () => {
  const source = fs.readFileSync(require.resolve('./index.tsx'), 'utf8');
  assert(
    source.indexOf('const NativeWebSocket = globalThis.WebSocket') <
      source.indexOf('globalThis.WebSocket =')
  );
  const scoped = source.indexOf('await withWalletConnectQualificationScope(');
  assert(
    scoped >= 0 &&
      scoped < source.indexOf('await prepareWalletConnectRuntime()')
  );
  assert(
    source.indexOf('await prepareWalletConnectRuntime()') <
      source.indexOf("import('./walletconnect-native.ts')")
  );
});
