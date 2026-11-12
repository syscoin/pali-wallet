import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  canResetOrphanedWalletStorage,
  openWalletStorage,
  resetOrphanedWalletStorage,
  type NativeStoragePorts,
} from '../src/storage/coordinator.ts';
import { digest, nodeConnection } from './storageHelpers.ts';

const ready = JSON.stringify({
  version: 1,
  status: 'ready',
  installationId: '1'.repeat(32),
  key: '2'.repeat(64),
});
const different = ready.replace('2'.repeat(64), '3'.repeat(64));
const candidates = [
  ['ready orphan', ready, false],
  ['existing database', ready, true],
  ['missing key', null, false],
  ['provisioning', ready.replace('ready', 'provisioning'), false],
  ['malformed', '{', false],
  ['unknown status', ready.replace('ready', 'other'), false],
  ['invalid identity', ready.replace('1'.repeat(32), 'bad'), false],
] as const;
async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-orphan-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = {
    record: ready as string | null,
    exists: false,
    held: false,
    gets: 0,
    releases: 0,
    deletes: 0,
    writes: 0,
    opens: 0,
    authorizations: 0,
    events: [] as string[],
    signal: new AbortController(),
    current: true,
    onGet: (_count: number) => {},
    onInspect: () => {},
    onRelease: () => {},
    onRemove: () => {},
    onAuthorize: async () => {},
  };
  const owned = (token: string) => {
    assert(f.held);
    assert.equal(token, 'lease');
  };
  const ports: NativeStoragePorts & {
    keyStore: NativeStoragePorts['keyStore'] & { remove(): Promise<void> };
  } = {
    digest,
    randomBytes,
    policy: {
      async acquire() {
        if (f.held) throw Error('LEASE_BUSY');
        f.held = true;
        f.events.push('acquire');
        return { token: 'lease', directory, databaseExists: f.exists };
      },
      async inspect(token) {
        owned(token);
        f.events.push('inspect');
        f.onInspect();
        return { databaseExists: f.exists };
      },
      async createDatabase(token) {
        owned(token);
        f.events.push('create');
        await writeFile(path.join(directory, 'wallet.sqlite'), '', {
          flag: 'wx',
        });
        f.exists = true;
      },
      async protect(token) {
        owned(token);
      },
      async release(token) {
        owned(token);
        f.held = false;
        f.releases++;
        f.events.push('release');
        f.onRelease();
      },
    },
    keyStore: {
      async get() {
        f.events.push('get');
        f.onGet(++f.gets);
        return f.record;
      },
      async set(value) {
        f.writes++;
        f.record = value;
      },
      async remove() {
        f.deletes++;
        f.events.push('remove');
        f.onRemove();
        f.record = null;
      },
    },
    async openDatabase() {
      f.opens++;
      return nodeConnection(path.join(directory, 'wallet.sqlite')).connection;
    },
  };
  const options = {
    signal: f.signal.signal,
    assertCurrent() {
      if (!f.current) throw Error('STALE_OWNER');
    },
    async authorize(signal: AbortSignal, check: () => void) {
      assert.equal(signal, f.signal.signal);
      check();
      f.authorizations++;
      f.events.push('authorize');
      await f.onAuthorize();
      check();
    },
  };
  return { f, ports, options };
}
for (const [label, record, exists] of candidates)
  test(`probe is read-only for ${label}`, async (t) => {
    const { f, ports } = await fixture(t);
    f.record = record;
    f.exists = exists;
    assert.equal(
      await canResetOrphanedWalletStorage(ports),
      label === 'ready orphan'
    );
    assert.equal(f.record, record);
    assert.equal(f.exists, exists);
    assert.equal(f.deletes + f.writes + f.opens + f.authorizations, 0);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  });
for (const failure of ['acquire', 'get', 'inspect', 'release'] as const)
  test(`probe refuses ${failure} failure`, async (t) => {
    const { f, ports } = await fixture(t),
      fail = () => {
        throw Error('TRANSIENT_FAILURE');
      };
    if (failure === 'acquire') ports.policy.acquire = async () => fail();
    else if (failure === 'get') f.onGet = fail;
    else if (failure === 'inspect') f.onInspect = fail;
    else f.onRelease = fail;
    assert.equal(await canResetOrphanedWalletStorage(ports), false);
    assert.equal(f.record, ready);
    assert.equal(f.deletes + f.writes + f.opens, 0);
    assert.equal(f.releases, failure === 'acquire' ? 0 : 1);
  });
test('explicit authorized deletion permits fresh bootstrap; ordinary open still refuses an orphan', async (t) => {
  const { f, ports, options } = await fixture(t);
  await assert.rejects(openWalletStorage(ports), {
    code: 'STORAGE_ORPHAN_KEY',
  });
  assert.equal(f.deletes + f.writes + f.opens, 0);
  f.events.length = 0;
  await resetOrphanedWalletStorage(ports, options);
  assert.deepEqual(f.events, [
    'acquire',
    'get',
    'inspect',
    'authorize',
    'get',
    'inspect',
    'get',
    'remove',
    'get',
    'release',
  ]);
  assert.equal(f.authorizations, 1);
  assert.equal(f.deletes, 1);
  assert.equal(f.record, null);
  assert.equal(f.held, false);
  const storage = await openWalletStorage(ports);
  try {
    assert.deepEqual(await storage.readState(), {
      presence: 'empty',
      backup: 'unconfirmed',
    });
    assert.notEqual(f.record, ready);
    assert.equal(JSON.parse(f.record!).status, 'ready');
  } finally {
    await storage.close();
  }
  assert.equal(f.held, false);
});
for (const [label, record, exists] of candidates.slice(1))
  test(`reset refuses ${label} before authorization or mutation`, async (t) => {
    const { f, ports, options } = await fixture(t);
    f.record = record;
    f.exists = exists;
    await assert.rejects(resetOrphanedWalletStorage(ports, options));
    assert.equal(f.record, record);
    assert.equal(f.exists, exists);
    assert.equal(f.authorizations + f.deletes + f.writes + f.opens, 0);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  });
for (const change of [
  'cancel',
  'owner',
  'key',
  'database',
  'inspect-failure',
] as const)
  test(`reset refuses ${change} after authorization`, async (t) => {
    const { f, ports, options } = await fixture(t);
    f.onAuthorize = async () => {
      if (change === 'cancel') f.signal.abort();
      if (change === 'owner') f.current = false;
      if (change === 'key') f.record = different;
      if (change === 'database') f.exists = true;
      if (change === 'inspect-failure')
        f.onInspect = () => {
          throw Error('POLICY_FAILED');
        };
    };
    await assert.rejects(resetOrphanedWalletStorage(ports, options));
    assert.equal(f.deletes + f.writes + f.opens, 0);
    assert.equal(f.record, change === 'key' ? different : ready);
    assert.equal(f.releases, 1);
    assert.equal(f.held, false);
  });
test('abort keeps the lease until the native authorization drains and never deletes', async (t) => {
  const { f, ports, options } = await fixture(t),
    started = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  f.onAuthorize = async () => {
    started.resolve();
    await finish.promise;
  };
  const pending = resetOrphanedWalletStorage(ports, options),
    refused = assert.rejects(pending, /STORAGE_CHANGED|STALE_OWNER/);
  await started.promise;
  f.signal.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.held, true);
  assert.equal(f.releases, 0);
  assert.equal(f.deletes, 0);
  finish.resolve();
  await refused;
  assert.equal(f.held, false);
  assert.equal(f.releases, 1);
  assert.equal(f.deletes, 0);
  assert.equal(f.record, ready);
});
test('authorization refusal or a non-void authorization result cannot delete', async (t) => {
  for (const returnsValue of [false, true]) {
    const { f, ports, options } = await fixture(t);
    if (returnsValue)
      options.authorize = (async () =>
        false) as unknown as typeof options.authorize;
    else
      f.onAuthorize = async () => {
        throw Error('USER_CANCELLED');
      };
    await assert.rejects(resetOrphanedWalletStorage(ports, options));
    assert.equal(f.deletes + f.writes, 0);
    assert.equal(f.record, ready);
    assert.equal(f.held, false);
  }
});
test('missing controls, pre-abort and an async owner guard refuse before acquisition', async (t) => {
  const { f, ports, options } = await fixture(t);
  for (const bad of [
    { ...options, signal: undefined },
    { ...options, authorize: undefined },
    { ...options, assertCurrent: async () => {} },
  ])
    await assert.rejects(
      resetOrphanedWalletStorage(ports, bad as unknown as typeof options)
    );
  f.signal.abort();
  await assert.rejects(resetOrphanedWalletStorage(ports, options));
  assert.equal(f.events.length, 0);
  assert.equal(f.record, ready);
});
for (const failure of [
  'delete-before',
  'delete-after',
  'no-delete',
  'readback',
  'owner',
  'release',
] as const)
  test(`uncertain ${failure} requires reopening without recreating keys`, async (t) => {
    const { f, ports, options } = await fixture(t);
    if (failure === 'delete-before')
      f.onRemove = () => {
        throw Error('DELETE_FAILED');
      };
    if (failure === 'delete-after')
      f.onRemove = () => {
        f.record = null;
        throw Error('ACK_LOST');
      };
    if (failure === 'no-delete')
      ports.keyStore.remove = async () => {
        f.deletes++;
      };
    if (failure === 'readback')
      f.onGet = (count) => {
        if (count === 4) throw Error('READ_FAILED');
      };
    if (failure === 'owner')
      f.onRemove = () => {
        f.current = false;
      };
    if (failure === 'release')
      f.onRelease = () => {
        throw Error('RELEASE_FAILED');
      };
    await assert.rejects(resetOrphanedWalletStorage(ports, options), {
      code: 'STORAGE_REOPEN_REQUIRED',
    });
    assert.equal(f.deletes, 1);
    assert.equal(f.writes + f.opens, 0);
    assert.equal(f.releases, 1);
    assert.equal(
      f.record,
      failure === 'delete-before' || failure === 'no-delete' ? ready : null
    );
  });

for (const failure of ['acquire', 'get', 'inspect'] as const)
  test(`reset refuses early ${failure} errors without authorization`, async (t) => {
    const { f, ports, options } = await fixture(t),
      fail = () => {
        throw Error('POLICY_FAILED');
      };
    if (failure === 'acquire') ports.policy.acquire = async () => fail();
    else if (failure === 'get') f.onGet = fail;
    else f.onInspect = fail;
    await assert.rejects(resetOrphanedWalletStorage(ports, options));
    assert.equal(f.record, ready);
    assert.equal(f.deletes + f.authorizations + f.writes + f.opens, 0);
    assert.equal(f.releases, failure === 'acquire' ? 0 : 1);
  });

test('missing or non-boolean native absence evidence is not eligible', async (t) => {
  for (const databaseExists of [undefined, null, 0, 'false']) {
    const { f, ports, options } = await fixture(t);
    ports.policy.inspect = async () =>
      ({ databaseExists } as unknown as { databaseExists: boolean });
    assert.equal(await canResetOrphanedWalletStorage(ports), false);
    await assert.rejects(resetOrphanedWalletStorage(ports, options));
    assert.equal(f.deletes + f.authorizations, 0);
    assert.equal(f.record, ready);
    assert.equal(f.held, false);
  }
});

test('a key replacement during the final native absence inspection prevents deletion', async (t) => {
  const { f, ports, options } = await fixture(t);
  let inspections = 0;
  f.onInspect = () => {
    if (++inspections === 2) f.record = different;
  };
  await assert.rejects(resetOrphanedWalletStorage(ports, options), {
    code: 'STORAGE_CHANGED',
  });
  assert.equal(f.record, different);
  assert.equal(f.deletes, 0);
  assert.equal(f.releases, 1);
});

test('one held reset excludes another without releasing its lease', async (t) => {
  const { f, ports, options } = await fixture(t),
    started = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  f.onAuthorize = async () => {
    started.resolve();
    await finish.promise;
  };
  const first = resetOrphanedWalletStorage(ports, options);
  await started.promise;
  await assert.rejects(
    resetOrphanedWalletStorage(ports, options),
    /LEASE_BUSY/
  );
  assert.equal(f.held, true);
  assert.equal(f.releases, 0);
  assert.equal(f.deletes, 0);
  finish.resolve();
  await first;
  assert.equal(f.deletes, 1);
  assert.equal(f.releases, 1);
  assert.equal(f.held, false);
});
