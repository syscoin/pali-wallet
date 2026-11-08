import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { KeyringRuntimeError, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../src/custody/seedBackup.ts';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const PASSWORD = 'public test password';
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
  const runtime: KeyringRuntime = {
    catalogue: { getSnapshot: () => null },
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
      async readPhrase(password) {
        assert.ok(unlocked);
        if (password !== PASSWORD) { unlocked = false; throw new KeyringRuntimeError('INVALID_CREDENTIAL'); }
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
  const authority = new NativeCustodyAuthority({ async open() { return runtime; } });
  const flow = new SeedBackupFlow(authority, () => runtime.backup);
  await authority.initialize();
  await authority.unlock(PASSWORD);
  return { authority, flow, runtime, get confirms() { return confirms; },
    replaceWallet() { fingerprint = 'wallet-two'; },
    async close() { flow.dispose(); await authority.dispose(); } };
}

test('fresh authentication and correct challenge confirm only the same durable wallet', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD);
    assert.equal(shown.words.join(' '), PHRASE);
    assert.equal(new Set(shown.positions).size, 3);
    assert.equal(JSON.stringify(f.authority.getSnapshot()).includes(PHRASE), false);
    await assert.rejects(f.flow.confirm(shown.id, ['wrong', 'wrong', 'wrong']), /BACKUP_WORDS_MISMATCH/);
    assert.equal(f.confirms, 0);
    await assert.rejects(f.flow.confirm(shown.id, new Array<string>(3)), /BACKUP_WORDS_MISMATCH/);
    assert.equal(f.confirms, 0);
    await f.flow.confirm(shown.id, shown.positions.map((position) => shown.words[position]!));
    assert.equal(f.confirms, 1);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    await assert.rejects(f.flow.confirm(shown.id, []), /BACKUP_EXPIRED/);
  } finally { await f.close(); }
});

test('rejected authentication revokes public ready state and never returns a phrase', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.flow.begin('wrong'), /^Error: INVALID_CREDENTIAL$/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.authority.getSnapshot().account, null);
    assert.equal(f.confirms, 0);
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
    await assert.rejects(f.flow.confirm(shown.id, shown.positions.map((p) => shown.words[p]!)), /^Error: BACKUP_UNAVAILABLE$/);
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
    const pending = f.flow.confirm(shown.id, shown.positions.map((p) => shown.words[p]!));
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

test('five incorrect challenges require fresh authentication', async () => {
  const f = await fixture();
  try {
    const shown = await f.flow.begin(PASSWORD);
    for (let attempt = 0; attempt < 4; attempt++)
      await assert.rejects(f.flow.confirm(shown.id, []), /BACKUP_WORDS_MISMATCH/);
    await assert.rejects(f.flow.confirm(shown.id, []), /BACKUP_EXPIRED/);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.confirms, 0);
  } finally { await f.close(); }
});
