import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { createDeviceUnlockCredentialStore } from '../src/storage/deviceUnlockCredential.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Public device unlock fixture 1!';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;

async function fixture(trezorSessions?: KeyringRuntimeDependencies['trezorSessions']) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-device-unlock-test-'));
  const file = path.join(directory, 'wallet.sqlite');
  const protectedItems = new Map<string, string>();
  let initialized = false, nextId = 1;
  let afterRead: () => Promise<void> = async () => undefined;
  let store!: SqliteWalletStorage, runtime!: KeyringRuntime;
  const credentials = createDeviceUnlockCredentialStore({
    async available() { return true; },
    async read(name) { const result = protectedItems.get(name) ?? null; await afterRead(); return result; },
    async write(name, value) { protectedItems.set(name, value); },
    async remove(name) { protectedItems.delete(name); },
  });
  const factory = createKeyringRuntimeFactory({ privacyServiceSettings: null, slhExecution: null,
    ensureCryptoReady: async () => undefined, readEvmRetirement: null,
    trezorSessions,
    async openStorage() {
      store = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized);
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
    get owner() { return owner; }, get runtime() { return runtime; }, get store() { return store; }, protectedItems,
    afterRead(operation: () => Promise<void>) { afterRead = operation; },
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
      assert.equal(value.includes(PASSWORD), false);
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
    await assert.rejects(f.owner.setDeviceUnlock(true, 'Incorrect password 1!', () => undefined), { code: 'INVALID_CREDENTIAL' });
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
    assert.equal(f.owner.getSnapshot(), before);
    assert.equal(f.owner.getCatalogue(), catalogue);
    f.afterRead(async () => { throw Error('cancelled OS prompt'); });
    await assert.rejects(auth({ method: 'biometric' }, () => undefined), /DEVICE_UNLOCK_UNAVAILABLE/);
    assert.equal(f.owner.getSnapshot(), before);
    f.afterRead(async () => undefined);
    await assert.rejects(auth({ method: 'password', password: 'Wrong public password 1!' }, () => undefined), /INVALID_CREDENTIAL/);
    assert.equal(f.owner.getSnapshot(), before);
    await auth({ method: 'password', password: PASSWORD }, () => undefined);
    assert.equal(f.owner.getSnapshot(), before);
    assert.equal(f.owner.getCatalogue(), catalogue);
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
