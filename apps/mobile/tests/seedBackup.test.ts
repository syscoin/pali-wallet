import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { KeyringRuntimeError, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';
import { IdleLock } from '../src/core/idleLock.ts';
import { SecurityPreferences } from '../src/core/securityPreferences.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const PASSWORD = '123456';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture() {
  let unlocked = false;
  let confirmed = false;
  let fingerprint = 'wallet-one';
  let confirms = 0;
  const refusals = new WeakSet<object>();
  const refuse = (code: KeyringRuntimeError['code']) => { const error = new KeyringRuntimeError(code); refusals.add(error); return error; };
  const runtime: KeyringRuntime = {
    async resumeSmartAccountOperation() { throw Error('Smart resume is outside this fixture'); },
    trezor: { background() {}, getSnapshot: () => ({ phase: 'idle', operation: null, networkLabel: '', accountLabel: '', address: null, signer: null, error: null }),
      subscribe: () => () => {}, async startImport() { throw new Error('Hardware is outside this fixture'); },
      async resumeImport() { throw new Error('Hardware is outside this fixture'); },
      async resumeSend() { throw new Error('Hardware is outside this fixture'); }, async cancel() {} },
    ledger: { getConnectionTargets: () => [], subscribeStatus: () => () => {}, isConnected: () => false, async scan() { throw new Error('Hardware is outside this fixture'); } },
    catalogue: { getSnapshot: () => null, getControlSnapshot: () => null, previewNetworkSelection() { throw Error('Network selection is outside this fixture'); } },
    async readConnectionUtxoPublic() { throw Error('UTXO is outside this fixture'); },
    async openSlhDsaAccount() { throw new Error('SLH is outside this fixture'); },
    async openSmartAccountSend() { throw new Error('not used'); },
    openSmartAccountDeployment() { throw new Error('Unused test capability'); },
    async openWalletAuthenticator() { throw new Error('Authenticator is outside this fixture'); },
    canUseWalletAuthenticator: () => false,
    async readSmartAccountModules() { throw Error('Modules are outside this fixture'); },
    async preflightSmartAccountModule() { throw Error('Modules are outside this fixture'); },
    async openSmartAccountModuleChange() { throw Error('Modules are outside this fixture'); },
    canSignSmartAccount: () => false, canManageSlhDsa: () => false,
    async openSlhDsaInstallation() { throw Error('SLH is outside this fixture'); },
    async refreshSmartAccountMetadata() { throw new Error('Metadata is outside this fixture'); },
    getGuardianRecoveryIntent: () => null,
    async openSmartInfrastructure() { throw new Error('Infrastructure is outside this fixture'); },
    async openGuardianRecovery() { throw new Error('Recovery is outside this fixture'); },
    async openGuardianPolicy() { throw new Error('Policy is outside this fixture'); },
    canManageGuardianPolicy: () => false,
    async inspectGuardianRemoval() { throw new Error('Removal is outside this fixture'); },
    async openConnectionHost() { throw new Error('Connections are outside this fixture'); },
    async openConnectionSentryApprovals() { throw new Error('Sentry is outside this fixture'); },
    async prepareConnectionPsbt() { throw new Error('PSBT requests are outside this fixture'); },
    async resetActivity() { throw new Error('Activity is outside this fixture'); },
    async withUtxoActivityRead() { throw new Error('Activity is outside this fixture'); },
    session: {
      async createWallet() { throw new Error('fixture only opens existing wallets'); },
      async importWallet() { throw new Error('fixture only opens existing wallets'); },
      async unlock() { unlocked = true; return { authenticated: true }; },
      async readSelectedAddress() { assert.ok(unlocked); return ADDRESS; },
      async lock() { unlocked = false; },
    },
    storage: {
      async readState() { return { presence: 'existing', backup: confirmed ? 'confirmed' : 'unconfirmed' }; },
      async close() {},
    },
    backup: {
      isAuthenticationRefusal: error => !!error && typeof error === 'object' && refusals.has(error),
      async readPhrase(password) {
        assert.ok(unlocked);
        if (password !== PASSWORD) throw refuse('INVALID_CREDENTIAL');
        return PHRASE.split(' ');
      },
      async fingerprint() { return fingerprint; },
      async confirm(expected) {
        assert.ok(unlocked);
        if (expected !== fingerprint) throw new Error('wallet replaced');
        confirmed = true;
        confirms++;
      },
    },
  };
  let now = 0;
  const idle = new IdleLock(() => ({ monotonic: now, wall: now }), (() => 0) as unknown as typeof setTimeout, (() => undefined) as typeof clearTimeout);
  const preferences = new SecurityPreferences({ async get() { return null; }, async set() {} });
  const authority = new NativeCustodyAuthority({ async open() { return runtime; } }, {
    preferences, assertActive() { if (!idle.check()) throw Error('EXPIRED'); },
  });
  idle.begin(authority, () => authority.lock());
  const flow = new SeedBackupFlow(authority, () => runtime.backup);
  await authority.initialize();
  await authority.unlock(PASSWORD);
  return { authority, flow, runtime, refuse, get confirms() { return confirms; },
    replaceWallet() { fingerprint = 'wallet-two'; },
    expire() { now += 300_000; },
    async close() { idle.stop(); flow.dispose(); await authority.dispose(); } };
}

test('fresh phrase presentation waits for an explicit one-use confirmation of the same durable wallet', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD);
    assert.equal(shown.words.join(' '), PHRASE);
    assert.deepEqual(Object.keys(shown).sort(), ['id', 'words']);
    assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(PHRASE), false);
    assert.equal(f.confirms, 0);
    assert.equal(f.authority.getSnapshot().backup, 'unconfirmed');
    await assert.rejects(f.flow.confirm('wrong-presentation', PHRASE.split(' ')), /BACKUP_EXPIRED/);
    assert.equal(f.confirms, 0);
    await f.flow.confirm(shown.id, PHRASE.split(' '));
    assert.equal(f.confirms, 1);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getSnapshot().backup, 'confirmed');
    await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /BACKUP_EXPIRED/);
  } finally { await f.close(); }
});

test('wrong order, missing slots and getter-backed words cannot verify a backup', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD);
    await assert.rejects(f.flow.confirm(shown.id, [...shown.words].reverse()), /BACKUP_WORDS_MISMATCH/);
    await assert.rejects(f.flow.confirm(shown.id, shown.words.slice(1)), /BACKUP_WORDS_MISMATCH/);
    const accessor = [...shown.words]; let read = false;
    Object.defineProperty(accessor, '0', { get() { read = true; return shown.words[0]; } });
    await assert.rejects(f.flow.confirm(shown.id, accessor), /BACKUP_WORDS_MISMATCH/);
    assert.equal(read, false); assert.equal(f.confirms, 0);
    await f.flow.confirm(shown.id, shown.words); assert.equal(f.confirms, 1);
  } finally { await f.close(); }
});

test('repeated wrong answers expire the presentation and require fresh authentication', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD);
    for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(f.flow.confirm(shown.id, []), /BACKUP_WORDS_MISMATCH/);
    await assert.rejects(f.flow.confirm(shown.id, []), /BACKUP_EXPIRED/);
    await assert.rejects(f.flow.confirm(shown.id, shown.words), /BACKUP_EXPIRED/);
    assert.equal(f.confirms, 0); assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally { await f.close(); }
});

test('ordinary rejected authentication preserves public state and never returns a phrase', async () => {
  const f = await fixture();
  try {
    const before = f.authority.getSnapshot();
    for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED', 'DEVICE_UNLOCK_UNAVAILABLE'] as const) {
      f.runtime.backup.readPhrase = async () => { throw f.refuse(code); };
      await assert.rejects(f.flow.begin('000000'), new RegExp(`^Error: ${code}$`));
      assert.equal(f.authority.getSnapshot(), before);
    }
    assert.equal(f.confirms, 0);
    f.runtime.backup.readPhrase = async () => { throw new Error('unknown storage outcome'); };
    await assert.rejects(f.flow.begin(PASSWORD), /BACKUP_UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally { await f.close(); }
});

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED', 'DEVICE_UNLOCK_UNAVAILABLE'] as const)
  test(`an unverified ${code} error cannot preserve phrase authority`, async () => {
    const f = await fixture();
    try {
      f.runtime.backup.readPhrase = async () => { throw new KeyringRuntimeError(code); };
      await assert.rejects(f.flow.begin(PASSWORD), /BACKUP_UNAVAILABLE/);
      assert.equal(f.authority.getSnapshot().phase, 'locked');
      assert.equal(f.confirms, 0);
    } finally { await f.close(); }
  });

test('a late obsolete phrase failure cannot lock a newly unlocked session', async () => {
  const f = await fixture(), entered = deferred(), held = Promise.withResolvers<readonly string[]>();
  f.runtime.backup.readPhrase = () => { entered.resolve(); return held.promise; };
  try {
    const pending = f.flow.begin(PASSWORD); void pending.catch(() => undefined); await entered.promise;
    f.authority.lock(); await f.authority.unlock(PASSWORD);
    const replacement = f.authority.getSnapshot();
    held.reject(new KeyringRuntimeError('DEVICE_UNLOCK_UNAVAILABLE'));
    await assert.rejects(pending, /BACKUP_UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot(), replacement);
  } finally { await f.close(); }
});

test('lock while authentication is pending discards late secret results', async () => {
  const f = await fixture();
  const started = deferred(); const release = deferred();
  f.runtime.backup.readPhrase = async () => { started.resolve(); await release.promise; return PHRASE.split(' '); };
  try {
    const pending = f.flow.begin(PASSWORD);
    await started.promise;
    f.authority.lock(); release.resolve();
    await assert.rejects(pending, /CANCELLED/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.confirms, 0);
  } finally { await f.close(); }
});

test('wallet replacement cannot receive a stale backup receipt', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD); f.replaceWallet();
    await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /^Error: BACKUP_UNAVAILABLE$/);
    assert.equal(f.confirms, 0);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally { await f.close(); }
});

test('late persistence after lock cannot reopen the wallet', async () => {
  const f = await fixture();
  const started = deferred(); const release = deferred();
  const original = f.runtime.backup.confirm;
  f.runtime.backup.confirm = async (fingerprint) => { await original(fingerprint); started.resolve(); await release.promise; };
  try {
    const shown = await f.flow.begin(PASSWORD);
    const pending = f.flow.confirm(shown.id, PHRASE.split(' '));
    await started.promise; f.authority.lock(); release.resolve();
    await assert.rejects(pending, /^Error: BACKUP_UNAVAILABLE$/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.authority.getSnapshot().account, null);
  } finally { await f.close(); }
});

test('clear observers cannot start concurrent authentication or revive disposed flows', async () => {
  const f = await fixture();
  const attempts: Promise<unknown>[] = [];
  const unsubscribe = f.flow.onClear(() => { attempts.push(f.flow.begin(PASSWORD).catch((error) => error.message)); });
  try {
    await f.flow.begin(PASSWORD);
    assert.deepEqual(await Promise.all(attempts), ['BUSY']);
    unsubscribe(); f.flow.dispose();
    await assert.rejects(f.flow.begin(PASSWORD), /BACKUP_EXPIRED/);
  } finally { unsubscribe(); await f.close(); }
});

test('cancelled or superseded presentation IDs cannot confirm a new presentation', async () => {
  const f = await fixture();
  try {
    const first = await f.flow.begin(PASSWORD);
    f.flow.cancel();
    await assert.rejects(f.flow.confirm(first.id, PHRASE.split(' ')), /BACKUP_EXPIRED/);
    const second = await f.flow.begin(PASSWORD);
    assert.notEqual(first.id, second.id);
    await assert.rejects(f.flow.confirm(first.id, PHRASE.split(' ')), /BACKUP_EXPIRED/);
    assert.equal(f.confirms, 0);
    await f.flow.confirm(second.id, PHRASE.split(' '));
    assert.equal(f.confirms, 1);
  } finally { await f.close(); }
});

for (const interruption of ['lock', 'expiry', 'dispose'] as const) {
  test(`${interruption} refuses a captured confirmation before persistence`, async () => {
    const f = await fixture();
    try {
      const shown = await f.flow.begin(PASSWORD);
      if (interruption === 'lock') f.authority.lock();
      if (interruption === 'expiry') f.expire(); // No timer callback fires: the authority guard checks the deadline.
      if (interruption === 'dispose') f.flow.dispose();
      await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /BACKUP_EXPIRED/);
      assert.equal(f.confirms, 0);
      assert.equal(f.authority.getSnapshot().backup, 'unconfirmed');
      if (interruption !== 'dispose') assert.equal(f.authority.getSnapshot().phase, 'locked');
    } finally { await f.close(); }
  });
}

test('failed durable confirmation locks and consumes the presentation without marking backup complete', async () => {
  const f = await fixture();
  f.runtime.backup.confirm = async () => { throw Error('storage refused confirmation'); };
  try {
    const shown = await f.flow.begin(PASSWORD);
    await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /BACKUP_UNAVAILABLE/);
    assert.equal(f.authority.getSnapshot().backup, 'unconfirmed');
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /BACKUP_EXPIRED/);
    assert.equal(f.confirms, 0);
  } finally { await f.close(); }
});

test('pending confirmation is single-flight and completion observers cannot start a new phrase read', async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  const original = f.runtime.backup.confirm;
  f.runtime.backup.confirm = async (fingerprint) => { started.resolve(); await release.promise; await original(fingerprint); };
  const attempts: Promise<unknown>[] = [];
  try {
    const shown = await f.flow.begin(PASSWORD);
    const off = f.flow.onClear(() => { attempts.push(f.flow.begin(PASSWORD).catch(error => error.message)); });
    const pending = f.flow.confirm(shown.id, PHRASE.split(' '));
    await started.promise;
    await assert.rejects(f.flow.confirm(shown.id, PHRASE.split(' ')), /BUSY/);
    release.resolve(); await pending; off();
    assert.deepEqual(await Promise.all(attempts), ['BUSY']);
    assert.equal(f.confirms, 1);
  } finally { release.resolve(); await f.close(); }
});
