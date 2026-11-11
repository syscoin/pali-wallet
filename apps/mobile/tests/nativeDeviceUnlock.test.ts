import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { deviceUnlockUserRefusal } from '../../../source/wallet/deviceUnlockEnrollment.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';
import { OperationAuthentication, type OperationAuthenticationPrompt } from '../src/core/operationAuthentication.ts';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = '123456';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

async function fixture(trezorSessions?: KeyringRuntimeDependencies['trezorSessions'], requestCredential?: KeyringRuntimeDependencies['requestOperationCredential'], prompt?: DeviceUnlockPrompt) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-device-unlock-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  const protectedItems = new Map<string, string>();
  const readOwners: (AbortSignal | null)[] = [], writeOwners: (AbortSignal | null)[] = [];
  let initialized = false, nextId = 1;
  let afterRead: () => Promise<void> = async () => undefined;
  let failEnrollmentRead = false;
  let store!: SqliteWalletStorage, runtime!: KeyringRuntime;
  const credentials = createDeviceUnlockCredentialStore({
    async available() { return true; },
    async read(name, owner) {
      readOwners.push(owner);
      const read = async () => { const result = protectedItems.get(name) ?? null; await afterRead(); return result; };
      return prompt ? prompt.run(owner, read) : read();
    },
    async write(name, value, owner) { writeOwners.push(owner); protectedItems.set(name, value); },
    async remove(name) { protectedItems.delete(name); },
  });
  const factory = createKeyringRuntimeFactory({ pinCredential: createTestPinCredentialPort(), requestOperationCredential: requestCredential ?? (async (_request, _signal, check, verify) => {
    const result = await verify({ method: 'pin', pin: PASSWORD }, check);
    if (!result.accepted) throw Error(result.reason);
  }), privacyServiceSettings: null, slhExecution: null,
    ensureCryptoReady: async () => undefined, readEvmRetirement: null,
    trezorSessions,
    async openStorage() {
      store = await SqliteWalletStorage.open(nodeConnection(file, { before(_kind, sql) {
        if (failEnrollmentRead && sql.includes('device-unlock-enrollment')) throw Error('Synthetic enrollment read failure');
      } }).connection, digest, INSTALLATION, !initialized);
      initialized = true;
      return store;
    },
    deviceUnlock: { credentials, randomId: () => (nextId++).toString(16).padStart(32, '0') },
  });
  const open = async () => {
    const owner = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
    await owner.initialize();
    return owner;
  };
  let owner = await open();
  await owner.importPhrase(PHRASE, PASSWORD);
  return {
    get owner() { return owner; }, get runtime() { return runtime; }, get store() { return store; }, protectedItems, readOwners, writeOwners,
    afterRead(operation: () => Promise<void>) { afterRead = operation; },
    failEnrollmentRead() { failEnrollmentRead = true; },
    async reopen() { await owner.dispose(); owner = await open(); },
    async close() { await owner.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('published SDK device unlock survives cold reopen and keeps backup gating and password fallback', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.owner.getDeviceUnlockStatus(), { available: true, enabled: false });
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal((await f.owner.getDeviceUnlockStatus())?.enabled, true);
    assert.equal(f.protectedItems.size, 1);
    for (const value of f.protectedItems.values()) {
      assert.equal(value.includes('"pin"'), false);
      assert.equal(value.includes(PHRASE), false);
    }
    await f.reopen();
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    await f.owner.unlockWithDevice(() => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
    assert.equal(f.owner.getCatalogue()?.accounts.length, 1);
    await f.owner.setDeviceUnlock(false, PASSWORD, () => undefined);
    assert.equal((await f.owner.getDeviceUnlockStatus())?.enabled, false);
    assert.equal(f.protectedItems.size, 0);
    f.owner.lock();
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('a missing or cancelled credential keeps the wallet locked and permits password unlock', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    f.protectedItems.clear();
    f.owner.lock();
    await assert.rejects(f.owner.unlockWithDevice(() => undefined), { code: 'DEVICE_UNLOCK_UNAVAILABLE' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('lock during native credential access discards the result before SDK session publication', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    f.owner.lock();
    let enter!: () => void, finish!: () => void;
    const reached = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    f.afterRead(async () => { enter(); await held; });
    const attempt = f.owner.unlockWithDevice(() => undefined);
    await reached;
    f.owner.lock(); finish();
    await assert.rejects(attempt, { code: 'CANCELLED' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    f.afterRead(async () => undefined);
    await f.owner.unlock(PASSWORD);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('enrollment requires the actual password and retains the original enrollment after refusal', async () => {
  const f = await fixture();
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const original = await f.store.deviceUnlockEnrollment.read();
    await assert.rejects(f.owner.setDeviceUnlock(true, '000000', () => undefined), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.deepEqual(await f.store.deviceUnlockEnrollment.read(), original);
    assert.equal(f.protectedItems.size, 1);
    await f.owner.unlockWithDevice(() => undefined);
    assert.equal(f.owner.getSnapshot().phase, 'backup-required');
  } finally { await f.close(); }
});

test('native device unlock gives a retired Trezor handoff fresh authority before resume', async () => {
  const [{ createTrezorSessions }, { Wallet }] = await Promise.all([
    import('../src/hardware/trezorSessions.ts'), import('ethers/wallet'),
  ]);
  const wallet = new Wallet('0x' + '31'.repeat(32));
  const urls: string[] = [];
  let wake: ((url: string) => void) | undefined;
  let random = 0, sequence = 0, generations = 0;
  const service = createTrezorSessions({
    randomBytes: length => new Uint8Array(length).fill(++random),
    async loadClient() {
      let settings!: Parameters<import('../src/hardware/trezorHost.ts').NativeTrezorClient['init']>[0];
      let release!: (value: unknown) => void;
      const pending = new Promise<unknown>(resolve => { release = resolve; });
      return {
        async init(value) { settings = value; },
        call({ method, ...params }) {
          const callback = new URL(settings.deeplinkCallbackUrl); callback.searchParams.set('id', `biometric-${++sequence}`);
          const url = new URL(settings.connectSrc + 'deeplink/1/');
          url.searchParams.set('method', String(method)); url.searchParams.set('params', JSON.stringify(params));
          url.searchParams.set('callback', callback.toString()); url.searchParams.set('appName', settings.manifest.appName);
          settings.deeplinkOpen(url.toString()); return pending;
        },
        cancel() { release(undefined); }, async dispose() {},
      };
    },
    async openURL(url) {
      if (wake) { const resolve = wake; wake = undefined; resolve(url); } else urls.push(url);
    },
  });
  const sessions = { ...service, advanceSessionGeneration() { generations++; return service.advanceSessionGeneration(); } };
  const nextURL = () => urls.length ? Promise.resolve(urls.shift()!) : new Promise<string>(resolve => { wake = resolve; });
  const respond = (url: string, payload: unknown) => {
    const callback = new URL(new URL(url).searchParams.get('callback')!);
    callback.searchParams.set('response', JSON.stringify({ success: true, payload }));
    assert.equal(service.receiveCallback(callback.toString()), true);
  };
  const f = await fixture(sessions);
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint()); await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const before = generations;
    const pending = f.runtime.trezor.startImport('Device unlock Trezor');
    void pending.catch(() => undefined);
    const addressURL = await nextURL();
    f.owner.lock();
    respond(addressURL, { address: wallet.address });
    await assert.rejects(pending, /CANCELLED|no longer current/);
    await f.owner.unlockWithDevice(() => undefined);
    assert.equal(generations, before + 1);
    assert.equal(f.runtime.trezor.getSnapshot().phase, 'resume');
    const resumed = f.runtime.trezor.resumeImport();
    const publicKeyURL = await nextURL();
    assert.equal(new URL(publicKeyURL).searchParams.get('method'), 'ethereumGetPublicKey');
    respond(publicKeyURL, { publicKey: wallet.signingKey.publicKey.slice(2) });
    await resumed;
    await f.owner.manageAccounts({ kind: 'import-trezor', label: 'Device unlock Trezor' }, f.owner.getSnapshot().revision, f.owner.getCatalogue()!.revision);
    assert.equal(f.owner.getCatalogue()!.accounts.find(account => account.type === 'Trezor')?.address, wallet.address);
  } finally { await f.close(); await service.dispose(); }
});

test('operation authentication reuses device enrollment without changing the live account', async () => {
  const f = await fixture();
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint());
    await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const before = f.owner.getSnapshot(), catalogue = f.owner.getCatalogue();
    const auth = f.runtime.security!.authenticateOperation;
    await auth({ method: 'biometric' }, () => { assert.equal(f.owner.getSnapshot(), before); });
    assert.equal((await f.runtime.backup.readPhrase({ method: 'biometric' })).join(' '), PHRASE);
    assert.equal(f.owner.getSnapshot(), before);
    assert.equal(f.owner.getCatalogue(), catalogue);
    f.afterRead(async () => { throw deviceUnlockUserRefusal(); });
    await assert.rejects(auth({ method: 'biometric' }, () => undefined), /DEVICE_UNLOCK_UNAVAILABLE/);
    assert.equal(f.owner.getSnapshot(), before);
    f.afterRead(async () => undefined);
    await assert.rejects(auth({ method: 'pin', pin: '000000' }, () => undefined), /INVALID_CREDENTIAL/);
    assert.equal(f.owner.getSnapshot(), before);
    await auth({ method: 'pin', pin: PASSWORD }, () => undefined);
    assert.equal(f.owner.getSnapshot(), before);
    assert.equal(f.owner.getCatalogue(), catalogue);
  } finally { await f.close(); }
});

test('actual SDK key export forwards its exact broker acquisition to protected storage', async () => {
  const prompt = new DeviceUnlockPrompt({ state: () => 'active', subscribe: () => () => {} });
  const broker = new OperationAuthentication();
  let shown: OperationAuthenticationPrompt | null = null, brokerOwner: AbortSignal | undefined;
  const detach = broker.attach(value => { shown = value; });
  const f = await fixture(undefined, (request, signal, check, verify) => {
    brokerOwner = signal; return broker.request(request, signal, check, verify);
  }, prompt);
  const authentication = createNativePrivateAuthenticationScope();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint());
    await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    assert.deepEqual(f.writeOwners, [null]); assert.deepEqual(f.readOwners, [null]);
    const before = f.owner.getSnapshot(), catalogue = f.owner.getCatalogue()!;
    const account = catalogue.accounts.find(value => value.id === catalogue.active.accountId)!;
    const network = catalogue.networks.find(value => value.id === catalogue.active.networkId)!;
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent() { assert.equal(f.owner.getSnapshot(), before); },
      isPromptActive: owner => prompt.isActive(owner) });
    f.afterRead(async () => { entered.resolve(); await release.promise; });
    const exporting = f.runtime.keyExport!.readSelected({ authorityRevision: before.revision, catalogueRevision: catalogue.revision,
      accountId: account.id, index: account.index, address: account.address, networkId: network.id, registrationHash: network.registrationHash },
    new AbortController().signal, () => undefined, binding);
    await new Promise(resolve => setImmediate(resolve));
    const activePrompt = shown as OperationAuthenticationPrompt | null; assert(activePrompt);
    activePrompt.confirm({ method: 'biometric' }); await entered.promise;
    assert(brokerOwner); assert.equal(f.readOwners.at(-1), brokerOwner);
    assert.equal(prompt.isActive(brokerOwner), true); assert.equal(authentication.isAuthenticating(), true);
    release.resolve(); assert.match(await exporting, /^0x[0-9a-f]{64}$/i);
    assert.equal(authentication.isAuthenticating(), false); assert.equal(f.owner.getSnapshot(), before);
  } finally { release.resolve(); broker.cancel(); detach(); authentication.retire(); await f.close(); }
});

for (const failure of ['missing', 'corrupt', 'changed', 'read'] as const) test(`phrase flow reflects retired SDK authority after ${failure} biometric enrollment`, async () => {
  const f = await fixture(), flow = new SeedBackupFlow(f.owner, () => f.runtime.backup);
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint()); await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const reference = await f.store.deviceUnlockEnrollment.read(); assert(reference);
    if (failure === 'missing') f.protectedItems.clear();
    if (failure === 'corrupt') for (const key of f.protectedItems.keys()) f.protectedItems.set(key, 'corrupt');
    if (failure === 'changed') f.afterRead(async () => {
      assert.equal(await f.store.deviceUnlockEnrollment.compareAndSet(reference, 'ef'.repeat(16), () => undefined), true);
    });
    if (failure === 'read') f.afterRead(async () => { f.failEnrollmentRead(); });
    await assert.rejects(flow.begin({ method: 'biometric' }), /BACKUP_UNAVAILABLE/);
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    assert.equal(f.owner.getCatalogue(), null);
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
  } finally { flow.dispose(); await f.close(); }
});

test('phrase flow preserves only a genuine biometric refusal and then accepts a fresh PIN', async () => {
  const f = await fixture(), flow = new SeedBackupFlow(f.owner, () => f.runtime.backup);
  try {
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const before = f.owner.getSnapshot();
    f.afterRead(async () => { throw deviceUnlockUserRefusal(); });
    await assert.rejects(flow.begin({ method: 'biometric' }), /DEVICE_UNLOCK_UNAVAILABLE/);
    assert.equal(f.owner.getSnapshot(), before);
    f.afterRead(async () => undefined);
    assert.equal((await flow.begin(PASSWORD)).words.join(' '), PHRASE);
  } finally { flow.dispose(); await f.close(); }
});

for (const failure of ['read', 'changed', 'missing', 'forged'] as const) test(`operation biometric ${failure} failure retires the public session instead of becoming a retryable refusal`, async () => {
  const f = await fixture();
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint()); await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const original = await f.store.deviceUnlockEnrollment.read(); assert(original);
    if (failure === 'read') f.afterRead(async () => { f.failEnrollmentRead(); });
    if (failure === 'changed') f.afterRead(async () => {
      assert.equal(await f.store.deviceUnlockEnrollment.compareAndSet(original, 'ef'.repeat(16), () => undefined), true);
    });
    if (failure === 'missing') f.protectedItems.clear();
    if (failure === 'forged') f.afterRead(async () => { throw Error('DEVICE_UNLOCK_UNAVAILABLE'); });
    await assert.rejects(f.runtime.security!.authenticateOperation({ method: 'biometric' }, () => undefined));
    assert.equal(f.runtime.catalogue.getSnapshot(), null);
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await f.close(); }
});

test('lock during operation biometrics cannot restore or authorize the retired session', async () => {
  const f = await fixture();
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint());
    await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    let entered!: () => void, finish!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    f.afterRead(async () => { entered(); await held; });
    const pending = f.runtime.security!.authenticateOperation({ method: 'biometric' }, () => {
      if (f.owner.getSnapshot().phase !== 'ready') throw Error('CANCELLED');
    });
    const refused = assert.rejects(pending, /CANCELLED/);
    await started;
    f.owner.lock(); finish(); await refused;
    assert.equal(f.owner.getSnapshot().phase, 'locked');
    await assert.rejects(f.runtime.session.readSelectedAddress(), /NOT_READY/);
  } finally { await f.close(); }
});

test('operation lockout refuses biometrics before protected key access without stale review state', async () => {
  const f = await fixture();
  try {
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint());
    await f.owner.refreshAuthenticatedMetadata();
    await f.owner.setDeviceUnlock(true, PASSWORD, () => undefined);
    const before = f.owner.getSnapshot(), catalogue = f.owner.getCatalogue();
    let reads = 0;
    f.afterRead(async () => { reads++; });
    for (let attempt = 0; attempt < 5; attempt++) await f.store.authGuard.recordFailure();
    await assert.rejects(f.runtime.security!.authenticateOperation({ method: 'biometric' }, () => undefined), /AUTH_THROTTLED/);
    assert.equal(reads, 0);
    assert.equal(f.owner.getSnapshot(), before);
    assert.equal(f.owner.getCatalogue(), catalogue);
  } finally { await f.close(); }
});
