import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openWalletConnectTransport,
  type WalletConnectSdk,
} from '../src/connections/walletConnect.ts';
import type { NativeConnectionRepository } from '../src/connections/storage.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(holdKeychain = false) {
  const [
    { Core },
    { SignClient, SESSION_REQUEST_EXPIRY_BOUNDARIES },
    { parseUri },
  ] = await Promise.all([
    import('@walletconnect/core'),
    import('@walletconnect/sign-client'),
    import('@walletconnect/utils'),
  ]);
  const values = new Map<string, unknown>();
  const readStarted = deferred(),
    held = deferred();
  let core: InstanceType<typeof Core> | undefined;
  let client: InstanceType<typeof SignClient> | undefined;
  let reads = 0,
    writes = 0;
  const repository = {
    assertHealthy() {},
    permissions() {
      throw Error('Unused permission path');
    },
    bindings: () => [],
    async reconcileSessions() {
      throw Error('Unused session reconciliation');
    },
    async retireAccount() {
      throw Error('Unused account removal');
    },
    async dispose() {},
    transport: {
      async getKeys() {
        return [...values.keys()];
      },
      async getEntries<T>() {
        return [...values.entries()] as [string, T][];
      },
      async getItem<T>(key: string) {
        reads++;
        if (holdKeychain && key.endsWith('//keychain')) {
          readStarted.resolve();
          await held.promise;
        }
        return values.get(key) as T | undefined;
      },
      async setItem<T>(key: string, value: T) {
        values.set(key, value);
        writes++;
      },
      async removeItem(key: string) {
        values.delete(key);
        writes++;
      },
    },
  } satisfies Omit<NativeConnectionRepository, 'calls'>;
  const sdk: WalletConnectSdk = {
    requestExpirySeconds: SESSION_REQUEST_EXPIRY_BOUNDARIES,
    parseUri,
    createCore(options) {
      core = new Core(options);
      return core;
    },
    async initialize(options) {
      client = await SignClient.init({
        ...options,
        core: core!,
        metadata: { ...options.metadata, icons: [...options.metadata.icons] },
      });
      return client;
    },
  };
  const owner = new AbortController();
  const options = {
    projectId: '00000000000000000000000000000000',
    metadata: {
      name: 'Pali offline lifecycle test',
      description: '',
      url: 'https://paliwallet.com',
      icons: [],
    },
    repository,
    supportedMethods: ['personal_sign'],
    supportedEvents: ['accountsChanged'],
    signal: owner.signal,
    assertOwner() {
      if (owner.signal.aborted) throw Error('Retired');
    },
    async preparePlatform() {},
    onEvent() {},
    loadSdk: async () => sdk,
  };
  return {
    options,
    owner,
    held,
    readStarted,
    get core() {
      return core!;
    },
    get client() {
      return client;
    },
    get reads() {
      return reads;
    },
    get writes() {
      return writes;
    },
  };
}

test('actual reviewed Core and SignClient close through the production transport adapter', async () => {
  const f = await fixture();
  const transport = await openWalletConnectTransport(f.options);
  assert.deepEqual(await transport.sessions(), []);
  await transport.close();
  assert.equal(f.core.signal.aborted, true);
  assert.equal(f.client!.signal.aborted, true);
  assert.deepEqual(f.core.heartbeat.events.eventNames(), []);
  assert.deepEqual(f.core.relayer.events.eventNames(), []);
  const writes = f.writes;
  await assert.rejects(transport.sessions());
  await assert.rejects(f.core.start(), /disposed/);
  assert.equal(f.writes, writes);
});

test('actual SDK initialization retirement drains the admitted keychain read', async () => {
  const f = await fixture(true);
  let finished = false;
  const opening = openWalletConnectTransport(f.options);
  const refused = assert
    .rejects(opening, { message: 'CONNECTION_UNAVAILABLE' })
    .then(() => {
      finished = true;
    });
  await f.readStarted.promise;
  f.owner.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.core.signal.aborted, true);
  assert.equal(finished, false);
  f.held.resolve();
  await refused;
  assert.equal(f.client, undefined);
  assert.deepEqual(f.core.heartbeat.events.eventNames(), []);
  assert.deepEqual(f.core.relayer.events.eventNames(), []);
});
