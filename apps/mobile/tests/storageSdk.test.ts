import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const require = createRequire(import.meta.url);

test('published software SDK creates and reopens its real wallet through SQLite at production KDF', async () => {
  const oldEnv = [
    process.env.NODE_ENV,
    process.env.SYSWEB3_PBKDF2_ENC_ITERS,
    process.env.SYSWEB3_PBKDF2_AUTH_ITERS,
  ];
  const oldFetch = globalThis.fetch;
  process.env.NODE_ENV = 'production';
  delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
  delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
  let networkCalls = 0;
  globalThis.fetch = (() => {
    networkCalls++;
    throw Error('Network forbidden in SQLite qualification');
  }) as typeof fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-storage-sdk-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage: SqliteWalletStorage | undefined;
  let keyring: any;
  try {
    const {
      SoftwareKeyring,
      createSoftwareKeyringHost,
      KeyringAccountType,
      INetworkType,
    } = require('@sidhujag/sysweb3-keyring/cjs/software');
    assert.equal(
      require('@sidhujag/sysweb3-keyring/package.json').version,
      '1.0.628'
    );
    storage = await SqliteWalletStorage.open(
      nodeConnection(file).connection,
      digest,
      INSTALLATION,
      true
    );
    keyring = new SoftwareKeyring(
      createSoftwareKeyringHost(storage.keyringStorage)
    );
    assert.equal(keyring.getEncIterations(), 900000);
    const state = {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        slip44: 60,
        currency: 'ETH',
        label: 'Ethereum',
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
    keyring.setVaultStateGetter(() => state);
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const password = 'PUBLIC SQLite storage test password';
    state.accounts.HDAccount[0] = await keyring.initializeWalletSecurely(
      mnemonic,
      password
    );
    const fingerprint = await storage.getWalletFingerprint();
    await storage.confirmBackup(fingerprint);
    assert.equal((await storage.readState()).backup, 'confirmed');
    await keyring.lockWallet();
    assert.deepEqual(await keyring.unlock('PUBLIC wrong password'), {
      canLogin: false,
    });
    await storage.authGuard.recordFailure();
    assert.equal((await keyring.unlock(password)).canLogin, true);
    await storage.authGuard.recordSuccess();
    assert.equal(await keyring.getSeed(password), mnemonic);
    await keyring.lockWallet();
    await storage.close();
    storage = await SqliteWalletStorage.open(
      nodeConnection(file).connection,
      digest,
      INSTALLATION,
      false
    );
    keyring = new SoftwareKeyring(
      createSoftwareKeyringHost(storage.keyringStorage)
    );
    keyring.setVaultStateGetter(() => state);
    await storage.authGuard.checkAllowed();
    assert.equal((await keyring.unlock(password)).canLogin, true);
    assert.equal(await keyring.getSeed(password), mnemonic);
    assert.equal(await storage.getWalletFingerprint(), fingerprint);
    assert.deepEqual(await storage.readState(), {
      presence: 'existing',
      backup: 'confirmed',
    });
    await keyring.lockWallet();
    await storage.close();
    const onDisk = await readFile(file);
    assert.equal(onDisk.includes(Buffer.from(mnemonic)), false);
    assert.equal(onDisk.includes(Buffer.from(password)), false);
    assert.equal(networkCalls, 0);
  } finally {
    await keyring?.lockWallet().catch(() => undefined);
    await storage?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    globalThis.fetch = oldFetch;
    for (const [index, key] of [
      'NODE_ENV',
      'SYSWEB3_PBKDF2_ENC_ITERS',
      'SYSWEB3_PBKDF2_AUTH_ITERS',
    ].entries()) {
      const value = oldEnv[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
