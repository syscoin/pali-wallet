import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getAddress } from 'ethers/address';
import {
  NativeTokenRegistry,
  NATIVE_TOKEN_REGISTRY_KEY,
  type NativeTokenScope,
} from '../src/portfolio/tokenRegistry.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import type { KeyringStoragePort } from '../src/storage/types.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';
const current = () => undefined;
const token = (i = 1, long = false) => ({
  contractAddress: getAddress('0x' + i.toString(16).padStart(40, '0')),
  name: long ? 'a'.repeat(128) : 'Token',
  symbol: long ? 'b'.repeat(64) : 'TKN',
  decimals: 255,
});
async function fixture(hooks: { before?: SqlHook; after?: SqlHook } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-token-registry-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage = await SqliteWalletStorage.open(
    nodeConnection(file, hooks).connection,
    digest,
    INSTALLATION,
    true
  );
  await storage.keyringStorage.createManyIfAbsent(validPair());
  const walletFingerprint = await storage.getWalletFingerprint();
  const network = getNativeNetwork('ethereum');
  const scope: NativeTokenScope = {
    walletFingerprint,
    accountId: 'hd:60:0',
    address: getAddress('0x' + 'a'.repeat(40)),
    network: network.id,
    chainId: network.chainId,
    registrationHash: network.registrationHash,
  };
  return {
    scope,
    get port() {
      return storage.keyringStorage;
    },
    async reopen() {
      await storage.close().catch(() => undefined);
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        false
      );
    },
    async cleanup() {
      await storage.close().catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    },
  };
}
test('one document preserves descriptors across restart, account restore and network switch', async () => {
  const f = await fixture();
  try {
    let registry = new NativeTokenRegistry(f.port);
    assert.deepEqual(await registry.load(f.scope, current), {
      revision: 0,
      items: [],
    });
    await registry.add(f.scope, 0, token(), current);
    const base = getNativeNetwork('base');
    const other = {
      ...f.scope,
      network: base.id,
      chainId: base.chainId,
      registrationHash: base.registrationHash,
    };
    assert.deepEqual((await registry.load(other, current)).items, []);
    await registry.add(other, 1, token(2), current);
    assert.deepEqual(
      (await registry.load({ ...f.scope, accountId: 'hd:60:1' }, current))
        .items,
      []
    );
    await f.reopen();
    registry = new NativeTokenRegistry(f.port);
    assert.deepEqual((await registry.load(f.scope, current)).items, [token()]);
    assert.deepEqual((await registry.load(other, current)).items, [token(2)]);
    await registry.remove(f.scope, 2, token().contractAddress, current);
    assert.deepEqual((await registry.load(other, current)).items, [token(2)]);
  } finally {
    await f.cleanup();
  }
});
test('concurrent writers cannot overwrite; duplicates and stale revisions do not mutate storage', async () => {
  const f = await fixture();
  try {
    const a = new NativeTokenRegistry(f.port);
    const b = new NativeTokenRegistry(f.port);
    await a.load(f.scope, current);
    const results = await Promise.allSettled([
      a.add(f.scope, 0, token(), current),
      b.add(f.scope, 0, token(2), current),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const inventory = await a.load(f.scope, current);
    assert.equal(inventory.items.length, 1);
    const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY);
    await assert.rejects(
      a.add(f.scope, 1, inventory.items[0]!, current),
      /DUPLICATE/
    );
    await assert.rejects(a.add(f.scope, 0, token(3), current), /CHANGED/);
    assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
    assert.equal(a.requiresReopen, false);
    assert.equal(b.requiresReopen, false);
  } finally {
    await f.cleanup();
  }
});
for (const point of ['before-commit', 'lost-ack'] as const)
  test(`token ${point} preserves data and requires reopen`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => {
      if (enabled && kind === 'exec' && sql === 'COMMIT') {
        enabled = false;
        throw Error('interruption');
      }
    };
    const f = await fixture(
      point === 'before-commit' ? { before: fail } : { after: fail }
    );
    try {
      const registry = new NativeTokenRegistry(f.port);
      await registry.load(f.scope, current);
      enabled = true;
      await assert.rejects(registry.add(f.scope, 0, token(), current));
      assert.equal(registry.requiresReopen, true);
      await assert.rejects(registry.load(f.scope, current), /REOPEN_REQUIRED/);
      await f.reopen();
      assert.equal(
        (await new NativeTokenRegistry(f.port).load(f.scope, current)).items
          .length,
        point === 'lost-ack' ? 1 : 0
      );
    } finally {
      await f.cleanup();
    }
  });
test('unknown/corrupt and foreign-wallet records are preserved', async () => {
  const f = await fixture();
  try {
    await f.port.set(NATIVE_TOKEN_REGISTRY_KEY, { version: 2, entries: [] });
    const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY);
    await assert.rejects(
      new NativeTokenRegistry(f.port).load(f.scope, current)
    );
    assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
    await f.port.set(NATIVE_TOKEN_REGISTRY_KEY, {
      version: 1,
      revision: 0,
      entries: [],
      walletFingerprint: 'f'.repeat(64),
    });
    await assert.rejects(
      new NativeTokenRegistry(f.port).load(f.scope, current)
    );
  } finally {
    await f.cleanup();
  }
});
test('the 64 KiB byte budget rejects the complete value without truncation', async () => {
  const f = await fixture();
  try {
    const registry = new NativeTokenRegistry(f.port);
    let value = await registry.load(f.scope, current);
    let failed = false;
    for (let i = 1; i <= 256; i++) {
      const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY);
      try {
        value = await registry.add(
          f.scope,
          value.revision,
          token(i, true),
          current
        );
      } catch (error) {
        assert.match(String(error), /CAPACITY/);
        assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
        failed = true;
        break;
      }
    }
    assert.equal(failed, true);
    assert(value.items.length > 10);
    assert.equal(registry.requiresReopen, false);
  } finally {
    await f.cleanup();
  }
});
test('context loss after acknowledged write quarantines until reload', async () => {
  const f = await fixture();
  try {
    const registry = new NativeTokenRegistry(f.port);
    await registry.add(f.scope, 0, token(2), current);
    let valid = true;
    const guard = () => {
      if (!valid) throw Error('CANCELLED');
    };
    const wrapped: KeyringStoragePort = {
      ...f.port,
      async compareAndSet(...args) {
        const result = await f.port.compareAndSet(...args);
        valid = false;
        return result;
      },
    };
    const other = new NativeTokenRegistry(wrapped);
    await assert.rejects(other.add(f.scope, 1, token(), guard), /CANCELLED/);
    assert.equal(other.requiresReopen, true);
    assert.equal(
      (await new NativeTokenRegistry(f.port).load(f.scope, current)).items
        .length,
      2
    );
  } finally {
    await f.cleanup();
  }
});
