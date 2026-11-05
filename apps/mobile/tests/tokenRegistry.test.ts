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
  type SavedCollectible,
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
const collection = (i = 2): SavedCollectible => ({
  contractAddress: token(i).contractAddress,
  tokenStandard: 'ERC-721',
});
const collectible = (i = 3, tokenId = '0'): SavedCollectible => ({
  contractAddress: token(i).contractAddress,
  tokenStandard: 'ERC-1155',
  tokenId,
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

test('one mixed document preserves chain aliases and removes only the exact saved collectible', async () => {
  const f = await fixture();
  try {
    const registry = new NativeTokenRegistry(f.port);
    const alias = { ...f.scope, network: 'same-chain', registrationHash: `0x${'f'.repeat(64)}` };
    const base = getNativeNetwork('base');
    const other = { ...f.scope, network: base.id, chainId: base.chainId, registrationHash: base.registrationHash };
    const max = ((1n << 256n) - 1n).toString();
    await registry.add(f.scope, 0, token(), current);
    const erc20Only = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY) as { entries: unknown[] };
    await registry.addCollectible(f.scope, 1, collection(), current);
    await registry.addCollectible(f.scope, 2, collectible(3, '00'), current);
    await registry.addCollectible(f.scope, 3, collectible(3, `0x${'f'.repeat(64)}`), current);
    await registry.addCollectible(other, 4, collection(3), current);
    const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY) as { version: number; entries: Record<string, unknown>[] };
    assert.equal(before.version, 1);
    assert.equal(JSON.stringify(before.entries[0]), JSON.stringify(erc20Only.entries[0]));
    assert.deepEqual(before.entries.slice(1).map((row) => row.collectible), [collection(), collectible(), collectible(3, max), collection(3)]);
    for (const action of [
      () => registry.addCollectible(alias, 5, collection(1), current),
      () => registry.addCollectible(alias, 5, collectible(1), current),
      () => registry.addCollectible(alias, 5, collectible(2), current),
      () => registry.add(alias, 5, token(2), current),
      () => registry.add(alias, 5, token(3), current),
      () => registry.addCollectible(alias, 5, collection(3), current),
      () => registry.addCollectible(alias, 5, collectible(3, '0x0'), current),
    ]) await assert.rejects(action(), /DUPLICATE/);
    await assert.rejects(registry.remove(alias, 5, token(3).contractAddress, current), /CHANGED/);
    await assert.rejects(registry.removeCollectible(alias, 5, collection(3), current), /CHANGED/);
    await assert.rejects(registry.removeCollectible(alias, 4, collectible(), current), /CHANGED/);
    assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
    assert.deepEqual(await registry.load(alias, current), {
      revision: 5, items: [token()], collectibles: [collection(), collectible(), collectible(3, max)],
    });
    assert.deepEqual(await registry.load({ ...alias, accountId: 'imported:60:0' }, current), { revision: 5, items: [] });
    assert.deepEqual(await registry.load({ ...alias, address: token(8).contractAddress }, current), { revision: 5, items: [] });
    await registry.removeCollectible(alias, 5, collectible(3, '0x0'), current);
    await registry.removeCollectible(alias, 6, collection(), current);
    await f.reopen();
    const reopened = new NativeTokenRegistry(f.port);
    assert.deepEqual(await reopened.load(alias, current), { revision: 7, items: [token()], collectibles: [collectible(3, max)] });
    assert.deepEqual((await reopened.load(other, current)).collectibles, [collection(3)]);
    const after = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY) as typeof before;
    assert.equal(JSON.stringify(after.entries[0]), JSON.stringify(before.entries[0]));
    assert.deepEqual(after.entries.slice(1), before.entries.slice(3));
    assert.equal(after.entries[1]?.registrationHash, f.scope.registrationHash);
    assert.equal(after.entries[1]?.network, f.scope.network);
  } finally { await f.cleanup(); }
});

test('malformed, noncanonical and cross-standard collectible payloads fail closed in storage', async () => {
  const f = await fixture();
  try {
    const registry = new NativeTokenRegistry(f.port);
    await registry.add(f.scope, 0, token(), current);
    const original = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY) as { entries: Record<string, unknown>[] };
    const fungible = original.entries[0]!;
    const { metadata: _metadata, ...owner } = fungible;
    for (const payload of [
      { ...collection(), tokenId: '0' },
      { ...collection(), image: 'https://art.invalid' },
      { ...collectible(), balance: '999' },
      { ...collectible(), tokenId: 0 },
      { ...collectible(), tokenId: (1n << 256n).toString() },
      { ...collectible(), contractAddress: token(0).contractAddress },
    ]) {
      await assert.rejects(registry.addCollectible(f.scope, 1, payload as SavedCollectible, current), /INVALID/);
      assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), original);
    }
    const collision = { ...owner, collectible: collectible(1) };
    for (const entries of [
      [fungible, { ...owner, collectible: collectible(3, '00') }],
      [fungible, { ...owner, collectible: { ...collection(), tokenId: '0' } }],
      [{ ...fungible, collectible: collection() }],
      [fungible, collision],
      [collision, fungible],
    ]) {
      const malformed = { ...original, entries };
      await f.port.set(NATIVE_TOKEN_REGISTRY_KEY, malformed);
      await assert.rejects(registry.load(f.scope, current), /INVALID/);
      assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), malformed);
    }
    assert.equal(registry.requiresReopen, false);
  } finally { await f.cleanup(); }
});

test('stale collectible admission aborts before SQL write and snapshots a mutable descriptor', async () => {
  let hold = false;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const f = await fixture({ before: async (kind, sql) => {
    if (!hold || kind !== 'get' || !sql.includes('keyring_records')) return;
    hold = false;
    entered.resolve();
    await release.promise;
  } });
  try {
    const registry = new NativeTokenRegistry(f.port);
    await registry.add(f.scope, 0, token(), current);
    const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY);
    let live = true;
    hold = true;
    const pending = registry.addCollectible(f.scope, 1, collection(), () => { if (!live) throw new Error('CANCELLED'); });
    const rejected = assert.rejects(pending, /CANCELLED/);
    await entered.promise;
    live = false;
    release.resolve();
    await rejected;
    assert.equal(registry.requiresReopen, false);
    assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
    const draft = { contractAddress: token(3).contractAddress, tokenStandard: 'ERC-1155' as const, tokenId: '0' };
    const adding = registry.addCollectible(f.scope, 1, draft, current);
    draft.tokenId = '999';
    assert.deepEqual((await adding).collectibles, [collectible()]);
  } finally { release.resolve(); await f.cleanup(); }
});

for (const point of ['before-commit', 'lost-ack'] as const)
  test(`collectible CAS ${point} preserves the mixed document and requires reopen`, async () => {
    let enabled = false;
    const fail: SqlHook = (kind, sql) => {
      if (enabled && kind === 'exec' && sql === 'COMMIT') {
        enabled = false;
        throw new Error('interruption');
      }
    };
    const f = await fixture(point === 'before-commit' ? { before: fail } : { after: fail });
    try {
      const registry = new NativeTokenRegistry(f.port);
      await registry.add(f.scope, 0, token(), current);
      await registry.addCollectible(f.scope, 1, collectible(), current);
      const before = await f.port.get(NATIVE_TOKEN_REGISTRY_KEY);
      enabled = true;
      await assert.rejects(registry.addCollectible(f.scope, 2, collectible(3, '1'), current));
      assert.equal(registry.requiresReopen, true);
      await assert.rejects(registry.load(f.scope, current), /REOPEN_REQUIRED/);
      await f.reopen();
      const loaded = await new NativeTokenRegistry(f.port).load(f.scope, current);
      assert.deepEqual(loaded.items, [token()]);
      assert.deepEqual(loaded.collectibles, point === 'lost-ack' ? [collectible(), collectible(3, '1')] : [collectible()]);
      assert.equal(loaded.revision, point === 'lost-ack' ? 3 : 2);
      if (point === 'before-commit') assert.deepEqual(await f.port.get(NATIVE_TOKEN_REGISTRY_KEY), before);
    } finally { await f.cleanup(); }
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
    let value = await registry.addCollectible(f.scope, 0, collectible(500), current);
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
    assert.deepEqual(value.collectibles, [collectible(500)]);
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

test('HD and imported token metadata never share an account scope or retired identity', async () => {
  const f = await fixture();
  try {
    const registry = new NativeTokenRegistry(f.port), imported = { ...f.scope, accountId: 'imported:60:0' };
    await registry.load(f.scope, current); await registry.add(f.scope, 0, token(1), current);
    assert.deepEqual((await registry.load(imported, current)).items, []);
    await registry.add(imported, 1, token(2), current);
    assert.deepEqual((await registry.load(f.scope, current)).items, [token(1)]);
    assert.deepEqual((await registry.load(imported, current)).items, [token(2)]);
    assert.deepEqual((await registry.load({ ...imported, accountId: 'imported:60:1' }, current)).items, []);
    await f.reopen();
    assert.deepEqual((await new NativeTokenRegistry(f.port).load(imported, current)).items, [token(2)]);
  } finally { await f.cleanup(); }
});
