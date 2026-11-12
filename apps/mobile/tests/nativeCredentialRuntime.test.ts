import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime, type KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import { operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { bindNativePrivateAuthentication, createNativePrivateAuthenticationScope } from '../src/custody/privateAuthentication.ts';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
const sdk = await loadNativeKeyringSdk();
async function fixture(trezorSessions?: KeyringRuntimeDependencies['trezorSessions']) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-os-credential-test-'));
  const file = path.join(directory, 'wallet.sqlite'), credentials = createTestCredentialPort();
  const prompt = new DeviceUnlockPrompt({ state: () => 'active', subscribe: () => () => {} });
  const rings: InstanceType<typeof sdk.HostKeyring>[] = [];
  const readOwners: AbortSignal[] = [];
  let initialized = false, store!: SqliteWalletStorage, runtime!: KeyringRuntime;
  class ObservedKeyring extends sdk.HostKeyring { constructor(...args: ConstructorParameters<typeof sdk.HostKeyring>) { super(...args); rings.push(this); } }
  const factory = createKeyringRuntimeFactory({
    credentialPort: { ...credentials, withSecret(reference, owner, consume) { readOwners.push(owner.signal); return prompt.run(owner.signal, () => credentials.withSecret(reference, owner, consume)); } },
    isAuthenticationActive: owner => prompt.isActive(owner), privacyServiceSettings: null, passkeys: null, slhExecution: null,
    readEvmRetirement: null, ensureCryptoReady: async () => {}, loadSdk: async () => ({ ...sdk, HostKeyring: ObservedKeyring }), trezorSessions,
    async openStorage() { store = await SqliteWalletStorage.open(nodeConnection(file).connection, digest, INSTALLATION, !initialized); initialized = true; return store; },
  });
  const open = async () => {
    const authority = new NativeCustodyAuthority({ async open() { runtime = await factory.open() as KeyringRuntime; return runtime; } });
    await authority.initialize(); return authority;
  };
  let authority = await open(); await authority.importPhrase(PHRASE);
  return {
    get authority() { return authority; }, get runtime() { return runtime; }, get store() { return store; }, credentials, rings, prompt, readOwners,
    async ready() { await runtime.backup.confirm(await runtime.backup.fingerprint()); await authority.refreshAuthenticatedMetadata(); },
    async reopen() { await authority.dispose(); authority = await open(); await authority.unlock(); },
    async close() { await authority.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('cold public entry uses only the checkpoint key and leaves every SDK signing root closed', async () => {
  const f = await fixture();
  try {
    const reads = f.credentials.secretReads;
    assert(f.rings.every(ring => !ring.isUnlocked()));
    await f.reopen();
    assert.equal(f.credentials.secretReads, reads);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert(f.authority.getCatalogue()?.accounts.length);
    assert(f.rings.every(ring => !ring.isUnlocked()));
    assert.equal((await f.runtime.backup.readPhrase({ method: 'device' })).join(' '), PHRASE);
    assert.equal(f.credentials.secretReads, reads + 1);
    assert(f.rings.every(ring => !ring.isUnlocked()));
  } finally { await f.close(); }
});

test('actual SDK key export forwards the exact live protected-read owner and closes its secret lease', async () => {
  const f = await fixture(), authentication = createNativePrivateAuthenticationScope();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await f.ready();
    const before = f.authority.getSnapshot(), catalogue = f.authority.getCatalogue()!;
    const account = catalogue.accounts.find(value => value.id === catalogue.active.accountId)!;
    const network = catalogue.networks.find(value => value.id === catalogue.active.networkId)!;
    const binding = bindNativePrivateAuthentication(authentication, { assertCurrent() { assert.equal(f.authority.getSnapshot(), before); }, isPromptActive: owner => f.prompt.isActive(owner) });
    f.credentials.beforeRead(async () => { entered.resolve(); await release.promise; });
    const exporting = f.runtime.keyExport!.readSelected({ authorityRevision: before.revision, catalogueRevision: catalogue.revision,
      accountId: account.id, index: account.index, address: account.address, networkId: network.id, registrationHash: network.registrationHash },
    new AbortController().signal, () => undefined, binding);
    await entered.promise;
    const owner = f.readOwners.at(-1); assert(owner);
    assert.equal(f.prompt.isActive(owner), true); assert.equal(authentication.isAuthenticating(), true);
    release.resolve(); assert.match(await exporting, /^0x[0-9a-f]{64}$/i);
    assert.equal(authentication.isAuthenticating(), false); assert.equal(f.authority.getSnapshot(), before);
    assert(f.rings.every(ring => !ring.isUnlocked()));
  } finally { release.resolve(); authentication.retire(); await f.close(); }
});

test('genuine OS refusal retains public entry and a new explicit request can retry', async () => {
  const f = await fixture();
  try {
    const before = f.authority.getSnapshot();
    f.credentials.refuseNext(operationAuthenticationCancellation());
    await assert.rejects(f.runtime.backup.readPhrase({ method: 'device' }), error => f.runtime.backup.isAuthenticationRefusal!(error));
    assert.equal(f.authority.getSnapshot(), before); assert(f.rings.every(ring => !ring.isUnlocked()));
    assert.equal((await f.runtime.backup.readPhrase({ method: 'device' })).join(' '), PHRASE);
    assert(f.rings.every(ring => !ring.isUnlocked()));
  } finally { await f.close(); }
});

for (const code of ['CREDENTIAL_MISSING', 'CREDENTIAL_UNSUPPORTED'] as const) test(`protected ${code} never decrypts an SDK root and changes availability`, async () => {
  const f = await fixture();
  try {
    f.credentials.refuseNext(Object.assign(Error(code), { code }));
    await assert.rejects(f.runtime.backup.readPhrase({ method: 'device' }));
    assert(f.rings.every(ring => !ring.isUnlocked()));
    const status = await f.runtime.security!.authenticationStatus();
    if (code === 'CREDENTIAL_MISSING') assert.equal(status.credentialPresent, false);
    else assert.equal(status.deviceAuth, 'unsupported');
  } finally { await f.close(); }
});

test('locking while the OS read is outstanding cannot revive the public or secret session', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    f.credentials.beforeRead(async () => { entered.resolve(); await release.promise; });
    const read = f.runtime.backup.readPhrase({ method: 'device' }); const rejected = assert.rejects(read);
    await entered.promise; f.authority.lock(); release.resolve(); await rejected;
    assert.equal(f.authority.getSnapshot().phase, 'locked'); assert(f.rings.every(ring => !ring.isUnlocked()));
    await assert.rejects(f.runtime.session.readSelectedAddress());
  } finally { release.resolve(); await f.close(); }
});

test('public reentry gives a retired Trezor handoff fresh authority before resume', async () => {
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
    await f.runtime.backup.confirm(await f.runtime.backup.fingerprint()); await f.authority.refreshAuthenticatedMetadata();
    const before = generations;
    const pending = f.runtime.trezor.startImport('Device unlock Trezor');
    void pending.catch(() => undefined);
    const addressURL = await nextURL();
    f.authority.lock();
    respond(addressURL, { address: wallet.address });
    await assert.rejects(pending, /CANCELLED|no longer current/);
    await f.authority.unlock();
    assert.equal(generations, before + 1);
    assert.equal(f.runtime.trezor.getSnapshot().phase, 'resume');
    const resumed = f.runtime.trezor.resumeImport();
    const publicKeyURL = await nextURL();
    assert.equal(new URL(publicKeyURL).searchParams.get('method'), 'ethereumGetPublicKey');
    respond(publicKeyURL, { publicKey: wallet.signingKey.publicKey.slice(2) });
    await resumed;
    await f.authority.manageAccounts({ kind: 'import-trezor', label: 'Device unlock Trezor' }, f.authority.getSnapshot().revision, f.authority.getCatalogue()!.revision);
    assert.equal(f.authority.getCatalogue()!.accounts.find(account => account.type === 'Trezor')?.address, wallet.address);
  } finally { await f.close(); await service.dispose(); }
});
