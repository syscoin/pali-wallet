import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativePinVault, captureNativePinRecord, type NativePinCredentialPort, type NativePinRecord } from '../src/custody/pinVault.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { encodeStorageValue } from '../src/storage/json.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { digest, INSTALLATION, nodeConnection, type SqlHook } from './storageHelpers.ts';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-pin-'));
  const file = path.join(directory, 'wallet.sqlite');
  const port = createTestPinCredentialPort();
  let wall = 1000, mono = 1000;
  let rejectCommit = false, metadataWrites = 0;
  let replacementHook: SqlHook | undefined;
  let replacementBeforeHook: SqlHook | undefined;
  let secretLeases = 0;
  let storage: SqliteWalletStorage;
  const keyrings: InstanceType<Awaited<ReturnType<typeof loadNativeKeyringSdk>>['HostKeyring']>[] = [];
  const open = async () => {
    storage = await SqliteWalletStorage.open(nodeConnection(file, { async before(kind, sql) { await replacementBeforeHook?.(kind, sql); }, async after(kind, sql) {
      await replacementHook?.(kind, sql);
      if (rejectCommit && kind === 'run' && sql.startsWith('INSERT INTO wallet_metadata')) metadataWrites++;
      if (rejectCommit && metadataWrites >= 3 && kind === 'exec' && sql === 'COMMIT') { rejectCommit = false; throw Error('lost commit acknowledgement'); }
    } }).connection, digest, INSTALLATION, true, () => wall, () => mono);
    return storage;
  };
  const factory = (credentials: NativePinCredentialPort = port) => createKeyringRuntimeFactory({
    privacyServiceSettings: null, slhExecution: null, readEvmRetirement: null,
    pinCredential: credentials, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: '123456' }, check); if (!result.accepted) throw Error(result.reason); }, ensureCryptoReady: async () => {}, openStorage: open,
    async loadSdk() {
      const sdk = await loadNativeKeyringSdk();
      class ObservedKeyring extends sdk.HostKeyring {
        constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); keyrings.push(this); }
        override withSecretOperation<T>(
          credential: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[0],
          options: Parameters<InstanceType<typeof sdk.HostKeyring>['withSecretOperation']>[1],
          work: (secret: string) => T | Promise<T>
        ): Promise<T> { secretLeases++; return super.withSecretOperation(credential, options, work); }
      }
      return { ...sdk, HostKeyring: ObservedKeyring };
    },
  });
  return { directory, port, factory, open, keyrings, get secretLeases() { return secretLeases; }, get storage() { return storage; }, loseCommit() { rejectCommit = true; metadataWrites = 0; },
    onSql(hook?: SqlHook) { replacementHook = hook; },
    beforeSql(hook?: SqlHook) { replacementBeforeHook = hook; },
    metadata() { const { database } = nodeConnection(file); try { return database.prepare('SELECT key, value FROM wallet_metadata').all() as { key: string; value: string }[]; } finally { database.close(); } },
    advance(ms: number) { wall += ms; mono += ms; }, async cleanup() { await storage?.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); } };
}

test('PIN vault uses a generated SDK secret, survives reopen, and changes PIN without rekeying the wallet', async () => {
  const f = await fixture();
  const staged: string[] = [];
  const credentials: NativePinCredentialPort = { ...f.port, async stage(record, value, check) { staged.push(value.secret); return f.port.stage(record, value, check); } };
  let runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    assert(f.keyrings.every(ring => !ring.isUnlocked()), 'native creation returns with SDK secret buffers cleared');
    assert.equal(staged.length, 1); assert.match(staged[0]!, /^Pali#1:[0-9a-f]{64}$/); assert.notEqual(staged[0], '123456');
    const before = await f.storage.getWalletFingerprint();
    const phrase = await runtime.backup.readPhrase('123456'); assert.equal(phrase.length, 12);
    assert(f.keyrings.every(ring => !ring.isUnlocked()), 'secret reveal clears the SDK lease before returning');
    assert.equal((await runtime.security!.authenticationStatus()).pinConfigured, true);
    await runtime.security!.changePin('123456', '654321', () => {});
    assert.equal(staged[1], staged[0], 'PIN change preserves the random vault secret');
    assert.equal(await f.storage.getWalletFingerprint(), before);
    await runtime.session.lock(); assert.equal((await runtime.session.unlock('123456')).authenticated, false);
    assert.equal((await runtime.session.unlock('654321')).authenticated, true);
    await runtime.storage.close(); runtime = await f.factory(credentials).open() as KeyringRuntime;
    assert.equal((await runtime.session.unlock('654321')).authenticated, true);
    assert.deepEqual(await runtime.backup.readPhrase('654321'), phrase);
    assert(f.keyrings.every(ring => !ring.isUnlocked()));
    assert(f.keyrings.some(ring => ring.hasPublicSession()), 'public session survives without decrypted signing material');
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('PIN attempts commit before OS read, persist cancellation and throttle across reopen', async () => {
  const f = await fixture(); const runtime = await f.factory().open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    const pin = await f.storage.pin.read(); assert.ok(pin);
    const vault = createNativePinVault(f.storage.pin, { ...f.port, async readPublic(record, check) {
      const snapshot = await f.storage.recovery!.readSnapshot();
      assert.equal(JSON.parse(snapshot.metadata.find(row => row.key === 'auth')!.value).failures, 1);
      return f.port.readPublic(record, check);
    } });
    let current = true;
    await assert.rejects(vault.withVerifiedPublicKey('123456', () => { if (!current) throw Error('cancelled'); }, async () => { current = false; return true; }), /cancelled/);
    for (let index = 0; index < 4; index++) assert.equal(await createNativePinVault(f.storage.pin, f.port).authenticate('000000', () => {}), false);
    await runtime.storage.close(); await f.open();
    await assert.rejects(createNativePinVault(f.storage.pin, f.port).authenticate('123456', () => {}), /AUTH_THROTTLED/);
    f.advance(30000);
    assert.equal(await createNativePinVault(f.storage.pin, f.port).authenticate('123456', () => {}), true);
    await f.storage.close();
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('PIN enrollment parser and guarded storage refuse cross-wallet or stale enrollment', async () => {
  const f = await fixture(); const runtime = await f.factory().open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456'); const before = await f.storage.pin.read(); assert.ok(before);
    assert.throws(() => captureNativePinRecord({ ...before, verifier: '00' }), /PIN_UNAVAILABLE/);
    assert.throws(() => captureNativePinRecord({ ...before, extra: true }), /PIN_UNAVAILABLE/);
    assert.throws(() => f.storage.pin.replace(before, { ...before, enrollmentId: '77'.repeat(16), walletBindingId: '77'.repeat(32) }, () => {}), /STORAGE_CHANGED/);
    const snapshot = await f.storage.recovery!.readSnapshot();
    assert.equal(snapshot.metadata.some(row => row.value.includes('123456') || row.value.includes('Pali#1:')), false);
    await runtime.security!.changePin('123456', '654321', () => {});
    await assert.rejects(f.storage.pin.beginAttempt(before, () => {}), /STORAGE_CHANGED/);
    assert.notEqual(encodeStorageValue(await f.storage.pin.read()), encodeStorageValue(before));
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('PIN creation keeps its OS alias through uncertain commit and refuses failed secret staging before commit', async () => {
  const f = await fixture(); let runtime = await f.factory({ ...f.port, async stage() { throw Error('device storage unavailable'); } }).open() as KeyringRuntime;
  try {
    await assert.rejects(runtime.session.createWallet('123456'));
    assert.equal((await f.storage.readState()).presence, 'empty');
    await runtime.storage.close(); runtime = await f.factory().open() as KeyringRuntime; f.loseCommit();
    await assert.rejects(runtime.session.createWallet('123456'));
    await runtime.storage.close().catch(() => {}); runtime = await f.factory().open() as KeyringRuntime;
    assert.equal((await runtime.security!.authenticationStatus()).pinConfigured, true);
    assert.equal((await runtime.session.unlock('123456')).authenticated, true);
    assert.equal((await runtime.backup.readPhrase('123456')).length, 12);
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('native signing consumes one exact authorization and clears SDK secrets before returning bytes', async () => {
  const f = await fixture(), runtime = await f.factory().open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    const from = await runtime.session.readSelectedAddress(), transfers = runtime.transfers!;
    const transaction = { type: 2 as const, accessList: [], from, to: '0x1111111111111111111111111111111111111111', chainId: '1', nonce: '0', value: '1', gasLimit: '21000', data: '0x', maxFeePerGas: '3', maxPriorityFeePerGas: '1' };
    const beforeProof = f.secretLeases;
    const wrongTarget = await transfers.authorizeOperation({ method: 'pin', pin: '123456' }, transaction, () => {});
    assert.equal(f.secretLeases, beforeProof, 'review authorization does not reopen mnemonic or signing keys');
    await assert.rejects(transfers.sign({ ...transaction, value: '2' }, { authorization: wrongTarget, assertCurrent() {}, signal: new AbortController().signal }), /CANCELLED/);
    assert(f.keyrings.every(ring => !ring.isUnlocked()));
    assert.equal((await runtime.session.unlock('123456')).authenticated, true);
    const authorization = await transfers.authorizeOperation({ method: 'pin', pin: '123456' }, transaction, () => {});
    assert(f.keyrings.every(ring => !ring.isUnlocked()));
    const signed = await transfers.sign(transaction, { authorization, assertCurrent() {}, signal: new AbortController().signal });
    assert.match(signed.rawTransaction, /^0x/); assert(f.keyrings.every(ring => !ring.isUnlocked()));
    const afterSigning = f.secretLeases;
    const journal = await transfers.journal(() => {});
    await journal.saveSigned(signed.rawTransaction);
    assert.equal((await journal.load(signed.hash))?.rawTransaction, signed.rawTransaction);
    await journal.transition(signed.hash, 'submitted');
    assert.equal(f.secretLeases, afterSigning, 'durable record writes and public tracking never revive signing keys');
    await assert.rejects(transfers.sign(transaction, { authorization, assertCurrent() {}, signal: new AbortController().signal }), /INVALID_CREDENTIAL/);
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('saved transaction consent verifies PIN without opening an SDK secret lease', async () => {
  const f = await fixture(), runtime = await f.factory().open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    const leases = f.secretLeases, account = await runtime.session.readSelectedAddress();
    await assert.rejects(runtime.security!.authenticateOperation({ method: 'pin', pin: '000000' }, () => {}), /INVALID_CREDENTIAL/);
    assert.equal(await runtime.session.readSelectedAddress(), account);
    await runtime.security!.authenticateOperation({ method: 'pin', pin: '123456' }, () => {});
    assert.equal(f.secretLeases, leases);
    assert(f.keyrings.every(ring => !ring.isUnlocked()));
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

for (const mode of ['cancel-after-write', 'lost-write-ack'] as const) test(`fresh PIN alias is retired on ${mode}`, async () => {
  const f = await fixture(), reached = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
  let current = true, stored: Parameters<NativePinCredentialPort['stage']>[0] | null = null;
  const removed: Parameters<NativePinCredentialPort['remove']>[0][] = [];
  const guard = () => { if (!current) throw Error('CANCELLED'); };
  const credentials: NativePinCredentialPort = {
    async readPublic() { return null; },
    async readSecret() { return null; },
    async stage(record, _value, check) {
      reached.resolve(); await released.promise;
      stored = record;
      if (mode === 'lost-write-ack') throw Error('OS write acknowledgement lost');
      check();
    },
    async remove(record) { assert.strictEqual(record, stored); removed.push(record); stored = null; },
  };
  const storage = await f.open();
  try {
    const pin = createNativePinVault(storage.pin, credentials);
    const pending = pin.stage('123456', { walletBindingId: '1'.repeat(64), pairFingerprint: '2'.repeat(64) }, pin.createSecret(), pin.createPublicKey(), guard);
    await reached.promise;
    if (mode === 'cancel-after-write') current = false;
    released.resolve();
    await assert.rejects(pending);
    assert.equal(stored, null); assert.equal(removed.length, 1);
    assert.equal(await storage.pin.read(), null);
  } finally { released.resolve(); await f.cleanup(); }
});

test('PIN replacement atomically retains the old alias after COMMIT acknowledgement loss and settles before cold open', async () => {
  const f = await fixture(); let staged: NativePinRecord | undefined;
  const credentials: NativePinCredentialPort = { ...f.port, async stage(record, value, check) { staged = record; await f.port.stage(record, value, check); } };
  let runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    const before = (await f.storage.pin.read())!;
    let replacing = false;
    f.onSql((kind, sql) => {
      if (kind === 'run' && sql.startsWith('UPDATE wallet_metadata SET value')) replacing = true;
      if (kind === 'exec' && sql === 'COMMIT' && replacing) { f.onSql(); throw Error('Lost PIN replacement COMMIT acknowledgement'); }
    });
    await assert.rejects(runtime.security!.changePin('123456', '654321', () => {}));
    assert.ok(staged); assert.notEqual(staged.enrollmentId, before.enrollmentId);
    const metadata = f.metadata();
    assert.deepEqual(JSON.parse(metadata.find(row => row.key === 'removed-pin-credential')!.value), before);
    assert.deepEqual(JSON.parse(metadata.find(row => row.key === 'local-pin-v1')!.value), staged);
    assert.ok(await f.port.readPublic(before, () => {})); assert.ok(await f.port.readPublic(staged, () => {}));
    await assert.rejects(f.storage.pin.read(), /STORAGE_REOPEN_REQUIRED/);
    await runtime.storage.close(); runtime = await f.factory(credentials).open() as KeyringRuntime;
    assert.equal(await f.port.readPublic(before, () => {}), null);
    assert.ok(await f.port.readPublic(staged, () => {}), 'uncertain commit retains the now-active alias');
    assert.equal(f.metadata().some(row => row.key === 'removed-pin-credential'), false);
    assert.equal((await runtime.session.unlock('654321')).authenticated, true);
    assert.equal((await runtime.session.unlock('123456')).authenticated, false);
  } finally { f.onSql(); await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

for (const removalFault of ['before', 'after'] as const) test(`obsolete-alias deletion failure ${removalFault} removal remains durable and blocks cold open until retry, preserving backup and biometrics`, async () => {
  const f = await fixture(); let failRemoval = true;
  const credentials: NativePinCredentialPort = { ...f.port, async remove(record) {
    if (failRemoval && removalFault === 'before') throw Error('OS credential delete failed');
    await f.port.remove(record);
    if (failRemoval && removalFault === 'after') throw Error('OS credential delete acknowledgement lost');
  } };
  let runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456');
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    const enrollment = (await f.storage.deviceUnlockEnrollment!.read())!;
    assert.equal(await f.storage.deviceUnlockEnrollment!.compareAndSet(enrollment, 'bb'.repeat(16), () => {}), true);
    const before = (await f.storage.pin.read())!;
    await assert.rejects(runtime.security!.changePin('123456', '654321', () => {}), { code: 'OPERATION_FAILED' });
    const metadata = f.metadata(); assert.equal(metadata.length, 7);
    assert.deepEqual(JSON.parse(metadata.find(row => row.key === 'removed-pin-credential')!.value), before);
    await assert.rejects(f.storage.pin.read(), /STORAGE_REOPEN_REQUIRED/);
    await runtime.storage.close();
    await assert.rejects(f.factory(credentials).open());
    assert.ok(f.metadata().some(row => row.key === 'removed-pin-credential'));
    failRemoval = false; runtime = await f.factory(credentials).open() as KeyringRuntime;
    assert.equal(await f.port.readPublic(before, () => {}), null);
    assert.equal((await f.storage.deviceUnlockEnrollment!.read())!.enrollmentId, 'bb'.repeat(16));
    assert.equal((await f.storage.readState()).backup, 'confirmed');
    assert.equal((await runtime.session.unlock('654321')).authenticated, true);
  } finally { failRemoval = false; await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

for (const afterCommit of [false, true]) test(`PIN replacement cancellation ${afterCommit ? 'after' : 'before'} COMMIT preserves the right alias`, async () => {
  const f = await fixture(); let current = true, staged: NativePinRecord | undefined;
  const credentials: NativePinCredentialPort = { ...f.port, async stage(record, value, check) { staged = record; await f.port.stage(record, value, check); } };
  let runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456'); const before = (await f.storage.pin.read())!;
    let replacing = false;
    f.onSql((kind, sql) => {
      if (kind === 'run' && sql.startsWith('UPDATE wallet_metadata SET value')) {
        replacing = true; if (!afterCommit) current = false;
      }
      if (afterCommit && replacing && kind === 'exec' && sql === 'COMMIT') current = false;
    });
    await assert.rejects(runtime.security!.changePin('123456', '654321', () => { if (!current) throw Error('App backgrounded'); }));
    f.onSql(); assert.ok(staged); current = true;
    assert.equal((await f.storage.pin.read())!.enrollmentId, afterCommit ? staged.enrollmentId : before.enrollmentId);
    assert.equal(await f.port.readPublic(afterCommit ? before : staged, () => {}), null);
    assert.ok(await f.port.readPublic(afterCommit ? staged : before, () => {}));
    assert.equal(f.metadata().some(row => row.key === 'removed-pin-credential'), false);
    await runtime.storage.close(); runtime = await f.factory(credentials).open() as KeyringRuntime;
    assert.equal((await runtime.session.unlock(afterCommit ? '654321' : '123456')).authenticated, true);
  } finally { f.onSql(); await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('wrong PIN and cancellation before replacement leave the original credential unchanged', async () => {
  const f = await fixture(); let stages = 0, removals = 0;
  const credentials: NativePinCredentialPort = { ...f.port,
    async stage(record, value, check) { stages++; await f.port.stage(record, value, check); },
    async remove(record) { removals++; await f.port.remove(record); } };
  const runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456'); const before = (await f.storage.pin.read())!;
    await assert.rejects(runtime.security!.changePin('000000', '654321', () => {}), /INVALID_CREDENTIAL/);
    await assert.rejects(runtime.security!.changePin('123456', '654321', () => { throw Error('App backgrounded'); }));
    assert.deepEqual(await f.storage.pin.read(), before); assert.equal(stages, 1); assert.equal(removals, 0);
    assert.ok(await f.port.readPublic(before, () => {})); assert.equal(f.metadata().some(row => row.key === 'removed-pin-credential'), false);
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

for (const fault of ['rollback-remove-failure', 'commit-not-dispatched'] as const) test(`staged alias remains durably discoverable after ${fault}`, async () => {
  const f = await fixture(); let staged: NativePinRecord | undefined, failRemoval = fault === 'rollback-remove-failure', stageCount = 0;
  const credentials: NativePinCredentialPort = { ...f.port,
    async stage(record, value, check) {
      stageCount++; staged = record;
      if (stageCount > 1) assert.deepEqual(JSON.parse(f.metadata().find(row => row.key === 'removed-pin-credential')!.value), record,
        'cleanup receipt must be durable before protected OS write');
      await f.port.stage(record, value, check);
    },
    async remove(record) { if (failRemoval) throw Error('OS delete failed'); await f.port.remove(record); },
  };
  let runtime = await f.factory(credentials).open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456'); const before = (await f.storage.pin.read())!;
    let replacing = false;
    f.onSql((kind, sql) => {
      if (kind === 'run' && sql.startsWith('UPDATE wallet_metadata SET value')) {
        replacing = true;
        if (fault === 'rollback-remove-failure') { f.onSql(); throw Error('Rollback replacement before COMMIT'); }
      }
    });
    f.beforeSql((kind, sql) => { if (fault === 'commit-not-dispatched' && replacing && kind === 'exec' && sql === 'COMMIT') {
      f.beforeSql(); throw Error('COMMIT was not dispatched');
    } });
    await assert.rejects(runtime.security!.changePin('123456', '654321', () => {}));
    assert.ok(staged); assert.notEqual(staged.enrollmentId, before.enrollmentId);
    const metadata = f.metadata();
    assert.deepEqual(JSON.parse(metadata.find(row => row.key === 'local-pin-v1')!.value), before);
    assert.deepEqual(JSON.parse(metadata.find(row => row.key === 'removed-pin-credential')!.value), staged);
    assert.ok(await f.port.readPublic(staged, () => {}));
    await assert.rejects(f.storage.pin.read(), /STORAGE_REOPEN_REQUIRED/);
    f.onSql(); f.beforeSql(); await runtime.storage.close(); failRemoval = false;
    runtime = await f.factory(credentials).open() as KeyringRuntime;
    assert.equal(await f.port.readPublic(staged, () => {}), null); assert.ok(await f.port.readPublic(before, () => {}));
    assert.equal(f.metadata().some(row => row.key === 'removed-pin-credential'), false);
    assert.equal((await runtime.session.unlock('123456')).authenticated, true);
  } finally { f.onSql(); f.beforeSql(); failRemoval = false; await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});

test('pending PIN replacement admits only its exact prepared transition and blocks ordinary operations', async () => {
  const f = await fixture(); const runtime = await f.factory().open() as KeyringRuntime;
  try {
    await runtime.session.createWallet('123456'); const before = (await f.storage.pin.read())!;
    const next = { ...before, enrollmentId: 'cc'.repeat(16) }, unrelated = { ...before, enrollmentId: 'dd'.repeat(16) };
    await assert.rejects(f.storage.pin.replace(before, next, () => {}), /STORAGE_CHANGED/);
    await f.storage.pin.prepareReplacement(before, next, () => {});
    await assert.rejects(f.storage.pin.read(), /STORAGE_REOPEN_REQUIRED/);
    await assert.rejects(f.storage.pin.prepareReplacement(before, unrelated, () => {}), /STORAGE_REOPEN_REQUIRED/);
    await assert.rejects(f.storage.pin.replace(before, unrelated, () => {}), /STORAGE_CHANGED/);
    assert.deepEqual(JSON.parse(f.metadata().find(row => row.key === 'removed-pin-credential')!.value), next);
    await f.storage.pin.settleCredentialRemoval(async record => { assert.deepEqual(record, next); });
    assert.deepEqual(await f.storage.pin.read(), before);
  } finally { await runtime.storage.close().catch(() => {}); await f.cleanup(); }
});
