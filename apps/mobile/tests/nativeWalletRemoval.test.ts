import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { signingFixtureHost } from './unsupportedDappPorts.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { createNoteBackupCodec } from '../../../source/wallet/noteBackup.ts';
import { ACCOUNT_SELECTION_KEY, createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { NativeWalletRemoval } from '../src/custody/walletRemoval.ts';
import { NativeControllerLifecycle } from '../src/custody/nativeControllerLifecycle.ts';
import { NativeConnectionsController } from '../src/connections/controller.ts';
import type { WalletConnectTransport } from '../src/connections/walletConnect.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import { openWalletStorage, type NativeStoragePorts } from '../src/storage/coordinator.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

const pinCredential = createTestPinCredentialPort();
const sdk = await loadNativeKeyringSdk();

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';
const FILE_PASSWORD = 'Public fixture wallet removal backup password!';
const WRONG = '000000';
const NOTE = { note: `tornado-eth-1-1-0x${'01'.repeat(62)}`, createdAt: 10 };
const NATIVE_HINT = JSON.stringify({ kind: 'hd', id: 'hd:60:0' });
const WATCH_HINT = JSON.stringify({ kind: 'watch', id: 'independent-watch' });
const current = () => undefined;

function pause() {
  let enter!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release, async hold() { enter(); await wait; } };
}

async function fixture(withSlhCache = false) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-native-wallet-removal-'));
  const file = path.join(directory, 'wallet.sqlite');
  let exists = false, held = false, key: string | null = null;
  let opens = 0, unlocks = 0, now = 0, active = true, removalCommits = 0;
  let droppingRemovalAck: 'before' | 'after' | undefined, loseHintAck = false;
  let pauseUnlock: ReturnType<typeof pause> | undefined, afterRemovalCommit: SqlHook | undefined;
  const purgedNamespaces: string[] = [];
  let purgeFailure = false, pausePurge: ReturnType<typeof pause> | undefined;
  let beforeSnapshot: (check: () => void) => Promise<void> = async () => undefined;
  let reopenedIdentity: string | undefined;
  const rings: InstanceType<typeof sdk.HostKeyring>[] = [];
  const statements: string[] = [];
  class ObservedRing extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) { super(...options); rings.push(this); }
  }
  const ports: NativeStoragePorts = {
    digest,
    randomBytes: (size) => new Uint8Array(size).fill(0xa1),
    policy: {
      async acquire() { assert.equal(held, false); held = true; return { token: 'fixture', directory, databaseExists: exists }; },
      async inspect() { assert.equal(held, true); return { databaseExists: exists }; },
      async createDatabase() { await writeFile(file, '', { flag: 'wx' }); exists = true; },
      async protect() { assert.equal(held, true); },
      async release() { assert.equal(held, true); held = false; },
    },
    keyStore: { async get() { return key; }, async set(value) { key = value; } },
    async openDatabase() {
      opens++;
      let deleting = false;
      return nodeConnection(file, {
        before(kind, sql) {
          statements.push(sql);
          if (kind === 'run' && sql.startsWith('DELETE FROM evm_signed_records')) deleting = true;
          if (kind === 'exec' && sql === 'COMMIT' && deleting) {
            removalCommits++;
            if (droppingRemovalAck === 'before') throw new Error('Fixture did not dispatch COMMIT');
          }
        },
        async after(kind, sql) {
          if (kind === 'exec' && sql === 'ROLLBACK') deleting = false;
          if (kind === 'exec' && sql === 'COMMIT' && deleting) {
            deleting = false;
            await afterRemovalCommit?.(kind, sql);
            if (droppingRemovalAck === 'after') throw new Error('Fixture lost COMMIT acknowledgement');
          }
        },
      }).connection;
    },
  };
  const underlyingStorage = await openWalletStorage(ports);
  const pin = underlyingStorage.pin;
  const storage: OpenWalletStorage = Object.freeze({ ...underlyingStorage, pin: Object.freeze({ ...pin,
    async beginAttempt(...args: Parameters<typeof pin.beginAttempt>) {
      const attempt = await pin.beginAttempt(...args);
      unlocks++;
      const gate = pauseUnlock; pauseUnlock = undefined;
      if (gate) await gate.hold();
      return attempt;
    },
  }) });
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: PASSWORD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, slhExecution: withSlhCache ? {
    open() { throw Error('No signing context belongs to this removal fixture'); },
    async purgePublicCache(namespace, guard) {
      guard(); assert.equal(owner.getSnapshot().phase, 'disposed'); assert.equal(rings.some(ring => ring.isUnlocked()), false);
      purgedNamespaces.push(namespace);
      await pausePurge?.hold(); guard();
      if (purgeFailure) throw Error('public cache purge failed');
    },
  } : null, readEvmRetirement: null,
    ensureCryptoReady: async () => undefined,
    loadSdk: async () => ({ ...sdk, HostKeyring: ObservedRing }),
    openStorage: async () => storage,
  });
  const runtime = await factory.open() as KeyringRuntime;
  const owner = new NativeCustodyAuthority({ open: async () => runtime });
  await owner.initialize();
  await owner.importPhrase(PHRASE, PASSWORD);
  const values = new Map([
    [ACCOUNT_SELECTION_KEY, NATIVE_HINT],
    [PUBLIC_ACCOUNTS_KEY, 'independent watch records fixture bytes'],
  ]);
  const selections = createPublicAccountStorage({
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) {
      values.set(key, value);
      if (loseHintAck) { loseHintAck = false; throw new Error('Fixture lost hint write acknowledgement'); }
    },
  });
  const removal = new NativeWalletRemoval({
    owner,
    source: () => ({ runtime, storage }),
    async reopen(installation) { reopenedIdentity = installation; return openWalletStorage(ports, installation); },
    assertActive() { if (!active) throw new Error('CANCELLED'); },
    monotonicMilliseconds: () => now,
    clearNativeSelection: selections.clearNativeSelection,
    beforeSnapshot: (check) => beforeSnapshot(check),
  });
  return {
    owner, runtime, storage, removal, values, statements, ports,
    purgedNamespaces, failPurge() { purgeFailure = true; }, holdPurge() { return pausePurge = pause(); },
    holdRetirement() {
      const gate = pause(), original = runtime.storage.retireForRemoval!.bind(runtime.storage);
      runtime.storage.retireForRemoval = remove => original(async () => { await gate.hold(); return remove(); });
      return gate;
    },
    get key() { return key; }, set key(value) { key = value; },
    get opens() { return opens; }, get unlocks() { return unlocks; }, get removalCommits() { return removalCommits; },
    get held() { return held; }, get reopenedIdentity() { return reopenedIdentity; },
    get unlocked() { return rings.some((ring) => ring.isUnlocked()); },
    advance(value: number) { now = value; }, hide() { active = false; },
    beforeSnapshot(callback: (check: () => void) => Promise<void>) { beforeSnapshot = callback; },
    holdUnlock() { return pauseUnlock = pause(); },
    holdCommit() { const gate = pause(); afterRemovalCommit = () => gate.hold(); return gate; },
    loseRemovalAck(when: 'before' | 'after') { droppingRemovalAck = when; },
    loseHintAck() { loseHintAck = true; },
    async savedNotes() {
      const bytes = await createNoteBackupCodec({ crypto: globalThis.crypto, assertCurrent: current }).encrypt({
        format: 'pali-private-notes', version: 1, createdAt: 20, notes: [NOTE],
      }, FILE_PASSWORD);
      try {
        const service = await runtime.openNoteBackup!(current);
        const id = service.begin();
        await service.prepareImport(id, bytes, FILE_PASSWORD);
        assert.equal((await service.commitImport(id, PASSWORD)).added, 1);
      } finally { bytes.fill(0); }
    },
    async close() {
      await removal.dispose().catch(() => undefined);
      try { await owner.dispose(); } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

test('real SDK authorization issues an empty one-use ticket and only explicit confirmation removes records', async () => {
  const f = await fixture();
  try {
    await f.savedNotes();
    const owner = f.owner.getSnapshot(), key = f.key;
    const unlocks = f.unlocks;
    const ticket = await f.removal.authorize(PASSWORD, current);
    assert.ok(Object.isFrozen(ticket));
    assert.deepEqual(Reflect.ownKeys(ticket), []);
    assert.equal(f.unlocks, unlocks + 1);
    assert.equal(f.removalCommits, 0);
    assert.equal(f.owner.getSnapshot(), owner);
    assert.equal((await f.storage.notes!.read()).length, 1);
    await assert.rejects(f.removal.confirm({ ...ticket }, current), { code: 'STATE_CHANGED' });
    f.loseHintAck();
    const removal = f.removal.confirm(ticket, current);
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'STATE_CHANGED' });
    assert.equal(await removal, 'wallet-records-removed');
    assert.equal(f.removal.hasVerifiedRemoval(), true);
    assert.equal(f.reopenedIdentity, INSTALLATION);
    assert.equal(f.opens, 2);
    assert.equal(f.held, false);
    assert.equal(f.owner.getSnapshot().phase, 'disposed');
    assert.equal(f.unlocked, false);
    assert.equal(f.key, key);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), 'null');
    assert.equal(f.values.get(PUBLIC_ACCOUNTS_KEY), 'independent watch records fixture bytes');
    assert.equal(f.removalCommits, 1);
  } finally { await f.close(); }
});

test('wrong credentials use the existing durable throttle and never clear selection or delete data', async () => {
  const f = await fixture();
  try {
    for (let count = 0; count < 5; count++) await assert.rejects(f.removal.authorize(WRONG, current), { code: 'INVALID_CREDENTIAL' });
    const snapshot = await f.storage.recovery!.readSnapshot();
    assert.equal(JSON.parse(snapshot.metadata.find(({ key }) => key === 'auth')!.value).failures, 5);
    const unlocks = f.unlocks;
    await assert.rejects(f.removal.authorize(PASSWORD, current), { code: 'AUTH_THROTTLED' });
    assert.equal(f.unlocks, unlocks);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
    assert.equal(f.removalCommits, 0);
  } finally { await f.close(); }
});

for (const interruption of ['cancel', 'cancel-during-retirement', 'lock', 'expiry'] as const) {
  test(`${interruption} after removal preparation reopens the retained wallet with usable connections`, async () => {
    const f = await fixture(), held = pause();
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint());
    await f.owner.refreshAuthenticatedMetadata();
    let created = 0, pairs = 0;
    let nextRuntime: KeyringRuntime | undefined, nextStorage: OpenWalletStorage | undefined;
    const connect = (owner: NativeCustodyAuthority, runtime: () => KeyringRuntime) => new NativeConnectionsController({
      async openExternalUrl() { throw Error('Website returns are outside this fixture'); },
      source: owner, activateAccount: (id, revision, guard) => owner.selectConnectionAccount(id, revision, guard), openHost: async () => signingFixtureHost(await runtime().openConnectionHost()), preparePlatform: async () => undefined,
      checkSite: async () => ({ isBlacklisted: false }),
      checkAddress: async () => ({ isBlacklisted: false, severity: 'low' }),
      projectId: 'public-removal-fixture',
      metadata: { name: 'Pali', description: '', url: 'https://paliwallet.com', icons: [] },
      openTransport: async () => {
        const transport: WalletConnectTransport = {
          async pair(_uri, guard, onPairing) {
            guard(); pairs++;
            const pairing = { topic: 'ab'.repeat(32), expiresAt: Date.now() + 60000, async cancel() {} };
            onPairing(pairing); return pairing;
          },
          async updatePreparedAccount() { throw Error('Smart creation is outside this fixture'); },
          async pending() { return null; }, async sessions() { return []; }, async close() {},
          async approve() { throw new Error('Unexpected approval'); },
          async reject() { throw new Error('Unexpected rejection'); },
          async respond() { throw new Error('Unexpected response'); },
          async disconnect() { throw new Error('Unexpected disconnect'); },
          async emit() { throw new Error('Unexpected event'); },
        };
        return transport;
      },
    });
    const firstConnections = connect(f.owner, () => f.runtime);
    f.beforeSnapshot(async (guard) => {
      guard(); await firstConnections.dispose();
      if (interruption === 'cancel-during-retirement') await held.hold();
      guard();
    });
    const firstBundle = { authority: f.owner, removal: f.removal, connections: firstConnections,
      keyExport: { dispose() {} }, backup: { dispose() {} }, disposeTokens() {}, disposeTransfers() {},
      disposeConnections: () => firstConnections.dispose() };
    const gate = new NativeControllerLifecycle({
      protect: async () => undefined,
      recovery() { throw new Error('Unexpected recovery'); },
      create() {
        if (++created === 1) return firstBundle;
        assert.equal(created, 2);
        const authority = new NativeCustodyAuthority({ async open() {
          nextStorage = await openWalletStorage(f.ports);
          nextRuntime = await createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: PASSWORD }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
            ensureCryptoReady: async () => undefined, openStorage: async () => nextStorage!,
          }).open() as KeyringRuntime;
          return nextRuntime;
        } });
        const connections = connect(authority, () => nextRuntime!);
        const removal = new NativeWalletRemoval({ owner: authority,
          source: () => nextRuntime && nextStorage ? { runtime: nextRuntime, storage: nextStorage } : undefined,
          reopen: async (installation) => openWalletStorage(f.ports, installation),
          async clearNativeSelection() { throw new Error('Unexpected wallet deletion'); },
          beforeSnapshot: async (guard) => { guard(); await connections.dispose(); guard(); }, assertActive: current,
        });
        return { authority, removal, connections, keyExport: { dispose() {} }, backup: { dispose() {} },
          disposeTokens() {}, disposeTransfers() {}, disposeConnections: () => connections.dispose() };
      },
    });
    const token = {};
    try {
      await gate.acquire(token, () => true);
      await firstConnections.view.pair('wc:fixture');
      assert.equal(pairs, 1);
      assert.equal(f.removal.requiresControllerReopen(), false);
      await assert.rejects(f.removal.authorize(WRONG, current), { code: 'INVALID_CREDENTIAL' });
      assert.equal(f.removal.requiresControllerReopen(), false);
      const authorizing = f.removal.authorize(PASSWORD, current);
      let ticket;
      if (interruption === 'cancel-during-retirement') await held.reached;
      else ticket = await authorizing;
      assert.equal(f.removal.requiresControllerReopen(), true);
      const retained = await f.storage.recovery!.readSnapshot();
      if (interruption === 'lock') f.owner.lock();
      else if (interruption === 'expiry') {
        f.advance(30000);
        await assert.rejects(f.removal.confirm(ticket!, current), { code: 'CANCELLED' });
      } else f.removal.cancel();
      const draining = gate.release(token), opening = gate.acquire(token, () => true);
      if (interruption === 'cancel-during-retirement') {
        const rejected = assert.rejects(authorizing, { code: 'CANCELLED' });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(created, 1);
        held.release(); await rejected;
      }
      await draining;
      const next = await opening;
      assert.ok(next);
      assert.equal(next.authority.getSnapshot().phase, 'locked');
      assert.equal(next.removal.requiresControllerReopen(), false);
      assert.deepEqual(await nextStorage!.recovery!.readSnapshot(), retained);
      assert.equal(f.removalCommits, 0);
      assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
      await next.authority.unlock(PASSWORD);
      await next.connections.view.pair('wc:fixture');
      assert.equal(pairs, 2);
      assert.equal(next.authority.getCatalogue()!.active.accountId, 'hd:60:0');
      assert.equal(next.connections.view.getSnapshot().error, null);
      assert.equal(firstConnections.view.getSnapshot().status, 'locked');
    } finally {
      held.release(); await gate.release(token).catch(() => undefined); await f.close();
    }
  });
}

test('authenticated producer cleanup finishes before the exact removal snapshot is sealed', async () => {
  const f = await fixture();
  try {
    const unlocks = f.unlocks;
    let cleanupCalls = 0;
    f.beforeSnapshot(async (check) => {
      check();
      assert.equal(f.unlocks, unlocks + 1);
      assert.equal(f.unlocked, false, 'public cleanup must not retain a software signer');
      cleanupCalls++;
      await f.storage.keyringStorage.set('utf8Error', { hasUtf8Error: false });
      check();
    });
    const ticket = await f.removal.authorize(PASSWORD, current);
    assert.equal(cleanupCalls, 1);
    const snapshot = await f.storage.recovery!.readSnapshot();
    assert.equal(snapshot.records.some(({ key }) => key === 'utf8Error'), true);
    assert.equal(await f.removal.confirm(ticket, current), 'wallet-records-removed');
    assert.equal(f.removalCommits, 1);
  } finally { await f.close(); }
});

test('cleanup is not invoked for a wrong password and cancellation during cleanup prevents a ticket', async () => {
  const f = await fixture();
  const gate = pause();
  try {
    let cleanupCalls = 0;
    f.beforeSnapshot(async (check) => {
      cleanupCalls++;
      await gate.hold();
      check();
    });
    await assert.rejects(f.removal.authorize(WRONG, current), { code: 'INVALID_CREDENTIAL' });
    assert.equal(cleanupCalls, 0);
    f.owner.lock();
    await f.owner.unlock(PASSWORD);
    const pending = assert.rejects(f.removal.authorize(PASSWORD, current), { code: 'CANCELLED' });
    await gate.reached;
    f.owner.lock();
    gate.release();
    await pending;
    assert.equal(cleanupCalls, 1);
    assert.equal(f.removalCommits, 0);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
  } finally { gate.release(); await f.close(); }
});

test('ticket expiry, wallet A-B-A and asynchronous confirmation guards cannot admit deletion', async () => {
  const f = await fixture();
  try {
    const expired = await f.removal.authorize(PASSWORD, current);
    f.advance(30_000);
    await assert.rejects(f.removal.confirm(expired, current), { code: 'CANCELLED' });
    const obsolete = await f.removal.authorize(PASSWORD, current);
    f.owner.lock();
    await f.owner.unlock(PASSWORD);
    await assert.rejects(f.removal.confirm(obsolete, current), { code: 'STATE_CHANGED' });
    const currentTicket = await f.removal.authorize(PASSWORD, current);
    await assert.rejects(f.removal.confirm(currentTicket, async () => undefined), { code: 'CANCELLED' });
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal(f.removalCommits, 0);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
  } finally { await f.close(); }
});

test('late SDK password success after lock cannot authorize or reactivate removal', async () => {
  const f = await fixture();
  const gate = f.holdUnlock();
  try {
    const pending = assert.rejects(f.removal.authorize(PASSWORD, current), { code: 'CANCELLED' });
    await gate.reached;
    f.owner.lock();
    gate.release();
    await pending;
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.equal(f.unlocked, false);
    assert.equal(f.removalCommits, 0);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
  } finally { gate.release(); await f.close(); }
});

test('runtime retirement alone invalidates a ticket even before the public authority updates', async () => {
  const f = await fixture();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    await f.runtime.session.lock();
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'CANCELLED' });
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
    assert.equal(f.removalCommits, 0);
  } finally { await f.close(); }
});

test('an unreadable advisory selection refuses deletion and preserves the existing wallet', async () => {
  const f = await fixture();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const before = await f.storage.recovery!.readSnapshot();
    f.values.set(ACCOUNT_SELECTION_KEY, 'invalid selection fixture');
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'SELECTION_UNAVAILABLE' });
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), 'invalid selection fixture');
    assert.equal(f.removalCommits, 0);
    const reopened = await openWalletStorage(f.ports, INSTALLATION);
    try { assert.deepEqual(await reopened.recovery!.readSnapshot(), before); } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('a changed storage generation aborts confirmed deletion and preserves an independent watch hint', async () => {
  const f = await fixture();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    await f.storage.keyringStorage.set('fixture-removal-generation', 'changed');
    await f.storage.keyringStorage.deleteItem('fixture-removal-generation');
    const before = await f.storage.recovery!.readSnapshot();
    f.values.set(ACCOUNT_SELECTION_KEY, WATCH_HINT);
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'STATE_CHANGED' });
    assert.equal(f.removalCommits, 0);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), WATCH_HINT);
    assert.equal(f.unlocked, false);
    const reopened = await openWalletStorage(f.ports, INSTALLATION);
    try { assert.deepEqual(await reopened.recovery!.readSnapshot(), before); } finally { await reopened.close(); }
  } finally { await f.close(); }
});

for (const when of ['before', 'after'] as const) {
  test(`lost ${when}-COMMIT acknowledgement reconciles the same installation once`, async () => {
    const f = await fixture();
    try {
      f.values.set(ACCOUNT_SELECTION_KEY, WATCH_HINT);
      const ticket = await f.removal.authorize(PASSWORD, current);
      f.loseRemovalAck(when);
      assert.equal(await f.removal.confirm(ticket, current), when === 'after' ? 'wallet-records-removed' : 'wallet-records-unchanged');
      assert.equal(f.removal.hasVerifiedRemoval(), when === 'after');
      assert.equal(f.reopenedIdentity, INSTALLATION);
      assert.equal(f.opens, 2);
      assert.equal(f.removalCommits, 1);
      assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), WATCH_HINT);
    } finally { await f.close(); }
  });
}

test('a lost protected installation during reconciliation never provisions or reports a clean result', async () => {
  const f = await fixture();
  const gate = f.holdCommit();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const confirmation = assert.rejects(f.removal.confirm(ticket, current), { code: 'REOPEN_REQUIRED' });
    await gate.reached;
    f.key = null;
    gate.release();
    await confirmation;
    assert.equal(f.key, null);
    assert.equal(f.opens, 1);
    assert.equal(f.removalCommits, 1);
    assert.equal(f.removal.hasVerifiedRemoval(), false);
    await assert.rejects(f.removal.dispose(), { code: 'REOPEN_REQUIRED' });
  } finally { gate.release(); await f.close(); }
});

test('cancelling after dispatch still drains and verifies removal without replay', async () => {
  const f = await fixture();
  const gate = f.holdCommit();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const confirmation = f.removal.confirm(ticket, current);
    await gate.reached;
    f.hide();
    const disposal = f.removal.dispose();
    assert.equal(f.removal.hasVerifiedRemoval(), false);
    gate.release();
    assert.equal(await confirmation, 'wallet-records-removed');
    await disposal;
    assert.equal(f.removal.hasVerifiedRemoval(), true);
    assert.equal(f.removalCommits, 1);
  } finally { gate.release(); await f.close(); }
});


test('public SLH cache cleanup is confirmation-only and bound to the captured profile after retirement', async () => {
  const f = await fixture(true);
  try {
    const namespace = (await f.storage.recovery!.readIdentity())!.root!.profileId;
    const ticket = await f.removal.authorize(PASSWORD, current);
    assert.deepEqual(f.purgedNamespaces, []);
    assert.equal(await f.removal.confirm(ticket, current), 'wallet-records-removed');
    assert.deepEqual(f.purgedNamespaces, [namespace]);
    assert.equal(f.removalCommits, 1);
  } finally { await f.close(); }
});

test('forged, expired and cancelled removal tickets never purge public SLH caches', async () => {
  const f = await fixture(true);
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    await assert.rejects(f.removal.confirm({ ...ticket }, current), { code: 'STATE_CHANGED' });
    f.advance(30000);
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'CANCELLED' });
    const cancelled = await f.removal.authorize(PASSWORD, current);
    f.removal.cancel();
    await assert.rejects(f.removal.confirm(cancelled, current), { code: 'STATE_CHANGED' });
    assert.deepEqual(f.purgedNamespaces, []); assert.equal(f.removalCommits, 0);
  } finally { await f.close(); }
});

test('failed public SLH cache cleanup prevents native selection clearing and SQL deletion', async () => {
  const f = await fixture(true);
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const before = await f.storage.recovery!.readSnapshot();
    f.failPurge();
    await assert.rejects(f.removal.confirm(ticket, current), { code: 'UNAVAILABLE' });
    assert.equal(f.purgedNamespaces.length, 1); assert.equal(f.removalCommits, 0);
    assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
    const reopened = await openWalletStorage(f.ports);
    try { assert.deepEqual(await reopened.recovery!.readSnapshot(), before); } finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('public SLH cache cleanup waits for the existing owner retirement boundary', async () => {
  const f = await fixture(true), drain = f.holdRetirement();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const removing = f.removal.confirm(ticket, current);
    await drain.reached;
    assert.equal(f.unlocked, false); assert.deepEqual(f.purgedNamespaces, []);
    assert.equal(f.removalCommits, 0);
    drain.release();
    assert.equal(await removing, 'wallet-records-removed');
    assert.equal(f.purgedNamespaces.length, 1);
  } finally { drain.release(); await f.close(); }
});

test('retirement of a removal request during public-cache purge cannot delete SQL records', async () => {
  const f = await fixture(true), purge = f.holdPurge();
  try {
    const ticket = await f.removal.authorize(PASSWORD, current);
    const removing = f.removal.confirm(ticket, current);
    const rejected = assert.rejects(removing, { code: 'CANCELLED' });
    await purge.reached; f.removal.cancel(); purge.release(); await rejected;
    assert.equal(f.removalCommits, 0); assert.equal(f.values.get(ACCOUNT_SELECTION_KEY), NATIVE_HINT);
  } finally { purge.release(); await f.close(); }
});
