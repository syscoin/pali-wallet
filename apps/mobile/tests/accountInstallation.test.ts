import { storageOnlyPublicSession } from './fixtures/publicSessionRecord.ts';
import { PUBLIC_SESSION_RECORD_KEY, PUBLIC_SESSION_RECORD_LIMITS } from '../src/storage/publicSessionRecordKey.ts';
import { createTestCredentialReference } from './fixtures/credentialReference.ts';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encodeStorageValue } from '../src/storage/json.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { ACCOUNT_RECORD_KEY, ACCOUNT_RECORD_LIMITS, encodeAccountRecord } from '../src/storage/accountRecordKey.ts';
import { sameRecoverySnapshot } from '../src/storage/recoverySnapshot.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
  type SqlHook,
} from './storageHelpers.ts';

const publicWallet = new Wallet(`0x${'11'.repeat(32)}`);
const root = {
  address: publicWallet.address,
  publicKey: publicWallet.signingKey.publicKey.toLowerCase(),
  profileId: `0x${'22'.repeat(32)}`,
};
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-atomic-install-'));
  const file = path.join(directory, 'wallet.sqlite');
  let before: SqlHook | undefined, after: SqlHook | undefined;
  const open = (fresh: boolean) =>
    SqliteWalletStorage.open(
      nodeConnection(file, {
        before: (...args) => before?.(...args),
        after: (...args) => after?.(...args),
      }).connection,
      digest,
      INSTALLATION,
      fresh
    );
  let store = await open(true);
  const candidate = async () => {
    const pair = validPair();
    const binding = await store.recovery.fingerprintPair!({ vault: pair.vault, keys: pair['vault-keys'] });
    return {
      publicSession: storageOnlyPublicSession(binding),
      vault: pair.vault,
      keys: pair['vault-keys'],
      credential: await createTestCredentialReference(store, { vault: pair.vault, keys: pair['vault-keys'] }, await store.recovery.fingerprintPair!({ vault: pair.vault, keys: pair['vault-keys'] })),
      accountRecords: {
        version: 1,
        walletFingerprint: await store.recovery.fingerprintPair!({
          vault: pair.vault,
          keys: pair['vault-keys'],
        }),
        groups: [{ public: 'fixture', encrypted: 'ciphertext' }],
      },
    };
  };
  return {
    get store() {
      return store;
    },
    candidate,
    readExternalRecord() { const db = new DatabaseSync(file); try { return db.prepare('SELECT value FROM keyring_records WHERE key = ?').get('unexpected-record'); } finally { db.close(); } },
    addExternalRecord() { const db = new DatabaseSync(file); try { db.prepare('INSERT INTO keyring_records (key,value) VALUES (?,?)').run('unexpected-record', encodeStorageValue({ untouched: true })); } finally { db.close(); } },
    setBefore(value?: SqlHook) {
      before = value;
    },
    setAfter(value?: SqlHook) {
      after = value;
    },
    async reopen() {
      before = undefined;
      after = undefined;
      await store.close();
      store = await open(false);
      await store.credential.settleCredentialRemoval(async () => {});
    },
    async close() {
      before = undefined;
      after = undefined;
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('first installation atomically writes the pair, complete account value and bound identity', async () => {
  const f = await fixture();
  try {
    const before = await f.store.recovery.readSnapshot(),
      value = await f.candidate();
    const pending = f.store.recovery.prepareCreation!(before, value, root, () => undefined);
    value.accountRecords.groups[0]!.encrypted = 'caller mutation';
    const plan = await pending,
      expected = f.store.recovery.plannedSnapshot!(plan);
    await assert.rejects(f.store.recovery.readSnapshot(), { code: 'STORAGE_REOPEN_REQUIRED' });
    await f.store.recovery.commitReplacement!(plan, () => undefined);
    assert(
      sameRecoverySnapshot(await f.store.recovery.readSnapshot(), expected)
    );
    assert.equal(
      ((await f.store.keyringStorage.get(ACCOUNT_RECORD_KEY)) as any).groups[0]
        .encrypted,
      'ciphertext'
    );
    assert.deepEqual((await f.store.recovery.readIdentity())!.root, root);
    await assert.rejects(
      f.store.recovery.commitReplacement!(plan, () => undefined),
      { code: 'STORAGE_CHANGED' }
    );
    await f.reopen();
    assert(
      sameRecoverySnapshot(await f.store.recovery.readSnapshot(), expected)
    );
  } finally {
    await f.close();
  }
});

for (const fault of ['account', 'checkpoint', 'identity', 'auth', 'commit'] as const)
  test(`initial installation ${fault} failure rolls back every domain`, async () => {
    const f = await fixture();
    try {
      const before = await f.store.recovery.readSnapshot();
      const plan = await f.store.recovery.prepareCreation!(
        before,
        await f.candidate(),
        root, () => undefined
      );
      if (fault === 'checkpoint') assert.equal(f.store.recovery.plannedSnapshot!(plan).records[0]!.key, PUBLIC_SESSION_RECORD_KEY);
      let records = 0,
        metadata = 0,
        injected = false;
      f.setBefore((kind, sql) => {
        if (kind === 'run' && sql.startsWith('INSERT INTO keyring_records'))
          records++;
        if (kind === 'run' && sql.startsWith('INSERT INTO wallet_metadata'))
          metadata++;
        if (
          !injected &&
          ((fault === 'account' && records === 2) ||
            (fault === 'checkpoint' && records === 1) ||
            (fault === 'auth' && metadata === 1) ||
            (fault === 'identity' && metadata === 2) ||
            (fault === 'commit' && sql === 'COMMIT'))
        ) {
          injected = true;
          throw new Error('public fault');
        }
      });
      await assert.rejects(
        f.store.recovery.commitReplacement!(plan, () => undefined)
      );
      assert(injected);
      await f.reopen();
      assert(
        sameRecoverySnapshot(await f.store.recovery.readSnapshot(), before)
      );
    } finally {
      await f.close();
    }
  });

test('a lost COMMIT acknowledgement retains the complete installed wallet and requires reopen', async () => {
  const f = await fixture();
  try {
    const plan = await f.store.recovery.prepareCreation!(
      await f.store.recovery.readSnapshot(),
      await f.candidate(),
      root, () => undefined
    );
    const expected = f.store.recovery.plannedSnapshot!(plan);
    f.setAfter((_kind, sql) => {
      if (sql === 'COMMIT') throw new Error('public lost acknowledgement');
    });
    await assert.rejects(
      f.store.recovery.commitReplacement!(plan, () => undefined)
    );
    await assert.rejects(f.store.recovery.readSnapshot(), {
      code: 'STORAGE_REOPEN_REQUIRED',
    });
    await f.reopen();
    assert(
      sameRecoverySnapshot(await f.store.recovery.readSnapshot(), expected)
    );
  } finally {
    await f.close();
  }
});

test('initial installation refuses an externally inserted orphan without removing it', async () => {
  const f = await fixture();
  try {
    const plan = await f.store.recovery.prepareCreation!(
      await f.store.recovery.readSnapshot(), await f.candidate(), root, () => undefined);
    f.addExternalRecord();
    const occupied = f.readExternalRecord();
    await assert.rejects(f.store.recovery.commitReplacement!(plan, () => undefined), { code: 'STORAGE_CORRUPT' });
    assert.deepEqual(f.readExternalRecord(), occupied);
    await assert.rejects(f.store.recovery.readSnapshot());
  } finally { await f.close(); }
});


test('the account-only four MiB bound survives cold load and refuses overflow before changing the pair', async () => {
  const f = await fixture();
  try {
    const value = await f.candidate();
    const large = { ...value.accountRecords, payload: '' };
    large.payload = 'x'.repeat(ACCOUNT_RECORD_LIMITS.valueBytes - Buffer.byteLength(encodeAccountRecord(large)));
    assert.equal(Buffer.byteLength(encodeAccountRecord(large)), ACCOUNT_RECORD_LIMITS.valueBytes);
    const empty = await f.store.recovery.readSnapshot();
    await assert.rejects(async () => f.store.recovery.prepareCreation!(empty, { ...value, accountRecords: { ...large, payload: large.payload + 'x' } }, root, () => undefined));
    assert(sameRecoverySnapshot(await f.store.recovery.readSnapshot(), empty));
    const plan = await f.store.recovery.prepareCreation!(await f.store.recovery.readSnapshot(), { ...value, accountRecords: large }, root, () => undefined);
    await f.store.recovery.commitReplacement!(plan, () => undefined);
    await f.reopen();
    assert.deepEqual(await f.store.keyringStorage.get(ACCOUNT_RECORD_KEY), large);
    const saved = await f.store.recovery.readSnapshot();
    assert.equal(Buffer.byteLength(saved.records.find((row) => row.key === ACCOUNT_RECORD_KEY)!.value), ACCOUNT_RECORD_LIMITS.valueBytes);
    await assert.rejects(async () => f.store.keyringStorage.set('other-value', large));
    assert(sameRecoverySnapshot(await f.store.recovery.readSnapshot(), saved));
    assert.equal(await f.store.keyringStorage.compareAndSet(ACCOUNT_RECORD_KEY, large, { ...large, payload: 'smaller' }), true);
    assert.equal((await f.store.keyringStorage.get(ACCOUNT_RECORD_KEY) as any).payload, 'smaller');
  } finally { await f.close(); }
});


test('missing, mismatched and oversized public checkpoints fail before initial wallet writes', async () => {
  const f = await fixture();
  try {
    for (const fault of ['missing', 'binding', 'capacity'] as const) {
      const before = await f.store.recovery.readSnapshot();
      const value = await f.candidate();
      if (fault === 'missing') Reflect.deleteProperty(value, 'publicSession');
      if (fault === 'binding') value.publicSession.checkpoint.recordId = 'cd'.repeat(32);
      if (fault === 'capacity') value.publicSession.checkpoint.ciphertext = 'x'.repeat(PUBLIC_SESSION_RECORD_LIMITS.valueBytes);
      await assert.rejects(async () => f.store.recovery.prepareCreation!(before, value, root, () => undefined));
      assert(sameRecoverySnapshot(await f.store.recovery.readSnapshot(), before));
    }
  } finally { await f.close(); }
});
