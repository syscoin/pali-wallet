import { prepareRecoveryPin } from './fixtures/recoveryPin.ts';
import { signTestTransfer } from './fixtures/operationAuthorization.ts';
import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import { nonSuiteSigningHandoff } from './nonSuiteSigningHandoff.ts';
import { getNetworkConfig } from '@sidhujag/sysweb3-network';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { getBytes } from 'ethers/utils';
import { signTypedData, SignTypedDataVersion } from '@metamask/eth-sig-util';
import { readDappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';
import { approveHardwareDappRequest, hardwareDappRpc } from './hardwareDappTestSupport.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { metadata } from './publicWatchFixtures.ts';
import { encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import {
  encodeNftTransferData,
  snapshotNftTransferIntent,
} from '../../../source/shared/nftTransfer.ts';
import {
  snapshotErc20TransferIntent,
  type NativeAssetTransferIntent,
} from '../src/custody/transferIntent.ts';
import { prepareLedgerPsbt } from '@sidhujag/sysweb3-keyring/cjs/ledger/prepare-psbt.js';
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

const pinCredential = createTestPinCredentialPort();

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = '123456';
const deviceWallet = new Wallet('0x' + '31'.repeat(32));

function hardwareHd(slip44: number, currency: string, accountIndex: number) {
  const config = getNetworkConfig(slip44, currency);
  const hd = new syscoinUtils.HDSigner(
    'test test test test test test test test test test test junk',
    null,
    slip44 === 1,
    config.networks,
    slip44,
    config.types.zPubType,
    84
  );
  hd.createAccountAtIndex(accountIndex, 84);
  return hd;
}

async function fixture() {
  const sdk = await loadNativeKeyringSdk();
  let sessionTransfers = 0;
  class CountedHost extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
      const prepare = this.prepareSessionTransfer;
      this.prepareSessionTransfer = (...args) => {
        sessionTransfers++;
        return prepare(...args);
      };
    }
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-ledger-import-'));
  const file = path.join(directory, 'wallet.sqlite');
  let initialized = false,
    runtime!: KeyringRuntime,
    owner!: NativeCustodyAuthority;
  let holdAddress: (() => Promise<void>) | undefined;
  let holdCreation: (() => Promise<void>) | undefined;
  let disposedCount = 0,
    signedCount = 0,
    messageCount = 0,
    psbtSignCount = 0;
  let utxoFetch: typeof globalThis.fetch = async () => {
    throw Error('Unexpected UTXO request');
  };
  let connectionFetch: NonNullable<import('../src/custody/keyringRuntime.ts').KeyringRuntimeDependencies['connectionFetch']> = async () => { throw Error('Unexpected connection request'); };
  let selectedWallet = deviceWallet;
  let holdSignature: (() => Promise<void>) | undefined;
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
  const deviceStatus: { disconnect(): void; late(): void }[] = [];
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
  let currentPin = password;
  const factory = createKeyringRuntimeFactory({ pinCredential, requestOperationCredential: async (_request, _signal, check, verify) => { check(); const result = await verify({ method: 'pin', pin: currentPin }, check); if (!result.accepted) throw Error(result.reason); }, privacyServiceSettings: null, slhExecution: null,
    ensureCryptoReady: async () => undefined,
    loadSdk: async () => ({ ...sdk, HostKeyring: CountedHost }),
    readEvmRetirement: null,
    openStorage,
    utxoFetch: (...args) => utxoFetch(...args),
    connectionFetch: (...args) => connectionFetch(...args),
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
      const statusListeners = new Set<() => void>();
      const historicalListeners = new Set<() => void>();
      deviceStatus.push({
        disconnect() {
          connected = false;
          for (const listener of statusListeners) listener();
        },
        late() {
          for (const listener of historicalListeners) listener();
        },
      });
      const result: NativeLedgerTransport = {
        host: {
          getStatus: () => ({ connected: connected && !disposed }),
          subscribeStatus(listener) {
            statusListeners.add(listener);
            historicalListeners.add(listener);
            return () => {
              statusListeners.delete(listener);
            };
          },
          connect: async () => {
            check();
            assert(connected);
          },
          retire: async () => () => undefined,
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
                address: selectedWallet.address,
                publicKey: selectedWallet.signingKey.publicKey,
              };
            },
            async signTransaction(request, signingOwner) {
              check();
              signingOwner?.assertCurrent?.();
              assert(signingOwner?.signal && !signingOwner.signal.aborted);
              signedCount++;
              await holdSignature?.();
              check();
              signingOwner.assertCurrent?.();
              const transaction = Transaction.from(
                '0x' + request.unsignedTxHex
              );
              const signed = selectedWallet.signingKey.sign(
                transaction.unsignedHash
              );
              return {
                r: signed.r.slice(2),
                s: signed.s.slice(2),
                v: signed.v.toString(16),
              };
            },
            async signPersonalMessage(request) {
              check(); messageCount++; await holdSignature?.(); check();
              return selectedWallet.signMessage(getBytes('0x' + request.messageHex));
            },
            async signTypedData(request) {
              check(); messageCount++; await holdSignature?.(); check();
              return signTypedData({ privateKey: Buffer.from(selectedWallet.privateKey.slice(2), 'hex'),
                data: request.data as import('@metamask/eth-sig-util').TypedMessage<import('@metamask/eth-sig-util').MessageTypes>, version: request.version as SignTypedDataVersion.V3 | SignTypedDataVersion.V4 });
            },
          },
          utxo: {
            async getXpub(request) {
              check();
              const hd = hardwareHd(
                request.slip44,
                request.currency,
                request.accountIndex
              );
              return hd.getAccountXpub();
            },
            getAddress: unexpected,
            getAccount: unexpected,
            signMessage: unexpected,
            async signPsbt(request, authority) {
              check();
              authority.assertCurrent();
              assert(!authority.signal.aborted);
              psbtSignCount++;
              const hd = hardwareHd(
                request.slip44,
                request.currency,
                request.accountIndex
              );
              const fingerprint = Buffer.from(
                hd.getMasterFingerprint()
              ).toString('hex');
              const psbt = syscoinUtils.bitcoinjs.Psbt.fromBase64(
                request.psbtBase64,
                { network: hd.Signer.network }
              );
              prepareLedgerPsbt(
                psbt,
                request.accountXpub,
                request.accountIndex,
                request.currency,
                request.slip44,
                fingerprint
              );
              psbt.signAllInputsHD(hd.getRootNode());
              authority.assertCurrent();
              check();
              return {
                fingerprint,
                signatures: psbt.data.inputs.flatMap(
                  (
                    input: {
                      partialSig?: readonly {
                        pubkey: Uint8Array;
                        signature: Uint8Array;
                      }[];
                    },
                    inputIndex: number
                  ) =>
                    (input.partialSig ?? []).map((signature) => ({
                      inputIndex,
                      pubkeyHex: Buffer.from(signature.pubkey).toString('hex'),
                      signatureHex: Buffer.from(signature.signature).toString(
                        'hex'
                      ),
                    }))
                ),
              };
            },
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
  const view = new NativeLedgerAccounts(owner, () => runtime.ledger, 'import');
  const connection = new NativeLedgerAccounts(
    owner,
    () => runtime.ledger,
    'connect'
  );
  return {
    get owner() {
      return owner;
    },
    get runtime() {
      return runtime;
    },
    view,
    connection,
    deviceStatus,
    openStorage,
    get signedCount() {
      return signedCount;
    },
    get messageCount() { return messageCount; },
    setConnectionFetch(value: NonNullable<import('../src/custody/keyringRuntime.ts').KeyringRuntimeDependencies['connectionFetch']>) { connectionFetch = value; },
    get sessionTransfers() {
      return sessionTransfers;
    },
    get psbtSignCount() {
      return psbtSignCount;
    },
    setUtxoFetch(value: typeof globalThis.fetch) {
      utxoFetch = value;
    },
    useDifferentDevice() {
      selectedWallet = new Wallet('0x' + '32'.repeat(32));
    },
    holdSignature(value: () => Promise<void>) {
      holdSignature = value;
    },
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
      await owner.unlock(nextPassword); currentPin = nextPassword;
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
      await connection.dispose();
      await owner.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('the shared SDK imports a public Ledger record, preserves it on unlock and PIN recovery', async () => {
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
    const recovery = new NativeRecoveryCoordinator({ pinCredential,
      owner: f.owner,
      async retireControllers() {},
      ensureCryptoReady: async () => undefined,
      openStorage: f.openStorage,
    });
    try {
      f.owner.lock();
      const proof = await prepareRecoveryPin(recovery, phrase, '654321', () => undefined);
      assert.equal(await recovery.commit(proof), 'committed-locked');
    } finally {
      await recovery.dispose();
    }
    await f.reopen('654321');
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
    , () => {});
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

async function importAndConnect(f: Awaited<ReturnType<typeof fixture>>) {
  await f.view.start();
  await f.view.select(f.view.getSnapshot().devices[0]!.id);
  await f.view.importAccount('Ledger account');
  const revision = f.owner.getSnapshot().revision;
  const catalogue = f.owner.getCatalogue();
  await f.connection.start();
  await f.connection.select(f.connection.getSnapshot().devices[0]!.id);
  assert.equal(f.connection.isConnected(), false);
  await f.connection.finishConnection();
  assert.equal(f.connection.isConnected(), true);
  assert.equal(f.owner.getSnapshot().revision, revision);
  assert.equal(f.owner.getCatalogue(), catalogue);
}

test('Ledger connection reuses the saved public identity and shared EVM signing', async () => {
  const f = await fixture();
  try {
    await importAndConnect(f);
    for (const type of [0, 2] as const) {
      const transaction = {
        from: deviceWallet.address,
        to: '0x' + '22'.repeat(20),
        chainId: '1',
        nonce: '7',
        value: '123',
        gasLimit: '25200',
        data: '0x',
        ...(type === 0
          ? { type: 0 as const, gasPrice: '3' }
          : {
              type: 2 as const,
              accessList: [],
              maxFeePerGas: '3',
              maxPriorityFeePerGas: '1',
            }),
      };
      const signed = await signTestTransfer(f.runtime.transfers!, password, transaction, {
        assertCurrent() {},
        signal: new AbortController().signal,
      });
      const actual = Transaction.from(signed.rawTransaction);
      assert.equal(actual.from, deviceWallet.address);
      assert.equal(actual.nonce, 7);
      assert.equal(actual.value, 123n);
      assert.equal(actual.type, type);
      assert.equal(actual.hash, signed.hash);
    }
    assert.equal(f.signedCount, 2);
    f.owner.lock();
    assert.equal(f.connection.isConnected(), false);
  } finally {
    await f.close();
  }
});

test('Ledger dapp host signs messages and journals the reviewed transaction before a lost reply', async () => {
  const f = await fixture(), rpc = hardwareDappRpc();
  f.setConnectionFetch(rpc.fetch);
  try {
    await importAndConnect(f);
    const host = await f.runtime.openConnectionHost();
    assert.equal(host.context().accounts.find(account => account.id === host.context().activeAccountId)?.type, 'Ledger');
    const typed = { types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }], Message: [{ name: 'text', type: 'string' }] },
      primaryType: 'Message', domain: { chainId: 1 }, message: { text: 'Public Ledger dapp fixture' } };
    for (const method of ['personal_sign', 'eth_signTypedData_v3', 'eth_signTypedData_v4'] as const) {
      const request = readDappMessageRequest(method, method === 'personal_sign' ? ['0x6162', deviceWallet.address] : [deviceWallet.address, typed], deviceWallet.address)!;
      const input = approveHardwareDappRequest(f.owner, host, request);
      try { assert.match(await host.signMessage({ ...input, handoff: nonSuiteSigningHandoff }), /^0x[0-9a-f]{130}$/i); }
      finally { input.approval.dispose(); }
    }
    assert.equal(f.messageCount, 3);
    const request = readDappMessageRequest('personal_sign', ['0x6162', deviceWallet.address], deviceWallet.address)!;
    const input = approveHardwareDappRequest(f.owner, host, request);
    try {
      const review = await host.prepareTransaction({ handoff: nonSuiteSigningHandoff, ...input, transaction: { from: deviceWallet.address,
        to: '0x' + '22'.repeat(20), data: '0x6000' } }, () => undefined);
      assert(!('operation' in review));
      assert.equal(f.signedCount, 0, 'review performs no device signing');
      rpc.onAdmission(async (hash, raw) => {
        const saved = await (await f.runtime.transfers!.journal(() => undefined)).load(hash);
        assert.equal(saved?.rawTransaction, raw, 'exact signed bytes are durable before POST');
      });
      rpc.loseReply();
      await assert.rejects(review.submit(() => undefined, hash => { rpc.reports.push(hash); }, { kind: 'transaction' }));
      assert.equal(rpc.rawTransactions.length, 1);
      assert.equal(f.signedCount, 1);
      const raw = rpc.rawTransactions[0]!, transaction = Transaction.from(raw);
      assert.equal(transaction.from, deviceWallet.address);
      assert.equal(transaction.to?.toLowerCase(), '0x' + '22'.repeat(20));
      assert.equal(transaction.data, '0x6000');
      assert.equal(transaction.chainId, 1n);
      const retained = await (await f.runtime.transfers!.journal(() => undefined)).load(keccak256(raw));
      assert.equal(retained?.rawTransaction, raw);
      await assert.rejects(review.submit(() => undefined, () => assert.fail('cannot resend retired review'), { kind: 'transaction' }), /REVIEW_REQUIRED/);
      assert.equal(f.signedCount, 1);
      assert.equal(rpc.rawTransactions.length, 1);
    } finally { input.approval.dispose(); }
  } finally { await f.close(); }
});

test('Ledger dapp request retirement drains its device and withholds a held signature', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await importAndConnect(f);
    const host = await f.runtime.openConnectionHost();
    const request = readDappMessageRequest('personal_sign', ['0x6162', deviceWallet.address], deviceWallet.address)!;
    const input = approveHardwareDappRequest(f.owner, host, request);
    const disposedBefore = f.disposedCount;
    f.holdSignature(async () => { entered.resolve(); await release.promise; });
    const work = host.signMessage({ ...input, handoff: nonSuiteSigningHandoff }), rejected = assert.rejects(work);
    // Fail immediately if the SDK rejects before reaching the held device call.
    // A stale fixture must not leave the whole test worker waiting forever.
    await Promise.race([entered.promise, work.then(() => assert.fail('Signing settled before device entry'))]);
    input.approval.retire();
    release.resolve();
    await rejected;
    assert.equal(f.messageCount, 1);
    assert.equal(f.connection.isConnected(), false);
    assert.equal(f.disposedCount, disposedBefore + 1);
    input.approval.dispose();
  } finally { release.resolve(); await f.close(); }
});

test('a different Ledger cannot reconnect to the saved account', async () => {
  const f = await fixture();
  try {
    await f.view.start();
    await f.view.select(f.view.getSnapshot().devices[0]!.id);
    await f.view.importAccount('Ledger account');
    f.useDifferentDevice();
    await f.connection.start();
    await assert.rejects(
      f.connection.select(f.connection.getSnapshot().devices[0]!.id),
      /INVALID_INPUT/
    );
    assert.equal(f.connection.isConnected(), false);
    assert.equal(f.signedCount, 0);
  } finally {
    await f.close();
  }
});

for (const changedChain of [false, true])
  test(
    changedChain
      ? 'Ledger final chain mismatch retains signed bytes without a broadcast'
      : 'the normal Ledger send retains signed bytes before its broadcast',
    async () => {
      const f = await fixture();
      let transfers: NativeTransfers | undefined;
      try {
        await importAndConnect(f);
        let broadcasts = 0;
        let chainId = '0x1';
        const rpc = new NativeTransferRpc({
          networkId: 'ethereum',
          fetch: async (_url, init) => {
            const request = JSON.parse(String(init.body));
            let result: unknown;
            switch (request.method) {
              case 'eth_chainId':
                result = chainId;
                break;
              case 'eth_getTransactionCount':
                result = '0x0';
                break;
              case 'eth_getBalance':
                result = '0x10000000000000000';
                break;
              case 'eth_gasPrice':
                result = '0x2';
                break;
              case 'eth_feeHistory':
                result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
                break;
              case 'eth_maxPriorityFeePerGas':
                result = '0x1';
                break;
              case 'eth_estimateGas':
                result = '0x5208';
                break;
              case 'eth_getTransactionByHash':
              case 'eth_getTransactionReceipt':
                result = null;
                break;
              case 'eth_getBlockByNumber':
                result = {
                  number: '0x20',
                  hash: '0x' + 'ab'.repeat(32),
                  baseFeePerGas: '0x1',
                  gasLimit: '0x1c9c380',
                };
                break;
              case 'eth_sendRawTransaction': {
                broadcasts++;
                const raw = request.params[0];
                const stored = await (
                  await f.runtime.transfers!.journal(() => undefined)
                ).load(keccak256(raw));
                assert(stored && stored.rawTransaction === raw);
                assert.equal(Transaction.from(raw).from, deviceWallet.address);
                result = keccak256(raw);
                break;
              }
              default:
                throw new Error('Unexpected test RPC ' + request.method);
            }
            return new Response(
              JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
              { headers: { 'content-type': 'application/json' } }
            );
          },
        });
        transfers = new NativeTransfers(f.owner, () => f.runtime.transfers, {
          rpc,
        });
        await transfers.prepare('0x' + '22'.repeat(20), '0.001', '7');
        const review = transfers.getSnapshot().review;
        assert(review);
        assert.equal(review.nonce, '7');
        assert.equal(f.signedCount, 0);
        if (changedChain)
          f.holdSignature(async () => {
            chainId = '0x2';
          });
        if (changedChain) {
          await assert.rejects(transfers.confirm(review.id, { method: 'pin', pin: password }), {
            code: 'FAILED',
          });
          assert.equal(transfers.getSnapshot().phase, 'unavailable');
        } else {
          await transfers.confirm(review.id, { method: 'pin', pin: password });
          assert.equal(transfers.getSnapshot().phase, 'pending');
        }
        assert.equal(f.signedCount, 1);
        assert.equal(broadcasts, changedChain ? 0 : 1);
        const savedHash = transfers.getSnapshot().hash!;
        if (f.owner.getSnapshot().phase === 'locked')
          await f.owner.unlock(password);
        const saved = await (
          await f.runtime.transfers!.journal(() => undefined)
        ).load(savedHash);
        assert(saved?.rawTransaction);
      } finally {
        transfers?.dispose();
        await f.close();
      }
    }
  );

test('cancellation during a Ledger prompt rejects its late signature', async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  try {
    await importAndConnect(f);
    f.holdSignature(async () => {
      entered.resolve();
      await release.promise;
    });
    const controller = new AbortController();
    const signed = signTestTransfer(f.runtime.transfers!, password,
      {
        type: 2,
        accessList: [],
        from: deviceWallet.address,
        to: '0x' + '22'.repeat(20),
        chainId: '1',
        nonce: '7',
        value: '123',
        gasLimit: '25200',
        data: '0x',
        maxFeePerGas: '3',
        maxPriorityFeePerGas: '1',
      },
      { assertCurrent() {}, signal: controller.signal }
    );
    void signed.catch(() => undefined);
    await entered.promise;
    controller.abort();
    release.resolve();
    await assert.rejects(signed, /CANCELLED|no longer current/);
  } finally {
    release.resolve();
    await f.close();
  }
});

test('Ledger UTXO review uses its saved xpub before connection and the shared signing path after consent', async () => {
  const f = await fixture();
  try {
    const network = getUtxoNetwork('bitcoin');
    await f.owner.selectNetwork(
      'bitcoin',
      f.owner.getSnapshot().revision,
      f.owner.getCatalogue()!.revision
    , () => {});
    await f.view.start();
    await f.view.select(f.view.getSnapshot().devices[0]!.id);
    await f.view.importAccount('Bitcoin Ledger');
    const account = f.owner
      .getCatalogue()!
      .accounts.find((value) => value.id === 'ledger:0:0')!;
    const bitcoin = syscoinUtils.bitcoinjs;
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32, 7), 0);
    previous.addOutput(
      bitcoin.address.toOutputScript(account.address, network.addressNetwork),
      100000n
    );
    const recipient = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 8),
      network: network.addressNetwork,
    }).address;
    let broadcasts = 0;
    f.setUtxoFetch(async (input, init) => {
      const url = String(input),
        route = url.slice(network.endpoint.length);
      let result: unknown;
      if (route === '/api/v2/') result = metadata(network);
      else if (route === '/api/v2/block-index/0')
        result = { blockHash: network.genesisHash };
      else if (route === '/api/v2/estimatefee/1')
        result = { result: '0.00001024' };
      else if (route.startsWith('/api/v2/xpub/')) result = { tokens: [] };
      else if (route.startsWith('/api/v2/utxo/'))
        result = [
          {
            txid: previous.getId(),
            vout: 0,
            value: '100000',
            address: account.address,
            confirmations: 10,
            path: "m/84'/0'/0'/0/0",
          },
        ];
      else if (route === '/api/v2/tx/' + previous.getId())
        result = { hex: previous.toHex() };
      else if (route === '/api/v2/sendtx/' && init?.method === 'POST') {
        const transaction = bitcoin.Transaction.fromHex(String(init.body));
        assert.equal(transaction.outs[0].value, 50000n);
        broadcasts++;
        result = { result: transaction.getId() };
      } else throw new Error('Unexpected UTXO fixture route ' + route);
      const response = Response.json(result);
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });
    assert.equal(f.connection.isConnected(), false);
    const send = await f.runtime.openUtxoSend!(() => undefined);
    const review = await send.prepare({ recipient, amount: '0.0005' });
    assert.equal(f.psbtSignCount, 0);
    await f.connection.start();
    await f.connection.select(f.connection.getSnapshot().devices[0]!.id);
    await f.connection.finishConnection();
    assert.equal(f.connection.isConnected(), true);
    assert.equal(f.psbtSignCount, 0);
    await send.confirm(review, { method: 'pin', pin: password });
    assert.equal(f.psbtSignCount, 1);
    assert.equal(broadcasts, 1);
    send.cancel();
  } finally {
    await f.close();
  }
});


test('Ledger signs the same reviewed ERC20 and collectible envelopes through the shared helper', async () => {
  const f = await fixture();
  try {
    await importAndConnect(f);
    const recipient = '0x' + '22'.repeat(20),
      contract = '0x' + '33'.repeat(20);
    const token = snapshotErc20TransferIntent({
      kind: 'erc20-transfer',
      chainId: '1',
      token: {
        contractAddress: contract,
        decimals: 6,
        name: 'Fixture token',
        symbol: 'FIX',
      },
      recipient,
      amountUnits: '9007199254740993',
    });
    const nft = (standard: 'ERC-721' | 'ERC-1155') =>
      snapshotNftTransferIntent({
        kind: 'nft-transfer',
        chainId: '1',
        from: deviceWallet.address,
        contractAddress: contract,
        recipient,
        tokenStandard: standard,
        tokenId: '9007199254740993',
        amountUnits: standard === 'ERC-721' ? '1' : '3',
      });
    const intents: readonly NativeAssetTransferIntent[] = [
      token,
      nft('ERC-721'),
      nft('ERC-1155'),
    ];
    for (const intent of intents) {
      const data =
        intent.kind === 'erc20-transfer'
          ? encodeErc20Transfer(intent.recipient, intent.amountUnits)
          : encodeNftTransferData(intent);
      const unsigned = {
        type: 2 as const,
        accessList: [],
        chainId: '1',
        from: deviceWallet.address,
        to: contract,
        value: '0',
        nonce: '8',
        gasLimit: '150000',
        data,
        maxFeePerGas: '3',
        maxPriorityFeePerGas: '1',
      };
      const signed = await signTestTransfer(f.runtime.transfers!, password,
        unsigned,
        { assertCurrent() {}, signal: new AbortController().signal },
        intent
      );
      const actual = Transaction.from(signed.rawTransaction);
      assert.equal(actual.data, data);
      assert.equal(actual.nonce, 8);
      assert.equal(actual.from, deviceWallet.address);
    }
    assert.equal(f.signedCount, 3);
  } finally {
    await f.close();
  }
});

test('real Ledger handoff forwards disconnect and ignores retired transport events after reconnect', async () => {
  const f = await fixture();
  try {
    await importAndConnect(f);
    const oldTransport = f.deviceStatus.at(-1)!;
    let updates = 0;
    const unsubscribe = f.connection.subscribe(() => {
      updates++;
    });
    const connectedSnapshot = f.connection.getSnapshot();
    oldTransport.disconnect();
    assert.equal(f.connection.isConnected(), false);
    assert.notEqual(f.connection.getSnapshot(), connectedSnapshot);
    assert.equal(updates, 1);
    await f.connection.start();
    await f.connection.select(f.connection.getSnapshot().devices[0]!.id);
    await f.connection.finishConnection();
    assert.equal(f.connection.isConnected(), true);
    const reconnectedSnapshot = f.connection.getSnapshot();
    const beforeOldEvent = updates;
    oldTransport.late();
    assert.equal(f.connection.isConnected(), true);
    assert.equal(f.connection.getSnapshot(), reconnectedSnapshot);
    assert.equal(updates, beforeOldEvent);
    f.deviceStatus.at(-1)!.disconnect();
    assert.equal(f.connection.isConnected(), false);
    assert.equal(updates, beforeOldEvent + 1);
    assert.equal(f.signedCount, 0);
    unsubscribe();
  } finally {
    await f.close();
  }
});

test('account-group transfer waits for a retired pending native Ledger creation', async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let switching: Promise<void> | undefined;
  let scanning: Promise<void> | undefined;
  try {
    f.holdCreation(() => {
      entered.resolve();
      return release.promise;
    });
    scanning = f.view.start();
    // Retirement may cancel the visible scan while the admitted factory drains.
    void scanning.catch(() => undefined);
    await entered.promise;
    let published = false;
    switching = f.owner
      .selectNetwork(
        'bitcoin',
        f.owner.getSnapshot().revision,
        f.owner.getCatalogue()!.revision
      , () => {})
      .then(() => {
        published = true;
      });
    for (let i = 0; i < 5; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.sessionTransfers, 0);
    assert.equal(published, false);
    assert.equal(f.owner.getSnapshot().phase, 'authenticating');
    release.resolve();
    await switching;
    await scanning.catch(() => undefined);
    assert.equal(f.disposedCount, 1);
    assert.equal(f.sessionTransfers, 1);
    assert.equal(f.owner.getCatalogue()!.active.networkId, 'bitcoin');
    assert.equal(f.owner.getSnapshot().phase, 'ready');
  } finally {
    release.resolve();
    await switching?.catch(() => undefined);
    await scanning?.catch(() => undefined);
    await f.close();
  }
});
