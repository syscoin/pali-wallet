import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { NativeLedgerAccounts } from '../src/custody/ledgerAccounts.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import type { NativeLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'Public Ledger import fixture 1!';
const deviceWallet = new Wallet('0x' + '31'.repeat(32));

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-ledger-import-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false,
    runtime!: KeyringRuntime,
    owner!: NativeCustodyAuthority;
  let holdAddress: (() => Promise<void>) | undefined;
  let holdCreation: (() => Promise<void>) | undefined;
  let disposedCount = 0;
  const candidate = {
    id: 'private-device-id',
    transport: 'RN_BLE',
    name: 'Ledger\n' + 'x'.repeat(90),
    deviceModel: { name: 'Nano X' },
  };
  const second = {
    ...candidate,
    id: 'other-private-device-id',
    name: 'Other Ledger',
  };
  let emitDevices: ((devices: any[]) => void) | undefined;
  const openStorage = async () => {
    const storage = await SqliteWalletStorage.open(
      nodeConnection(file).connection,
      digest,
      INSTALLATION,
      !initialized
    );
    initialized = true;
    return storage;
  };
  const factory = createKeyringRuntimeFactory({
    ensureCryptoReady: async () => undefined,
    readEvmRetirement: null,
    openStorage,
    async createLedgerTransport(scope) {
      let connected = false,
        disposed = false;
      const check = () => {
        scope.assertCurrent();
        assert(!scope.signal.aborted && !disposed, 'CANCELLED');
      };
      const unexpected = async () => {
        throw Error('Unexpected device request');
      };
      const result: NativeLedgerTransport = {
        host: {
          getStatus: () => ({ connected: connected && !disposed }),
          connect: async () => {
            check();
            assert(connected);
          },
          disconnect: async () => {
            connected = false;
          },
          beginDeviceSelection: () => async (selected) => {
            check();
            assert.equal(selected, candidate);
            connected = true;
          },
          evm: {
            async getAddress() {
              check();
              await holdAddress?.();
              check();
              return {
                address: deviceWallet.address,
                publicKey: deviceWallet.signingKey.publicKey,
              };
            },
            signTransaction: unexpected,
            signPersonalMessage: unexpected,
            signTypedData: unexpected,
          },
          utxo: {
            async getXpub(request) {
              check();
              const network = getNetworkConfig(
                request.slip44,
                request.currency
              );
              const hd = new syscoinUtils.HDSigner(
                'test test test test test test test test test test test junk',
                null,
                request.slip44 === 1,
                network.networks,
                request.slip44,
                network.types.zPubType,
                84
              );
              hd.createAccountAtIndex(request.accountIndex, 84);
              return hd.getAccountXpub();
            },
            getAddress: unexpected,
            getAccount: unexpected,
            signMessage: unexpected,
            signPsbt: unexpected,
          },
        },
        async observeDevices(onDevices) {
          check();
          emitDevices = onDevices;
          onDevices([candidate as never]);
          return async () => undefined;
        },
        async dispose() {
          if (!disposed) disposedCount++;
          disposed = true;
          connected = false;
        },
      };
      await holdCreation?.();
      return result;
    },
  });
  const open = async () => {
    owner = new NativeCustodyAuthority({
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    });
    await owner.initialize();
  };
  await open();
  await owner.importPhrase(phrase, password);
  await runtime.backup.confirm(await runtime.backup.fingerprint());
  await owner.refreshAuthenticatedMetadata();
  const view = new NativeLedgerAccounts(owner, () => runtime.ledger);
  return {
    get owner() {
      return owner;
    },
    get runtime() {
      return runtime;
    },
    view,
    openStorage,
    devices(values: readonly ('first' | 'second')[]) {
      emitDevices?.(
        values.map((value) => (value === 'first' ? candidate : second))
      );
    },
    async reopen(nextPassword: string) {
      owner = new NativeCustodyAuthority({
        async open() {
          runtime = (await factory.open()) as KeyringRuntime;
          return runtime;
        },
      });
      await owner.initialize();
      await owner.unlock(nextPassword);
    },
    get disposedCount() {
      return disposedCount;
    },
    holdCreation(value: () => Promise<void>) {
      holdCreation = value;
    },
    hold(value: () => Promise<void>) {
      holdAddress = value;
    },
    async close() {
      await view.dispose();
      await owner.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('the shared SDK imports a public Ledger record, preserves it on unlock and password recovery', async () => {
  const f = await fixture();
  try {
    await f.view.start();
    const devices = f.view.getSnapshot().devices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.name.length, 64);
    assert(!devices[0]!.name.includes('\n'));
    assert(!devices[0]!.id.includes('private-device-id'));
    await f.view.select(devices[0]!.id);
    assert.equal(f.view.getSnapshot().address, deviceWallet.address);
    await f.view.importAccount('Ledger account');
    const imported = f.owner
      .getCatalogue()!
      .accounts.find((account) => account.type === 'Ledger');
    assert.equal(imported?.address, deviceWallet.address);
    assert.equal(imported?.id, 'ledger:60:0');
    f.owner.lock();
    await f.owner.unlock(password);
    assert.equal(f.owner.getCatalogue()!.active.accountId, imported!.id);
    const recovery = new NativeRecoveryCoordinator({
      owner: f.owner,
      async retireControllers() {},
      ensureCryptoReady: async () => undefined,
      openStorage: f.openStorage,
    });
    try {
      f.owner.lock();
      const proof = await recovery.prepare(
        phrase,
        'Replacement Ledger fixture password 2!',
        () => undefined
      );
      assert.equal(await recovery.commit(proof), 'committed-locked');
    } finally {
      await recovery.dispose();
    }
    await f.reopen('Replacement Ledger fixture password 2!');
    assert.equal(
      f.owner
        .getCatalogue()!
        .accounts.find((account) => account.id === imported!.id)?.address,
      deviceWallet.address
    );
  } finally {
    await f.close();
  }
});

test('locking during device address retrieval cannot save a late Ledger account', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.hold(() => held);
    await f.view.start();
    const selected = f.view.select(f.view.getSnapshot().devices[0]!.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.owner.lock();
    release();
    await assert.rejects(selected);
    await f.owner.unlock(password);
    assert.equal(
      f.owner
        .getCatalogue()!
        .accounts.some((account) => account.type === 'Ledger'),
      false
    );
  } finally {
    release?.();
    await f.close();
  }
});

test('device reordering preserves a rendered picker handle and removal invalidates it', async () => {
  const f = await fixture();
  try {
    await f.view.start();
    f.devices(['first', 'second']);
    const first = f.view.getSnapshot().devices[0]!.id;
    f.devices(['second', 'first']);
    assert.equal(f.view.getSnapshot().devices[1]!.id, first);
    await f.view.select(first);
    assert.equal(f.view.getSnapshot().address, deviceWallet.address);
    await f.view.close();
    await f.view.start();
    const removed = f.view.getSnapshot().devices[0]!.id;
    f.devices(['second']);
    await assert.rejects(f.view.select(removed));
    assert.equal(
      f.owner
        .getCatalogue()!
        .accounts.some((account) => account.type === 'Ledger'),
      false
    );
  } finally {
    await f.close();
  }
});

test('UTXO Ledger import uses the shared SDK network and BIP84 account conversion', async () => {
  const f = await fixture();
  try {
    await f.owner.selectNetwork(
      'bitcoin',
      f.owner.getSnapshot().revision,
      f.owner.getCatalogue()!.revision
    );
    await f.view.start();
    await f.view.select(f.view.getSnapshot().devices[0]!.id);
    await f.view.importAccount('Bitcoin Ledger');
    const account = f.owner
      .getCatalogue()!
      .accounts.find((entry) => entry.type === 'Ledger');
    assert.equal(account?.id, 'ledger:0:0');
    assert.match(account!.address, /^bc1/);
    f.owner.lock();
    await f.owner.unlock(password);
    assert.equal(f.owner.getCatalogue()!.active.accountId, account!.id);
  } finally {
    await f.close();
  }
});

test('runtime retirement joins a delayed native transport acquisition and its cleanup', async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    f.holdCreation(async () => {
      entered();
      await wait;
    });
    const opening = f.view.start();
    void opening.catch(() => undefined);
    await started;
    let retired = false;
    const close = f.owner.dispose().then(() => {
      retired = true;
    });
    await Promise.resolve();
    assert.equal(retired, false);
    release();
    await assert.rejects(opening);
    await close;
    assert.equal(f.disposedCount, 1);
  } finally {
    release();
    await f.close();
  }
});
