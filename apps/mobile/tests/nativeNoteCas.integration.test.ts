import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  INetworkType,
  KeyringAccountType,
  SoftwareKeyring,
  createKeyringHost,
} from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { HDNodeWallet } from 'ethers/wallet';
import { AsyncMutex } from '../../../source/utils/asyncMutex.ts';
import { identifyClassicNote } from '../../../source/utils/privacy/note.ts';
import {
  createPrivateVaultController,
  createPrivateVaultSession,
  PRIVATE_VAULT_STORAGE_PREFIX,
  type IPrivateVaultSession,
} from '../../../source/wallet/privateVault.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'PUBLIC note storage fixture password';
const FIRST = { note: `tornado-eth-1-1-0x${'01'.repeat(62)}`, createdAt: 10 };
const SECOND = { note: `tornado-eth-1-1-0x${'02'.repeat(62)}`, createdAt: 20 };

test('real SDK note restore revokes a locked write, consumes an uncertain commit once, and reads its exact receipt after reopen', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-native-note-cas-'));
  const file = path.join(directory, 'wallet.sqlite');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests++;
    throw Error('Network forbidden');
  }) as typeof fetch;
  let storage: SqliteWalletStorage | undefined;
  let keyring: SoftwareKeyring | undefined;
  let generation = 0;
  let action: 'lock' | 'expire' | 'lose-ack' | undefined;
  let noteWrite = false;
  let inserts = 0;
  let commits = 0;
  let elapsed = 0;
  const owned = nodeConnection(file, {
    async after(kind, sql) {
      if (
        kind === 'run' &&
        sql.startsWith('INSERT INTO private_note_records')
      ) {
        noteWrite = true;
        inserts++;
        if (action === 'lock') {
          generation++;
          await keyring!.lockWallet();
        }
        if (action === 'expire') elapsed += 300_000;
      }
      if (kind === 'exec' && noteWrite) {
        if (sql === 'ROLLBACK') noteWrite = false;
        if (sql === 'COMMIT') {
          noteWrite = false;
          commits++;
          if (action === 'lose-ack')
            throw Error('Synthetic lost COMMIT acknowledgement');
        }
      }
    },
  });
  const state = {
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: {
      kind: INetworkType.Ethereum,
      chainId: 1,
      slip44: 60,
      label: 'Ethereum',
      currency: 'ETH',
      url: 'https://offline.invalid',
    },
    accounts: {
      HDAccount: {} as Record<number, unknown>,
      Imported: {},
      Ledger: {},
      Trezor: {},
      SmartAccount: {},
    },
  };
  const createKeyring = (currentStorage: SqliteWalletStorage) => {
    const current = new SoftwareKeyring(
      createKeyringHost(currentStorage.keyringStorage), { captureEvmSubmission: null }
    );
    current.setVaultStateGetter(() => state);
    return current;
  };
  const captureSession = (): IPrivateVaultSession => {
    const captured = generation;
    const ring = keyring!;
    return createPrivateVaultSession({
      generation: captured,
      keyring: ring,
      assertCurrent() {
        if (generation !== captured || keyring !== ring || !ring.isUnlocked())
          throw new WalletStorageError('STORAGE_CHANGED');
      },
    });
  };
  try {
    storage = await SqliteWalletStorage.open(
      owned.connection,
      digest,
      INSTALLATION,
      true
    );
    keyring = createKeyring(storage);
    const account = await keyring.initializeWalletSecurely(PHRASE, PASSWORD);
    state.accounts.HDAccount[0] = account;
    const root = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/0");
    assert.equal(account.address, root.address);
    const profileId = await keyring.getPrivateRecordProfileId();
    const binding = await storage.getWalletFingerprint();
    await storage.recovery.bindIdentity(
      binding,
      { address: root.address, publicKey: root.publicKey, profileId },
      captureSession().assertCurrent
    );
    const key = PRIVATE_VAULT_STORAGE_PREFIX + profileId;
    const attempts: { expected: string | undefined; next: string }[] = [];
    const connectVault = (
      currentStorage: SqliteWalletStorage,
      currentRing: SoftwareKeyring
    ) =>
      createPrivateVaultController(
        {
          captureSession,
          async authenticate(password, session, operation) {
            assert(typeof password === 'string');
            session.assertCurrent();
            assert.equal(session.keyring, currentRing);
            await currentStorage.authGuard.checkAllowed();
            const result = await currentRing.unlock(password);
            session.assertCurrent();
            assert.equal(result.canLogin, true);
            await currentStorage.authGuard.recordSuccess();
            session.assertCurrent();
            return operation();
          },
          readNote: async () => {
            throw Error('Pool access forbidden');
          },
        },
        {
          storage: {
            async getItem(requested) {
              assert.equal(requested, key);
              const row = (await currentStorage.notes.read())[0];
              if (row) {
                assert.equal(row.profileId, profileId);
                assert.equal(row.walletBindingId, binding);
              }
              return row?.value;
            },
            compareAndSet(requested, expected, next, assertCurrent) {
              assert.equal(requested, key);
              attempts.push({ expected, next });
              return currentStorage.notes.compareAndSet(
                profileId,
                binding,
                expected,
                next,
                assertCurrent
              );
            },
          },
          mutex: new AsyncMutex(),
          identify: identifyClassicNote,
          generate: () => {
            throw Error('Note generation forbidden');
          },
          now: () => 30,
          deadlineNow: () => elapsed,
          randomId: randomUUID,
        }
      );
    const vault = connectVault(storage, keyring);

    const locked = await vault.prepareRestore([FIRST], captureSession());
    action = 'lock';
    await assert.rejects(
      vault.commitRestore(locked, [FIRST], PASSWORD, captureSession()),
      /privacy_vault_unavailable/
    );
    assert.equal(keyring.isUnlocked(), false);
    assert.deepEqual(await storage.notes.read(), []);
    assert.equal(commits, 0);
    assert.equal((await keyring.unlock(PASSWORD)).canLogin, true);
    await assert.rejects(
      vault.commitRestore(locked, [FIRST], PASSWORD, captureSession()),
      /privacy_restore_stale/
    );

    const expires = await vault.prepareRestore([FIRST], captureSession());
    action = 'expire';
    await assert.rejects(
      vault.commitRestore(expires, [FIRST], PASSWORD, captureSession()),
      /privacy_vault_unavailable/
    );
    assert.deepEqual(await storage.notes.read(), []);
    assert.equal(commits, 0);

    action = undefined;
    const first = await vault.prepareRestore([FIRST], captureSession());
    const receipt = await vault.commitRestore(
      first,
      [FIRST],
      PASSWORD,
      captureSession()
    );
    assert.equal(receipt.id, first.id);
    const firstBytes = (await storage.notes.read())[0]!.value;
    assert.equal(attempts.at(-1)?.expected, undefined);
    assert.equal(attempts.at(-1)?.next, firstBytes);
    assert.equal(commits, 1);

    const second = await vault.prepareRestore([SECOND], captureSession());
    action = 'lose-ack';
    await assert.rejects(
      vault.commitRestore(second, [SECOND], PASSWORD, captureSession()),
      /privacy_vault_unavailable/
    );
    assert.equal(commits, 2);
    assert.equal(inserts, 4);
    assert.equal(attempts.at(-1)?.expected, firstBytes);
    const uncertainBytes = attempts.at(-1)!.next;
    assert.ok(
      !uncertainBytes.includes(FIRST.note) &&
        !uncertainBytes.includes(SECOND.note)
    );
    await assert.rejects(storage.notes.read(), {
      code: 'STORAGE_REOPEN_REQUIRED',
    });
    await assert.rejects(
      storage.notes.compareAndSet(
        profileId,
        binding,
        firstBytes,
        uncertainBytes,
        captureSession().assertCurrent
      ),
      { code: 'STORAGE_REOPEN_REQUIRED' }
    );
    await assert.rejects(
      vault.commitRestore(second, [SECOND], PASSWORD, captureSession()),
      /privacy_restore_stale/
    );
    assert.equal(inserts, 4);

    generation++;
    await keyring.lockWallet();
    await storage.close();
    storage = await SqliteWalletStorage.open(
      nodeConnection(file).connection,
      digest,
      INSTALLATION,
      false
    );
    assert.equal((await storage.notes.read())[0]?.value, uncertainBytes);
    assert.equal(
      (await storage.recovery.readSnapshot()).notes[0]?.value,
      uncertainBytes
    );
    keyring = createKeyring(storage);
    assert.equal((await keyring.unlock(PASSWORD)).canLogin, true);
    const reopened = connectVault(storage, keyring);
    assert.equal(
      (await reopened.getRestoreReceipt(captureSession()))?.id,
      second.id
    );
    const snapshot = await reopened.exportBackupSnapshot(
      PASSWORD,
      captureSession()
    );
    assert.deepEqual(snapshot.notes.map((entry) => entry.note).sort(), [
      FIRST.note,
      SECOND.note,
    ]);
    assert.equal(
      attempts.length,
      4,
      'cold resolution must not issue a new guarded write'
    );
    assert.equal(requests, 0);
  } finally {
    await keyring?.lockWallet().catch(() => undefined);
    await storage?.close().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
