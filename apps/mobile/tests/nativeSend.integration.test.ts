import { operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { createTestCredentialPort } from './fixtures/credential.ts';
import { loadNativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { Interface } from 'ethers/abi';
import { createTestCredentialRecordKeyring } from './fixtures/credentialOperation.ts';
import {
  createKeyringRuntimeFactory,
  type KeyringRuntime,
} from '../src/custody/keyringRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { supportsRetainedSpeedUpIntent } from '../src/custody/sharedSignedRecords.ts';
import { NATIVE_PUBLIC_SESSION_KEY, captureNativePublicSessionRecord } from '../src/custody/publicSession.ts';
import type { TransferJournalEntry } from '../src/custody/transferJournal.ts';
import { EvmSignedRecords, inspectEvmSignedBundle } from '../../../source/wallet/evmSignedRecords.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const credentialPort = createTestCredentialPort();

process.env.NODE_ENV = 'production';
delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
delete process.env.SYSWEB3_PBKDF2_AUTH_ITERS;
// Custody revokes synchronously; quarantine is published after cleanup drains.
async function expectUnavailable(authority: NativeCustodyAuthority, action: () => Promise<unknown>): Promise<void> {
  let resolve!: () => void, reject!: (error: Error) => void;
  const unavailable = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  void unavailable.catch(() => undefined);
  const unsubscribe = authority.subscribe(snapshot => { if (snapshot.phase === 'unavailable') resolve(); });
  const timer = setTimeout(() => reject(Error('Custody did not publish quarantine')), 2000);
  try {
    await action();
    if (authority.getSnapshot().phase === 'unavailable') resolve();
    await unavailable;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN_CONTRACT = '0x5555555555555555555555555555555555555555';

function enableLegacyReplaySdk(transactions: object) {
  Object.defineProperty(transactions, 'supportsRetainedSpeedUpIntent', { value: false, configurable: true });
}

test('shared SDK and SQLite admit a different pending nonce and retain both signed entries across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-native-send-'));
  const file = path.join(directory, 'wallet.sqlite');
  const oldFetch = globalThis.fetch;
  let leakedNetwork = 0;
  let loseResponse = true;
  let pendingNonce = '0x0';
  const latestNonce = '0x0';
  globalThis.fetch = (async () => {
    leakedNetwork++;
    throw Error('Public network forbidden');
  }) as typeof fetch;
  let storage: SqliteWalletStorage | undefined;
  let runtime: KeyringRuntime | undefined;
  let authority: NativeCustodyAuthority | undefined;
  let transfers: NativeTransfers | undefined;
  const submitted: string[] = [];
  const sdk = await loadNativeKeyringSdk();
  class LegacyReplayKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
      enableLegacyReplaySdk(this.ethereumTransaction);
    }
  }
  const factory = createKeyringRuntimeFactory({ credentialPort, isAuthenticationActive: () => false, privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
    loadSdk: async () => ({ ...sdk, HostKeyring: LegacyReplayKeyring }),
    async ensureCryptoReady() {
      assert.ok(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      storage = await SqliteWalletStorage.open(
        nodeConnection(file).connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
  });
  const open = async () => {
    authority = new NativeCustodyAuthority({
      async open() {
        runtime = (await factory.open()) as KeyringRuntime;
        return runtime;
      },
    });
    await authority.initialize();
    const rpc = new NativeTransferRpc({
      networkId: 'ethereum',
      fetch: async function fixtureFetch(_url, init): Promise<Response> {
      const payload = JSON.parse(String(init.body));
      if (Array.isArray(payload)) return Response.json(await Promise.all(payload.map(async row =>
        (await fixtureFetch(_url, {...init, body: JSON.stringify(row)})).json())));
        const b = JSON.parse(String(init.body));
        let result: unknown;
        if (b.method === 'eth_chainId') result = '0x1';
        else if (b.method === 'eth_getTransactionCount') result = b.params[1] === 'pending' ? pendingNonce : latestNonce;
        else if (b.method === 'eth_getBalance') result = '0x10000000000000000';
        else if (b.method === 'eth_gasPrice') result = '0x2';
        else if (b.method === 'eth_feeHistory')
          result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
        else if (b.method === 'eth_maxPriorityFeePerGas') result = '0x1';
        else if (b.method === 'eth_estimateGas') result = '0x5208';
        else if (b.method === 'eth_getTransactionByHash') result = null;
        else if (b.method === 'eth_getTransactionReceipt') {
          result = null;
        }
        else if (b.method === 'eth_getBlockByNumber')
          result = {
            number: b.params[0] === 'latest' ? '0x20' : b.params[0],
            hash: '0x' + 'f'.repeat(64),
            baseFeePerGas: '0x1',
            gasLimit: '0x1c9c380',
          };
        else if (b.method === 'eth_sendRawTransaction') {
          const identity = await storage!.recovery.readIdentity();
          assert(identity?.root);
          const persisted = await storage!.signedRecords.read(
            identity.root.profileId
          );
          assert(persisted);
          const hash = keccak256(b.params[0]);
          const expectedRecords = new Set([...submitted, b.params[0]]).size;
          assert.equal(inspectEvmSignedBundle(persisted, identity.root.profileId).transactions, expectedRecords);
          const entry = await (
            await runtime!.transfers!.journal(() => undefined)
          ).load(hash);
          assert(entry && ['signed', 'submitted'].includes(entry.phase));
          assert.equal(entry.rawTransaction, b.params[0]);
          assert(
            !persisted.includes(b.params[0]),
            'physical bundle keeps wire bytes encrypted'
          );
          submitted.push(b.params[0]);
          if (loseResponse)
            throw Error('Lost response after network acceptance');
          result = keccak256(b.params[0]);
        } else throw Error('Unexpected method');
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: b.id, result }),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    });
    transfers = new NativeTransfers(authority, () => runtime?.transfers, {
      rpc,
    });
  };
  try {
    await open();
    await authority!.importPhrase(PHRASE);
    await runtime!.backup.confirm(await runtime!.backup.fingerprint());
    authority!.lock();
    await authority!.unlock();
    assert.equal(authority!.getSnapshot().phase, 'ready');
    await transfers!.prepare(RECIPIENT, '0.001');
    const review = transfers!.getSnapshot().review!;
    await transfers!.confirm(review.id, { method: 'device' });
    assert.equal(transfers!.getSnapshot().phase, 'unknown');
    const firstHash = transfers!.getSnapshot().hash;
    assert.equal(Transaction.from(submitted[0]!).to, RECIPIENT);
    assert.equal(Transaction.from(submitted[0]!).value, 1000000000000000n);
    await assert.rejects(transfers!.prepare(RECIPIENT, '0.002'), { code: 'PENDING_TRANSFER' });
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(submitted.length, 1);

    // The original still has no receipt, but the peer now knows its nonce.
    pendingNonce = '0x1';
    loseResponse = false;
    await transfers!.prepare(RECIPIENT, '0.002');
    const successor = transfers!.getSnapshot().review!;
    assert.equal(successor.nonce, '1');
    await transfers!.confirm(successor.id, { method: 'device' });
    const secondHash = transfers!.getSnapshot().hash!;
    assert.equal(transfers!.getSnapshot().phase, 'pending');
    assert.equal(submitted.length, 2);
    assert.deepEqual(submitted.map((raw) => Transaction.from(raw).nonce), [0, 1]);

    pendingNonce = '0x0';
    transfers!.dispose();
    await authority!.dispose();
    await open();
    await authority!.unlock();

    await assert.rejects(transfers!.prepare(RECIPIENT, '0.003'), { code: 'PENDING_TRANSFER' });
    assert.equal(transfers!.getSnapshot().hash, firstHash);
    assert.equal(submitted.length, 2);

    assert.equal((await (await runtime!.transfers!.journal(() => undefined)).load(firstHash!))?.rawTransaction, submitted[0]);
    const journal = await runtime!.transfers!.journal(() => undefined);
    assert.equal((await journal.load(secondHash))?.rawTransaction, submitted[1]);
    assert.equal(leakedNetwork, 0);
  } finally {
    transfers?.dispose();
    await authority?.dispose();
    globalThis.fetch = oldFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

async function cancellationFixture(type: 0 | 2 = 2, backupConfirmed = true, startWithLegacyCheckpoint = true) {
  const sdk = await loadNativeKeyringSdk();
  const directory = await mkdtemp(path.join(tmpdir(), 'pali-send-cancel-'));
  const file = path.join(directory, 'wallet.sqlite');
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  let signatures = 0;
  let afterSignature: (() => void) | undefined;
  let afterSignedInsert: (() => void) | undefined;
  const execution = { gas: '0x5208', reverts: false, feesUnavailable: false };
  const token = { balance: 9n, decimals: 0, paused: false };
  let authentications = 0;
  let authenticationStorageFailure = false, clockOffset = 0;
  let authenticationGate: { entered(): void; release: Promise<void> } | null = null;
  let hydrations = 0;
  const sdkInstances: InstanceType<typeof sdk.HostKeyring>[] = [];
  let journalGate: {
    phase: 'signed' | 'submitted' | 'confirmed';
    written: boolean;
    entered(): void;
    release: Promise<void>;
  } | null = null;
  let gate: {
    stage: 'storage-read' | 'requote' | 'cancellation-dispatch' | 'cancellation-original';
    entered(): void;
    release: Promise<void>;
  } | null = null;
  const pause = async (stage: NonNullable<typeof gate>['stage']) => {
    const current = gate;
    if (current?.stage === stage) {
      current.entered();
      await current.release;
    }
  };
  let featureAvailable = false, legacyCheckpoint = startWithLegacyCheckpoint;
  // Keep the real SDK signer and observe PIN admission separately from the
  // short-lived signing lease; public RPC work must not retain that lease.
  class ControlledKeyring extends sdk.HostKeyring {
    constructor(...options: ConstructorParameters<typeof sdk.HostKeyring>) {
      super(...options);
      sdkInstances.push(this);
      featureAvailable = supportsRetainedSpeedUpIntent(this.ethereumTransaction);
      if (legacyCheckpoint && featureAvailable)
        enableLegacyReplaySdk(this.ethereumTransaction);
      const hydrate = this.createFirstAccount;
      this.createFirstAccount = async (...args) => {
        hydrations++;
        const result = await hydrate(...args);
        return result;
      };
    }
    signPreparedEvmTransaction(
      ...args: Parameters<
        InstanceType<typeof sdk.HostKeyring>['signPreparedEvmTransaction']
      >
    ) {
      signatures++;
      const signed = super.signPreparedEvmTransaction(...args);
      afterSignature?.();
      return signed;
    }
  }
  const base = createKeyringRuntimeFactory({ credentialPort: { ...credentialPort,
    async withSecret(reference, owner, consume) {
      authentications++;
      const held = authenticationGate;
      if (held) { held.entered(); await held.release; }
      if (authenticationStorageFailure) throw Error('Synthetic authentication storage failure');
      return credentialPort.withSecret(reference, owner, consume);
    },
    async authorize(reference, owner) {
      authentications++;
      const held = authenticationGate;
      if (held) { held.entered(); await held.release; }
      if (authenticationStorageFailure) throw Error('Synthetic authentication storage failure');
      return credentialPort.authorize(reference, owner);
    },
  }, isAuthenticationActive: () => false, privacyServiceSettings: null, passkeys: null, slhExecution: null, readEvmRetirement: null,
    async observeActivity(_network, expected, signal, guard) {
      guard();
      const result = await rpc.observation(
        {
          hash: expected.hash,
          from: expected.from,
          to: expected.to,
          nonce: expected.nonce,
        },
        signal
      );
      guard();
      return result;
    },
    async ensureCryptoReady() {
      assert.ok(globalThis.crypto.subtle);
    },
    async openStorage() {
      const fresh = !existsSync(file);
      let native!: ReturnType<typeof nodeConnection>;
      native = nodeConnection(file, {
        after: async (kind, sql) => {
          if (kind === 'all' && sql.includes('FROM evm_signed_records'))
            await pause('storage-read');
          if (kind === 'run' && sql.startsWith('INSERT INTO evm_signed_records') && afterSignedInsert) {
            const observeInsert = afterSignedInsert;
            afterSignedInsert = undefined;
            observeInsert();
          }
          const current = journalGate;
          if (!current) return;
          if (
            kind === 'run' &&
            sql.startsWith('INSERT INTO evm_signed_records')
          ) {
            const row = native.database
              .prepare('SELECT value FROM evm_signed_records')
              .get() as { value: string };
            const value = JSON.parse(row.value) as {
              entries: { phase: string }[];
            };
            current.written = value.entries.some(
              (entry) => entry.phase === current.phase
            );
          }
          if (current.written && kind === 'exec' && sql === 'COMMIT') {
            current.entered();
            await current.release;
            throw Error('Lost signed-bundle commit acknowledgement');
          }
        },
      });
      storage = await SqliteWalletStorage.open(
        native.connection,
        digest,
        INSTALLATION,
        fresh
      );
      return storage;
    },
    loadSdk: async () => ({ ...sdk, HostKeyring: ControlledKeyring }),
  });
  const createAuthority = () =>
    new NativeCustodyAuthority({
      async open() {
        runtime = (await base.open()) as KeyringRuntime;
        return runtime;
      },
    });
  let authority = createAuthority();
  const broadcasts: string[] = [];
  let loseResponse = false;
  let nativeBalance = '0x10000000000000000';
  let pendingBalance: string | undefined;
  let ownsNft = true;
  const replacement = { pending: false, delegated: false, baseFee: '0x1', substituteHash: undefined as string | undefined };
  const largeReceipt = {
    oversized: false,
    repeated: false,
    receiptReads: 0,
    consumed: false,
  };
  let recovery:
    | {
        receipt: Record<string, unknown> | null;
        nonce: string;
        canonicalHash: string;
      }
    | undefined;
  let httpRequests = 0;
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = new NativeTransferRpc({
    networkId: 'ethereum',
    fetch: async function fixtureFetch(_url, init, member = false): Promise<Response> {
      if (!member) httpRequests++;
      const payload = JSON.parse(String(init.body));
      if (Array.isArray(payload)) return Response.json(await Promise.all(payload.map(async row =>
        (await fixtureFetch(_url, {...init, body: JSON.stringify(row)}, true)).json())));
      const request = JSON.parse(String(init.body));
      requests.push(request);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getTransactionByHash') {
        if (signatures > 1) await pause('cancellation-original');
        const matched = broadcasts.find(raw => Transaction.from(raw).hash === request.params[0]);
        const tx = matched && Transaction.from(matched);
        result = replacement.pending && tx && tx.hash === request.params[0]
          ? { hash: replacement.substituteHash ?? tx.hash, from: tx.from, to: tx.to, value: `0x${tx.value.toString(16)}`,
              nonce: `0x${tx.nonce.toString(16)}`, blockNumber: null, blockHash: null, transactionIndex: null }
          : null;
      } else if (request.method === 'eth_getCode') {
        if (signatures > 1 && request.params[1] === 'pending') await pause('cancellation-dispatch');
        result = [TOKEN_CONTRACT, RECIPIENT].includes(request.params[0].toLowerCase()) ? '0x6000' : replacement.delegated ? `0xef0100${'33'.repeat(20)}` : '0x';
      }
      else if (request.method === 'eth_getTransactionCount') {
        result = largeReceipt.oversized
          ? request.params[1] === 'pending' ||
            largeReceipt.consumed ||
            (largeReceipt.repeated && largeReceipt.receiptReads === 1)
            ? '0x1'
            : '0x0'
          : recovery?.nonce ?? '0x0';
      } else if (request.method === 'eth_getBalance')
        result = request.params[1] === 'pending' ? pendingBalance ?? nativeBalance : nativeBalance;
      else if (['eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory'].includes(request.method) && execution.feesUnavailable)
        throw Error('Recommendation unavailable');
      else if (request.method === 'eth_call') {
        const data = request.params[0].data;
        if (data.startsWith('0xa9059cbb') && token.paused) return Response.json({ jsonrpc: '2.0', id: request.id,
          error: { code: 3, message: 'execution reverted: paused', data: '0x' } });
        if (['0x23b872dd', '0xf242432a', '0x42842e0e', '0xb88d4fde'].some(selector => data.startsWith(selector))) result = '0x';
        else if (data.startsWith('0x6352211e')) {
          if (BigInt('0x' + data.slice(10)) !== 7n) return Response.json({ jsonrpc: '2.0', id: request.id,
            error: { code: 3, message: 'execution reverted', data: '0x' } });
          result = '0x' + (ownsNft ? Wallet.fromPhrase(PHRASE).address : '0x' + '99'.repeat(20)).slice(2).toLowerCase().padStart(64, '0');
        } else if (data.startsWith('0x4e1273f4')) {
          result = new Interface(['function balanceOfBatch(address[],uint256[]) view returns(uint256[])'])
            .encodeFunctionResult('balanceOfBatch', [[2n]]);
        } else result = '0x' + BigInt(data === '0x313ce567' ? token.decimals : data.startsWith('0x70a08231') ? token.balance : data.startsWith('0x00fdd58e') ? 0 : 1).toString(16).padStart(64, '0');
      }
      else if (request.method === 'eth_gasPrice') result = '0x2';
      else if (request.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', '0x1'] };
      else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (request.method === 'eth_estimateGas') {
        await pause('requote');
        if (execution.reverts) return Response.json({ jsonrpc: '2.0', id: request.id,
          error: { code: 3, message: 'execution reverted', data: '0x' } });
        result = execution.gas;
      } else if (request.method === 'eth_getTransactionReceipt') {
        if (!largeReceipt.oversized) result = recovery?.receipt ?? null;
        else {
          largeReceipt.receiptReads++;
          const tx = Transaction.from(broadcasts[0]!);
          result = {
            transactionHash: tx.hash,
            from: tx.from,
            to: tx.to,
            status: '0x1',
            blockNumber: '0xa',
            blockHash: '0x' + '8'.repeat(64),
            ...(largeReceipt.repeated && largeReceipt.receiptReads === 1
              ? {}
              : {
                  logs: [
                    {
                      address: tx.to,
                      topics: [],
                      // Exceed the shared reader's 1 MiB receipt budget.
                      data: '0x' + 'ab'.repeat(1024 * 1024),
                    },
                  ],
                }),
          };
        }
      } else if (request.method === 'eth_getBlockByNumber') {
        if (largeReceipt.oversized) {
          assert(
            !['finalized', 'safe'].includes(request.params[0]),
            'ordinary sends never request a settlement tag'
          );
          const number = request.params[0];
          result = {
            number: number === 'latest' ? '0x20' : number,
            hash: '0x' + (number === '0xa' ? '8' : '9').repeat(64),
            ...(type === 2 ? { baseFeePerGas: replacement.baseFee } : {}),
            gasLimit: '0x1c9c380',
          };
        } else {
          const current = recovery;
          assert(
            !['finalized', 'safe'].includes(request.params[0]),
            'ordinary sends never request a settlement tag'
          );
          const number = request.params[0];
          result = {
            number: number === 'latest' ? '0x20' : number,
            hash:
              current && number === current.receipt?.blockNumber
                ? current.canonicalHash
                : '0x' + 'f'.repeat(64),
            ...(type === 2 ? { baseFeePerGas: replacement.baseFee } : {}),
            gasLimit: '0x1c9c380',
          };
        }
      } else if (request.method === 'eth_sendRawTransaction') {
        broadcasts.push(request.params[0]);
        if (loseResponse) throw Error('Lost acknowledgement');
        result = keccak256(request.params[0]);
      } else throw Error('Unexpected method');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  let transfers = new NativeTransfers(authority, () => runtime?.transfers, {
    rpc, now: () => performance.now() + clockOffset,
  });
  try {
    await authority.initialize();
    await authority.importPhrase(PHRASE);
    if (backupConfirmed) await runtime.backup.confirm(await runtime.backup.fingerprint());
    authority.lock();
    await authority.unlock();
  } catch (error) {
    transfers.dispose();
    await authority.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    get authority() {
      return authority;
    },
    get runtime() {
      return runtime;
    },
    broadcasts,
    async seedOriginal(input: { to: string | null; data: string; operation?: 'send' | 'erc20' | 'erc721' | 'erc1155'; accessList?: { address: string; storageKeys: string[] }[]; metadata?: Readonly<Record<string, unknown>> }) {
      const wallet = Wallet.fromPhrase(PHRASE);
      const selected = runtime.catalogue.getSnapshot()!.accounts.find(account => account.id === runtime.catalogue.getSnapshot()!.active.accountId)!;
      assert.equal(wallet.address, selected.address);
      const rawTransaction = await wallet.signTransaction({ type, chainId: 1, nonce: 0, to: input.to, value: 0,
        data: input.data, gasLimit: 100_000, ...(type === 2 ? { maxFeePerGas: 2, maxPriorityFeePerGas: 1, accessList: input.accessList ?? [] } : { gasPrice: 2 }) });
      const tx = Transaction.from(rawTransaction);
      const ring = sdkInstances.find(instance => instance.hasPublicSession())!;
      assert(ring);
      const session = { keyring: createTestCredentialRecordKeyring(storage.credential, credentialPort, ring, () => assert(ring.hasPublicSession())), assertCurrent: () => assert(ring.hasPublicSession()) };
      const records = new EvmSignedRecords(storage.signedRecords);
      await records.append(session, { rawTransaction, hash: tx.hash!, from: tx.from!, chainId: '1', nonce: 0, type,
        context: { account: { id: selected.index, type: selected.type, address: selected.address }, network: { kind: 'ethereum', chainId: 1, slip44: 60, url: 'https://ethereum-rpc.publicnode.com' }, operation: input.operation ?? 'send' } }, input.metadata);
      await records.updatePhase(session, '1', tx.from!, tx.hash!, 'submitted');
      broadcasts.push(rawTransaction);
      replacement.pending = true;
      return tx;
    },
    setBalance(value: bigint) { nativeBalance = `0x${value.toString(16)}`; },
    setPendingBalance(value: bigint) { pendingBalance = `0x${value.toString(16)}`; },
    loseNft() { ownsNft = false; },
    execution, token,
    onSignature(callback: () => void) { afterSignature = callback; },
    onSignedInsert(callback: () => void) { afterSignedInsert = callback; },
    recovery: largeReceipt,
    requests,
    get httpRequests() { return httpRequests; },
    replacement,
    get transfers() {
      return transfers;
    },
    rpc,
    get signatures() {
      return signatures;
    },
    get authentications() {
      return authentications;
    },
    get hydrations() {
      return hydrations;
    },
    enableInstalledSpeedUp() { legacyCheckpoint = false; return featureAvailable; },
    async checkpointVersion() { return captureNativePublicSessionRecord(await storage.keyringStorage.get(NATIVE_PUBLIC_SESSION_KEY)).version; },
    get unsignedSpeedUpSupported() {
      const keyring = sdkInstances.find(instance => instance.hasPublicSession());
      return !!keyring && supportsRetainedSpeedUpIntent(keyring.ethereumTransaction);
    },
    get sdkUnlocked() {
      return sdkInstances.some((instance) => instance.isUnlocked());
    },
    get sdkPublic() { return sdkInstances.some(instance => instance.hasPublicSession()); },
    expireReview() { clockOffset += 100_000; },
    failAuthenticationStorage() { authenticationStorageFailure = true; },
    holdAuthentication() {
      let entered!: () => void, resume!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const release = new Promise<void>(resolve => { resume = resolve; });
      authenticationGate = { entered, release };
      return { started, finish() { authenticationGate = null; resume(); } };
    },
    holdJournal(phase: 'signed' | 'submitted' | 'confirmed') {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      journalGate = { phase, written: false, entered, release };
      return {
        started,
        finish() {
          journalGate = null;
          resume();
        },
      };
    },
    async readDurableJournal() {
      // Observe durable bytes independently of the quarantined runtime port.
      const { DatabaseSync } = await import('node:sqlite');
      const observer = new DatabaseSync(file, { readOnly: true });
      try {
        const row = observer
          .prepare('SELECT value FROM evm_signed_records')
          .get() as { value: string } | undefined;
        if (row) inspectEvmSignedBundle(row.value);
        return row?.value;
      } finally {
        observer.close();
      }
    },
    loseResponse() {
      loseResponse = true;
    },
    setRecovery(value: NonNullable<typeof recovery>) {
      recovery = structuredClone(value);
    },
    hold(stage: NonNullable<typeof gate>['stage']) {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      gate = { stage, entered, release };
      return {
        started,
        finish() {
          gate = null;
          resume();
        },
      };
    },
    replaceTransfers() {
      transfers = new NativeTransfers(authority, () => runtime.transfers, {
        rpc,
      });
    },
    async reopenAfterQuarantine() {
      transfers.dispose();
      await assert.rejects(authority.dispose(), { code: 'CLEANUP_FAILED' });
      authority = createAuthority();
      await authority.initialize();
      await authority.unlock();
      transfers = new NativeTransfers(authority, () => runtime.transfers, { rpc });
    },
    async reopen() {
      transfers.dispose();
      await authority.dispose();
      authority = createAuthority();
      await authority.initialize();
      await authority.unlock();
      transfers = new NativeTransfers(authority, () => runtime.transfers, {
        rpc,
      });
    },
    async observeSaved(hash?: string) {
      const activity = runtime.activity!;
      const { locals } = await activity.load(() => undefined);
      const selected = hash ?? (await (await runtime.transfers!.journal(() => undefined)).load())?.hash;
      const local = locals.find(row => row.hash === selected);
      assert(local);
      return activity.observeLocal!(local, () => undefined, new AbortController().signal);
    },
    async readJournal() {
      return (
        (await (await runtime.transfers!.journal(() => undefined)).load()) ??
        undefined
      );
    },
    async close() {
      transfers.dispose();
      try {
        await authority.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test('an unconfirmed wallet can review and send only after fresh OS credential approval', async () => {
  const f = await cancellationFixture(2, false);
  let held: ReturnType<typeof f.holdAuthentication> | undefined;
  try {
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.authority.getSnapshot().backup, 'unconfirmed');
    await f.transfers.prepare(RECIPIENT, '0.001');
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 0);
    assert.equal(f.sdkUnlocked, false);
    held = f.holdAuthentication();
    const pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    await held.started;
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 0);
    held.finish(); await pending;
    assert.equal(f.signatures, 1); assert.equal(f.broadcasts.length, 1);
    assert.equal(f.sdkUnlocked, false);
    assert.equal(f.authority.getSnapshot().backup, 'unconfirmed');
    assert.deepEqual(await f.runtime.storage.readState(), { presence: 'existing', backup: 'unconfirmed' });
  } finally { held?.finish(); await f.close(); }
});

for (const fault of ['expiry', 'storage'] as const) test(`real SDK authentication ${fault} retires public custody once without signing`, async () => {
  const f = await cancellationFixture();
  let held: ReturnType<typeof f.holdAuthentication> | undefined;
  let unsubscribe = () => {};
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    let locks = 0;
    unsubscribe = f.authority.subscribe(state => { if (state.phase === 'locked') locks++; });
    if (fault === 'expiry') held = f.holdAuthentication();
    else f.failAuthenticationStorage();
    const pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    if (held) { await held.started; f.expireReview(); held.finish(); }
    await rejected;
    assert.equal(locks, 1); assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.authority.getSnapshot().account, null); assert.equal(f.sdkUnlocked, false);
    assert.equal(f.transfers.getSnapshot().review, null); assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 0);
    assert.equal(await f.readDurableJournal(), undefined);
  } finally { held?.finish(); unsubscribe(); await f.close(); }
});


test('queued pending cancellation reports the earlier nonce without signing', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001', '1');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'CANCELLATION_QUEUED' });
    assert.equal(f.transfers.getSnapshot().message,
      'This cancellation must wait for earlier transactions. Check Activity before trying again.');
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    await f.close();
  }
});

async function prepareSavedCancellation(f: Awaited<ReturnType<typeof cancellationFixture>>) {
  await f.transfers.prepare(RECIPIENT, '0.001');
  await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
  const originalHash = f.transfers.getSnapshot().hash!;
  f.replacement.pending = true;
  await f.transfers.prepareCancellation(originalHash);
  return { originalHash, review: f.transfers.getSnapshot().review! };
}

test('an acknowledged ordinary send can be followed by the next nonce while pending RPC lags', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    assert.equal(f.transfers.getSnapshot().phase, 'pending');

    // The same captured endpoint still reports zero for both counts and has
    // no by-hash sighting. Its exact POST acknowledgement bridges this lag.
    await f.transfers.prepare(RECIPIENT, '0.002');
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.nonce, '1');
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [0, 1]);
    const saved = JSON.parse((await f.readDurableJournal())!);
    assert.deepEqual(saved.entries.map((entry: { hash: string }) => entry.hash), f.broadcasts.map((raw) => keccak256(raw)));
  } finally {
    await f.close();
  }
});

for (const type of [0, 2] as const) test(`native type ${type} unsigned Speed Up follows the installed SDK capability`, async () => {
  const f = await cancellationFixture(type, true, false);
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const original = Transaction.from(f.broadcasts[0]!);
    const initial = JSON.parse((await f.readDurableJournal())!);
    const local = (await f.runtime.activity!.load(() => undefined)).locals.find(row => row.hash === original.hash);
    assert(local);
    if (!f.unsignedSpeedUpSupported) {
      assert.equal(initial.entries[0].payloadKind, undefined);
      assert.equal(local.unsignedSpeedUp, undefined);
      await assert.rejects(f.transfers.prepareSpeedUp(original.hash!), { code: 'EXPIRED' });
      assert.equal(f.broadcasts.length, 1);
      return;
    }
    assert.equal(initial.entries[0].payloadKind, 'unsigned-eoa');
    assert.equal(local.unsignedSpeedUp, true);
    assert.equal(local.cancellationUnavailable, true);
    assert.equal((await f.readJournal())?.rawTransaction, undefined);
    await assert.rejects(f.transfers.prepareCancellation(original.hash!));
    await f.transfers.prepareSpeedUp(original.hash!);
    let review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.originalHash, original.hash);
    assert.equal(review.nonce, String(original.nonce));
    assert.equal(BigInt(review.gasLimit), original.gasLimit);
    assert.equal(f.signatures, 1);
    f.execution.gas = `0x${(original.gasLimit + 1n).toString(16)}`;
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }));
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    f.execution.gas = '0x5208';
    await f.transfers.prepareSpeedUp(original.hash!);
    review = f.transfers.getSnapshot().review!;
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    const replacement = Transaction.from(f.broadcasts[1]!);
    for (const field of ['from', 'to', 'value', 'nonce', 'type', 'gasLimit', 'data'] as const)
      assert.equal(replacement[field], original[field]);
    assert((replacement.maxFeePerGas ?? replacement.gasPrice!) > (original.maxFeePerGas ?? original.gasPrice!));
    const journal = JSON.parse((await f.readDurableJournal())!);
    assert.equal(journal.entries[1].payloadKind, 'unsigned-eoa');
    assert.equal(journal.entries[1].originalHash, original.hash);
    f.setRecovery({ receipt: null, nonce: '0x1', canonicalHash: `0x${'f'.repeat(64)}` });
    await assert.rejects(f.transfers.prepareSpeedUp(replacement.hash!));
    assert.equal(f.broadcasts.length, 2);
  } finally { await f.close(); }
});

for (const type of [0, 2] as const) test(`unsigned retained type ${type} cancellation requires a pending original and sends a higher-fee empty self-call`, async () => {
  const f = await cancellationFixture(type, true, false);
  try {
    assert(f.unsignedSpeedUpSupported);
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const original = Transaction.from(f.broadcasts[0]!);
    assert.equal((await f.readJournal())?.rawTransaction, undefined);
    await assert.rejects(f.transfers.prepareCancellation(original.hash!), { code: 'EXPIRED' });
    await assert.rejects(f.transfers.prepareSavedCancellation(original.hash!), { code: 'EXPIRED' });
    assert.equal(f.signatures, 1);
    f.replacement.pending = true;
    await f.transfers.prepareCancellation(original.hash!);
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.originalHash, original.hash);
    assert.equal(review.nonce, String(original.nonce));
    assert.equal(review.recipient, original.from);
    assert.equal(review.amountUnits, '0');
    assert.equal(review.gasLimit, '42000');
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    const cancellation = Transaction.from(f.broadcasts[1]!);
    assert.deepEqual([cancellation.from, cancellation.to, cancellation.type, cancellation.nonce,
      cancellation.value, cancellation.data, cancellation.gasLimit],
    [original.from, original.from, original.type, original.nonce, 0n, '0x', 42000n]);
    assert((cancellation.maxFeePerGas ?? cancellation.gasPrice!) > (original.maxFeePerGas ?? original.gasPrice!));
    const journal = JSON.parse((await f.readDurableJournal())!);
    assert.equal(journal.entries[0].payloadKind, 'unsigned-eoa');
    assert.equal(journal.entries[1].operation, 'cancel');
    assert.equal(journal.entries[1].originalHash, original.hash);
  } finally { await f.close(); }
});

for (const boundary of ['confirmation', 'broadcast'] as const) test(`unsigned retained cancellation stops when the original disappears at ${boundary}`, async () => {
  const f = await cancellationFixture(2, true, false);
  try {
    assert(f.unsignedSpeedUpSupported);
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    f.replacement.pending = true;
    const originalHash = f.transfers.getSnapshot().hash!;
    await f.transfers.prepareCancellation(originalHash);
    const review = f.transfers.getSnapshot().review!;
    if (boundary === 'confirmation') f.replacement.pending = false;
    else f.onSignedInsert(() => { f.replacement.pending = false; });
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'EXPIRED' });
    assert.equal(f.signatures, boundary === 'confirmation' ? 1 : 2);
    assert.equal(f.broadcasts.length, 1);
  } finally { await f.close(); }
});

for (const kind of ['contract', 'erc20', 'erc721', 'erc1155'] as const) test(`signature-free ${kind} Speed Up retains the exact execution without node history`, async () => {
  const f = await cancellationFixture(2, true, false);
  try {
    assert.equal(f.unsignedSpeedUpSupported, true);
    const from = Wallet.fromPhrase(PHRASE).address;
    const to = kind === 'contract' ? RECIPIENT : TOKEN_CONTRACT;
    const call = kind === 'erc20' ? ['transfer(address,uint256)', [RECIPIENT, 1]] as const
      : kind === 'erc721' ? ['transferFrom(address,address,uint256)', [from, RECIPIENT, 7]] as const
      : kind === 'erc1155' ? ['safeTransferFrom(address,address,uint256,uint256,bytes)', [from, RECIPIENT, 7, 1, '0x']] as const
      : undefined;
    const data = call ? new Interface([`function ${call[0]}`]).encodeFunctionData(call[0], [...call[1]]) : '0x12345678';
    const intent = { kind: 'erc20-transfer' as const, chainId: '1', recipient: RECIPIENT, amountUnits: '1',
      token: { contractAddress: TOKEN_CONTRACT, symbol: 'FIX', name: 'Fixture', decimals: 0 } };
    const original = await f.seedOriginal({ to, data, operation: kind === 'contract' ? 'send' : kind,
      ...(kind === 'erc20' ? { metadata: { intent } } : {}) });
    f.replacement.pending = false;
    await f.reopen();
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries[0].payloadKind, 'unsigned-eoa');
    assert.equal((await f.readJournal())?.rawTransaction, undefined);
    await f.transfers.prepareSpeedUp(original.hash!);
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.originalHash, original.hash);
    assert.equal(review.recipient, RECIPIENT);
    if (kind === 'erc20') assert.deepEqual(review.intent, intent);
    if (kind === 'erc721' || kind === 'erc1155') assert.equal(review.collectible?.tokenId, '7');
    assert.equal(review.execution?.kind, 'contract-call');
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    const replaced = Transaction.from(f.broadcasts[1]!);
    for (const field of ['from', 'to', 'value', 'data', 'nonce', 'type', 'gasLimit'] as const)
      assert.equal(replaced[field], original[field]);
    assert.deepEqual(replaced.accessList, original.accessList);
    assert(replaced.maxFeePerGas! > original.maxFeePerGas!);
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries[1].payloadKind, 'unsigned-eoa');
    await f.transfers.prepareSpeedUp(replaced.hash!);
    const next = f.transfers.getSnapshot().review!;
    if (kind === 'erc20') {
      f.token.balance = 0n;
      await assert.rejects(f.transfers.confirm(next.id, { method: 'device' }), { code: 'INSUFFICIENT_TOKEN_BALANCE' });
    } else if (kind === 'erc721') {
      f.loseNft();
      await assert.rejects(f.transfers.confirm(next.id, { method: 'device' }), { code: 'INSUFFICIENT_NFT_BALANCE' });
    } else if (kind === 'contract') {
      f.execution.reverts = true;
      await assert.rejects(f.transfers.confirm(next.id, { method: 'device' }), { code: 'EXPIRED' });
    }
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 2);
  } finally { await f.close(); }
});

test('unlock migrates signed native history only when the installed SDK supports unsigned Speed Up', async () => {
  const f = await cancellationFixture(2, true, false);
  try {
    const original = await f.seedOriginal({ to: RECIPIENT, data: '0x' });
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries[0].payloadKind, undefined);
    await f.reopen();
    const expected = f.unsignedSpeedUpSupported ? 'unsigned-eoa' : undefined;
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries[0].payloadKind, expected);
    assert.equal((await f.readJournal())?.rawTransaction, expected ? undefined : original.serialized);
  } finally { await f.close(); }
});

test('legacy mobile checkpoints keep signing and upgrade inside the first authorized software send', async () => {
  const f = await cancellationFixture(2, true, true);
  try {
    assert.equal(await f.checkpointVersion(), 1);
    const original = await f.seedOriginal({ to: RECIPIENT, data: '0x' });
    const available = f.enableInstalledSpeedUp();
    await f.reopen();
    assert.equal(await f.checkpointVersion(), 1);
    await f.transfers.prepareSpeedUp(original.hash!);
    const signedReview = f.transfers.getSnapshot().review!;
    await f.transfers.confirm(signedReview.id, { method: 'device' });
    assert.equal(await f.checkpointVersion(), 1);
    assert.equal((await f.readJournal())?.rawTransaction, f.broadcasts[1]);
    f.replacement.pending = false;
    f.setRecovery({ receipt: null, nonce: '0x1', canonicalHash: `0x${'f'.repeat(64)}` });
    await f.transfers.prepare(RECIPIENT, '0.001');
    const beforeAuthentication = f.authentications;
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    assert.equal(f.authentications, beforeAuthentication + 1);
    assert.equal(f.broadcasts.length, 3);
    assert.equal(await f.checkpointVersion(), available ? 2 : 1);
    await f.reopen();
    const retained = await f.readJournal();
    assert.equal(retained?.rawTransaction, available ? undefined : f.broadcasts[2]);
    if (available) {
      await f.transfers.prepareSpeedUp(Transaction.from(f.broadcasts[2]!).hash!);
      assert(f.transfers.getSnapshot().review?.replacement);
    }
  } finally { await f.close(); }
});

test('private-note records do not offer an unsupported ordinary fee replacement', async () => {
  const f = await cancellationFixture();
  try {
    await f.seedOriginal({ to: RECIPIENT, data: '0x12345678', metadata: { privateDeposit: { id: 'fixture' } } });
    const local = (await f.runtime.activity!.load(() => undefined)).locals[0]!;
    assert.equal(local.speedUpEligible, undefined);
    await assert.rejects(f.transfers.prepareSpeedUp(local.hash));
    assert.equal(f.signatures, 0);
  } finally { await f.close(); }
});

for (const scenario of ['contract-call', 'contract-creation', 'access-list', 'erc721', 'erc1155', 'erc20-transferFrom'] as const) {
  test(`Speed Up preserves the complete ${scenario} envelope through the real SDK`, async () => {
    const f = await cancellationFixture();
    try {
      const sender = Wallet.fromPhrase(PHRASE).address;
      const data = scenario === 'erc721' || scenario === 'erc20-transferFrom'
        ? new Interface(['function transferFrom(address,address,uint256)']).encodeFunctionData('transferFrom', [sender, RECIPIENT, 7])
        : scenario === 'erc1155'
        ? new Interface(['function safeTransferFrom(address,address,uint256,uint256,bytes)']).encodeFunctionData('safeTransferFrom', [sender, RECIPIENT, 7, 2, '0x'])
        : `0x${'ab'.repeat(scenario === 'contract-creation' ? 5000 : 32)}`;
      const original = await f.seedOriginal({ to: scenario === 'contract-creation' ? null : RECIPIENT, data,
        ...(scenario === 'erc721' || scenario === 'erc1155' ? { operation: scenario } : {}),
        ...(scenario === 'erc20-transferFrom' ? { metadata: { nftTransfer: { kind: 'nft-transfer', chainId: '1', from: sender,
          contractAddress: RECIPIENT, recipient: RECIPIENT, tokenStandard: 'ERC-721', tokenId: '7', amountUnits: '1' } } } : {}),
        ...(scenario === 'access-list' ? { accessList: [{ address: RECIPIENT, storageKeys: [`0x${'01'.repeat(32)}`] }] } : {}) });
      await f.transfers.prepareSpeedUp(original.hash!);
      const review = f.transfers.getSnapshot().review;
      assert(review, JSON.stringify(f.transfers.getSnapshot()));
      assert.equal(review.execution?.kind, scenario === 'contract-creation' ? 'contract-creation' : 'contract-call');
      if (scenario === 'erc721' || scenario === 'erc1155') {
        assert.equal(review.collectible?.tokenId, '7');
        assert.equal(review.collectible?.recipient, RECIPIENT);
      }
      await f.transfers.confirm(review.id, { method: 'device' });
      assert.equal(f.transfers.getSnapshot().phase, 'pending', JSON.stringify(f.transfers.getSnapshot()));
      assert.equal(f.broadcasts.length, 2);
      const replacement = Transaction.from(f.broadcasts[1]!);
      for (const field of ['to', 'from', 'value', 'data', 'nonce', 'type'] as const)
        assert.deepEqual(replacement[field], original[field], field);
      assert(replacement.gasLimit >= original.gasLimit);
      assert.deepEqual(replacement.accessList, original.accessList);
      assert(replacement.maxFeePerGas! > original.maxFeePerGas!);
      const bundle = JSON.parse((await f.readDurableJournal())!);
      assert.equal(bundle.entries[1].originalHash, original.hash);
      assert.equal(bundle.entries[1].operation, 'speed-up');
      await f.transfers.prepareSpeedUp(replacement.hash!);
      const next = f.transfers.getSnapshot().review!;
      if (scenario === 'erc721' || scenario === 'erc1155') {
        assert.equal(next.collectible?.tokenId, '7');
        assert.equal(next.collectible?.recipient, RECIPIENT);
      } else assert.equal(next.collectible, undefined, 'opaque and ERC20 transferFrom call bytes must not be classified as NFTs');
    } finally { await f.close(); }
  });
}

for (const type of [0, 2] as const) {
  test(`Speed Up type ${type} retains execution and saves linked exact bytes before POST`, async () => {
    const f = await cancellationFixture(type);
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      const originalHash = f.transfers.getSnapshot().hash!;
      const original = Transaction.from(f.broadcasts[0]!);
      f.replacement.pending = true;
      await f.transfers.prepareSpeedUp(originalHash);
      const review = f.transfers.getSnapshot().review!;
      assert.equal(review.replacement?.mode, 'speed-up');
      assert.equal(review.replacement?.originalHash, originalHash);
      assert.equal(review.recipient, RECIPIENT);
      assert.equal(review.amountUnits, original.value.toString());
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
      const originalFee = original.gasPrice ?? original.maxFeePerGas!;
      assert.equal(review.replacement?.originalMaximumFeeUnits, (original.gasLimit * originalFee).toString());
      assert(BigInt(review.maximumFeeUnits) > original.gasLimit * originalFee);
      const gate = f.hold('cancellation-original');
      const submit = f.transfers.confirm(review.id, { method: 'device' });
      try {
        await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
        assert.equal(f.broadcasts.length, 1);
        const stored = JSON.parse((await f.readDurableJournal())!);
        assert.equal(stored.entries.length, 2);
        assert.equal(stored.entries[1].operation, 'speed-up');
        assert.equal(stored.entries[1].originalHash, originalHash);
      } finally {
        gate.finish();
        await submit;
      }
      assert.equal(f.broadcasts.length, 2);
      const replaced = Transaction.from(f.broadcasts[1]!);
      assert.deepEqual([replaced.from, replaced.to, replaced.value, replaced.nonce, replaced.data, replaced.type],
        [original.from, original.to, original.value, original.nonce, original.data, type]);
      assert.equal(replaced.gasLimit * (replaced.gasPrice ?? replaced.maxFeePerGas!), BigInt(review.maximumFeeUnits));
      await f.reopen();
      const journal = await f.runtime.transfers!.journal(() => undefined);
      assert.equal((await journal.load(originalHash))?.rawTransaction, f.broadcasts[0]);
      assert.equal((await journal.load(replaced.hash!))?.rawTransaction, f.broadcasts[1]);
      await assert.rejects(f.transfers.prepareSpeedUp(originalHash), { code: 'EXPIRED' });
    } finally { await f.close(); }
  });
}

test('Speed Up refuses POST when the saved original disappears after the new signature is persisted', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(originalHash);
    const gate = f.hold('cancellation-original');
    const refused = assert.rejects(f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' }), { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.pending = false;
    } finally {
      gate.finish();
      await refused;
    }
    const entries = JSON.parse((await f.readDurableJournal())!).entries;
    assert.deepEqual(entries.map((entry: { hash: string }) => entry.hash), [originalHash]);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.transfers.getSnapshot().hash, null);
  } finally { await f.close(); }
});

test('a refused Speed Up leaves the original available for a fresh review after restart', async () => {
  const f = await cancellationFixture(2);
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(originalHash);
    const gate = f.hold('cancellation-original');
    const refused = assert.rejects(f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' }), { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.baseFee = '0x3e8';
    } finally { gate.finish(); await refused; }
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.broadcasts.length, 1);

    await f.reopen();
    const journal = await f.runtime.transfers!.journal(() => undefined);
    const original = await journal.load(originalHash);
    assert(original);
    assert.equal((await journal.load())?.hash, originalHash);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures, 2);

    await f.transfers.prepareCancellation(originalHash);
    assert.equal(f.transfers.getSnapshot().review?.replacement?.originalHash, originalHash);
    f.transfers.cancel();
    await f.transfers.prepareSpeedUp(originalHash);
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.originalHash, originalHash);
    assert.equal(review.amountUnits, Transaction.from(original.rawTransaction).value.toString());
    assert(BigInt(review.maximumFeePerGas) >= BigInt(f.replacement.baseFee) + BigInt(review.priorityFeePerGas!));
    assert(BigInt(review.priorityFeePerGas!) > Transaction.from(original.rawTransaction).maxPriorityFeePerGas!);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures, 2);

    f.replacement.baseFee = '0x3e9';
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'EXPIRED' });
    assert.equal(f.signatures, 2);
    assert.equal(f.broadcasts.length, 1);
    f.replacement.baseFee = '0x3e8';
    await f.transfers.prepareSpeedUp(originalHash);
    const renewed = f.transfers.getSnapshot().review!;
    f.replacement.baseFee = '0x3e7';
    await f.transfers.confirm(renewed.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.signatures, 3);
    const repriced = Transaction.from(f.broadcasts[1]!);
    assert.equal(repriced.maxFeePerGas?.toString(), renewed.maximumFeePerGas);
    assert.equal((await journal.load(originalHash))?.rawTransaction, original.rawTransaction);
    await assert.rejects(f.transfers.prepareSpeedUp(originalHash), { code: 'EXPIRED' });
  } finally { await f.close(); }
});

test('new cancellation signs the saved nonce once and persists both linked exact envelopes before POST', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    assert.equal(review.replacement?.mode, 'cancel');
    assert.equal(review.replacement?.originalHash, originalHash);
    assert.equal(review.recipient, review.from);
    assert.equal(review.amountUnits, '0');
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    const gate = f.hold('cancellation-dispatch');
    const submit = f.transfers.confirm(review.id, { method: 'device' });
    try {
      await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
      assert.equal(f.broadcasts.length, 1);
      const stored = JSON.parse((await f.readDurableJournal())!);
      assert.equal(stored.entries.length, 2);
      assert.equal(stored.entries[0].hash, originalHash);
      assert.equal(stored.entries[1].operation, 'cancel');
      assert.equal(stored.entries[1].originalHash, originalHash);
      await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'BUSY' });
    } finally {
      gate.finish();
      await submit;
    }
    assert.equal(f.broadcasts.length, 2);
    const [old, replacement] = f.broadcasts.map((raw) => Transaction.from(raw));
    assert.equal(replacement!.nonce, old!.nonce);
    assert.equal(replacement!.from, old!.from);
    assert.equal(replacement!.to, old!.from);
    assert.equal(replacement!.data, '0x');
    assert.equal(replacement!.value, 0n);
    assert.equal(replacement!.gasLimit * replacement!.maxFeePerGas!, BigInt(review.maximumFeeUnits));
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    await f.reopen();
    const journal = await f.runtime.transfers!.journal(() => undefined);
    assert.equal((await journal.load(originalHash))?.rawTransaction, f.broadcasts[0]);
    assert.equal((await journal.load(replacement!.hash!))?.rawTransaction, f.broadcasts[1]);
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'EXPIRED' });
  } finally {
    await f.close();
  }
});

test('new cancellation refuses a missing original or increased fee without creating another signature', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    f.replacement.baseFee = '0x100';
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'EXPIRED' });
    f.replacement.pending = false;
    await assert.rejects(f.transfers.prepareCancellation(originalHash), { code: 'EXPIRED' });
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally {
    await f.close();
  }
});

test('new cancellation keeps the original when payer delegation appears after persistence', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-dispatch');
    const submit = f.transfers.confirm(review.id, { method: 'device' });
    const refused = assert.rejects(submit, { code: 'EXPIRED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.replacement.delegated = true;
    } finally {
      gate.finish();
      await refused;
    }
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.deepEqual(saved.map((entry: { hash: string }) => entry.hash), [originalHash]);
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.authority.getSnapshot().phase, 'ready');
  } finally {
    await f.close();
  }
});

for (const change of ['dropped', 'replaced'] as const) {
  test(`new cancellation refuses a ${change} exact original during final preflight with the payer nonce unchanged`, async () => {
    const f = await cancellationFixture();
    try {
      const { originalHash, review } = await prepareSavedCancellation(f);
      const gate = f.hold('cancellation-dispatch');
      const submit = f.transfers.confirm(review.id, { method: 'device' });
      try {
        await Promise.race([gate.started, submit.then(() => assert.fail('POST preflight was not held'))]);
        if (change === 'dropped') f.replacement.pending = false;
        else f.replacement.substituteHash = '0x' + '9'.repeat(64);
      } finally {
        gate.finish();
      }
      await assert.rejects(submit, { code: 'EXPIRED' });
      assert.equal(f.broadcasts.length, 1);
      const saved = JSON.parse((await f.readDurableJournal())!).entries;
      assert.deepEqual(saved.map((entry: { hash: string }) => entry.hash), [originalHash]);
      assert.equal(f.transfers.getSnapshot().hash, null);
    } finally {
      await f.close();
    }
  });
}

test('new cancellation rechecks payer delegation after the final original observation', async () => {
  const f = await cancellationFixture();
  try {
    const { originalHash, review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-original');
    const submit = f.transfers.confirm(review.id, { method: 'device' });
    try {
      await Promise.race([gate.started, submit.then(() => assert.fail('Original observation was not held'))]);
      f.replacement.delegated = true;
    } finally {
      gate.finish();
    }
    await assert.rejects(submit, { code: 'EXPIRED' });
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.deepEqual(saved.map((entry: { hash: string }) => entry.hash), [originalHash]);
    assert.equal(f.transfers.getSnapshot().hash, null);
  } finally {
    await f.close();
  }
});

test('a previously confirmed saved transaction can be canceled after a fresh reorg observation', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const original = Transaction.from(f.broadcasts[0]!);
    const blockHash = '0x' + '8'.repeat(64);
    f.setRecovery({
      receipt: { transactionHash: original.hash, from: original.from, to: original.to,
        status: '0x1', blockNumber: '0xa', blockHash },
      nonce: '0x1', canonicalHash: blockHash,
    });
    await f.observeSaved(original.hash!);
    assert.equal((await f.readJournal())?.phase, 'confirmed');

    f.setRecovery({ receipt: null, nonce: '0x0', canonicalHash: blockHash });
    f.replacement.pending = true;
    await f.transfers.prepareCancellation(original.hash!);
    assert.equal((await f.readJournal())?.phase, 'submitted');
    const review = f.transfers.getSnapshot().review!;
    assert.equal(review.replacement?.mode, 'cancel');
    assert.equal(review.replacement?.originalHash, original.hash);
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    assert.equal(Transaction.from(f.broadcasts[1]!).nonce, original.nonce);
  } finally {
    await f.close();
  }
});

test('locking during the final cancellation preflight prevents POST and keeps both signed records', async () => {
  const f = await cancellationFixture();
  try {
    const { review } = await prepareSavedCancellation(f);
    const gate = f.hold('cancellation-dispatch');
    const refused = assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'CANCELLED' });
    try {
      await Promise.race([gate.started, refused.then(() => assert.fail('POST preflight was not held'))]);
      f.authority.lock();
    } finally {
      gate.finish();
      await refused;
    }
    assert.equal(f.broadcasts.length, 1);
    const saved = JSON.parse((await f.readDurableJournal())!).entries;
    assert.equal(saved.length, 2);
    assert.equal(saved[1].operation, 'cancel');
    assert.equal(f.authority.getSnapshot().phase, 'locked');
  } finally {
    await f.close();
  }
});

test('wall-clock rollback cannot hide an unresolved signed transfer after a cold reopen', async () => {
  const originalNow = Date.now;
  let wallClock = 2_000_000_000_000;
  Date.now = () => wallClock;
  let f: Awaited<ReturnType<typeof cancellationFixture>> | undefined;
  try {
    f = await cancellationFixture();
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const older = (await f.readJournal()) as TransferJournalEntry;
    const first = Transaction.from(older.rawTransaction);
    f.setRecovery({
      receipt: {
        transactionHash: older.hash,
        from: first.from,
        to: RECIPIENT,
        status: '0x1',
        blockNumber: '0x10',
        blockHash: '0x' + '1'.repeat(64),
      },
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.observeSaved();
    assert.equal((await f.readJournal())!.phase, 'confirmed');

    // Move only the wall-clock presentation timestamp backwards. Consent
    // deadlines continue to use the controller's actual monotonic clock.
    wallClock -= 60 * 60 * 1000;
    f.setRecovery({
      receipt: null,
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.transfers.prepare(RECIPIENT, '0.002');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const unresolvedHash = f.transfers.getSnapshot().hash!;
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.equal(Transaction.from(f.broadcasts.at(-1)!).nonce, 1);
    assert.notEqual(unresolvedHash, older.hash);
    const signatures = f.signatures;
    const broadcasts = [...f.broadcasts];
    assert.equal(signatures, 2);
    assert.equal(broadcasts.length, 2);
    const retained = await f.readDurableJournal();
    assert.equal(inspectEvmSignedBundle(retained!).transactions, 2);
    const unresolved = (
      JSON.parse(retained!).entries as {
        hash: string;
        createdAt: number;
        phase: string;
      }[]
    ).find((entry) => entry.hash === unresolvedHash)!;
    assert.equal(unresolved.phase, 'submitted');
    assert(unresolved.createdAt < older.createdAt);

    await f.reopen();
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal((await f.readJournal())!.hash, unresolvedHash);
    const beforeRequests = f.requests.length;
    await assert.rejects(f.transfers.prepare(RECIPIENT, '0.003'), { code: 'PENDING_TRANSFER' });
    assert.equal(f.transfers.getSnapshot().hash, unresolvedHash);
    assert.equal(f.transfers.getSnapshot().review, null);
    assert(f.requests.slice(beforeRequests).some((call) =>
      call.method === 'eth_getTransactionCount' && call.params[1] === 'pending'));
    assert.equal(f.signatures, signatures);
    assert.deepEqual(f.broadcasts, broadcasts);
    const beforeRecovery = f.requests.length;
    const observation = await f.observeSaved();
    const receiptReads = f.requests
      .slice(beforeRecovery)
      .filter((request) => request.method === 'eth_getTransactionReceipt');
    assert.deepEqual(
      receiptReads.map((request) => request.params[0]),
      [unresolvedHash]
    );
    assert.equal(observation.status, 'missing');
    assert.equal(f.signatures, signatures);
    assert.deepEqual(f.broadcasts, broadcasts);
    assert.equal(
      await f.readDurableJournal(),
      retained,
      'status observation preserves both exact signed records'
    );
  } finally {
    try {
      await f?.close();
    } finally {
      Date.now = originalNow;
    }
  }
});

for (const cancellation of ['back', 'dispose', 'lock'] as const) {
  test(`${cancellation} during final fee read revokes pending confirmation`, async () => {
    const f = await cancellationFixture();
    let hold: ReturnType<typeof f.hold> | undefined;
    let pending: Promise<void> | undefined;
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      const initialSignatures = f.signatures;
      const initialBroadcasts = f.broadcasts.length;
      const credentials = [f.authentications, f.hydrations] as const;
      const journal = await f.readDurableJournal();
      hold = f.hold('requote');
      pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.started;
      if (cancellation === 'dispose') f.transfers.dispose();
      else if (cancellation === 'lock') f.authority.lock();
      else f.transfers.cancel();
      hold.finish();
      await rejected;
      pending = undefined;
      assert.equal(
        f.authority.getSnapshot().phase,
        cancellation === 'lock' ? 'locked' : 'ready'
      );
      assert.equal(f.sdkUnlocked, false);
      assert.equal(f.sdkPublic, cancellation !== 'lock');
      assert.equal(f.signatures, initialSignatures);
      assert.equal(f.broadcasts.length, initialBroadcasts);
      assert.equal(await f.readDurableJournal(), journal);
      assert.deepEqual([f.authentications, f.hydrations], credentials);
      if (cancellation === 'lock') await f.authority.unlock();
      if (cancellation === 'dispose') f.replaceTransfers();
      await f.transfers.prepare(RECIPIENT, '0.001');
      const before = [f.authentications, f.hydrations] as const;
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      assert.equal(f.signatures, initialSignatures + 1);
      assert.equal(f.broadcasts.length, initialBroadcasts + 1);
      assert.deepEqual([f.authentications, f.hydrations], [before[0] + 1, before[1]]);
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      await f.close();
    }
  });
}

test('background lock during final fee check invalidates review without signing or a late unlock', async () => {
  const f = await cancellationFixture();
  let hold: ReturnType<typeof f.hold> | undefined;
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    const credentials = [f.authentications, f.hydrations] as const;
    hold = f.hold('requote');
    const pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await hold.started;
    f.authority.lock();
    hold.finish();
    await rejected;
    assert.equal(f.sdkUnlocked, false);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.equal(f.signatures, 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(await f.readDurableJournal(), undefined);
    assert.deepEqual([f.authentications, f.hydrations], credentials, 'cancelled preflight never starts OS authentication');
  } finally {
    hold?.finish();
    await f.close();
  }
});

for (const repeated of [false, true]) {
  test(`${
    repeated ? 'repeated' : 'initial'
  } oversized receipt preserves the real journal regardless of nonce consumption`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      f.recovery.oversized = true;
      f.recovery.repeated = repeated;
      if (repeated) {
        // A prior valid receipt is a real observation; the next independent
        // observation must not turn an oversized body into successful evidence.
        await f.observeSaved();
      }
      const retained = (await f.readJournal()) as TransferJournalEntry;
      assert(retained);
      assert.equal(retained.phase, repeated ? 'confirmed' : 'submitted');
      const retainedBytes = await f.readDurableJournal();
      assert(retainedBytes);
      const retainedRevision = inspectEvmSignedBundle(retainedBytes).revision;
      for (const consumed of [false, true]) {
        f.recovery.consumed = consumed;
        const before = f.requests.length;
        await assert.rejects(f.observeSaved());
          assert.equal(f.transfers.getSnapshot().review, null);
        assert.deepEqual(await f.readJournal(), retained);
        assert.equal(await f.readDurableJournal(), retainedBytes);
        assert.equal(
          f.requests
            .slice(before)
            .some((call) => call.method === 'eth_getTransactionCount'),
          false,
          'an oversized receipt does not admit a nonce fallback'
        );
        assert.equal(f.signatures, 1);
        assert.equal(f.broadcasts.length, 1);
      }
      if (!repeated) {
        await f.transfers.prepare(RECIPIENT, '0.002');
        assert.equal(f.transfers.getSnapshot().review?.nonce, '1');
        assert.deepEqual(await f.readJournal(), retained);
        assert.equal(f.broadcasts.length, 1);
      }
      // A bounded null receipt can independently update the older saved row.
      // Neither a new quote nor a malformed receipt changes its observation.
      f.recovery.oversized = false;
      f.setRecovery({
        receipt: null,
        nonce: '0x1',
        canonicalHash: '0x' + '8'.repeat(64),
      });
      await f.observeSaved();
      const after = (await f.readJournal()) as TransferJournalEntry;
      assert.deepEqual(after, { ...retained, phase: 'nonce-consumed' });
      assert.equal(
        inspectEvmSignedBundle((await f.readDurableJournal())!).revision,
        retainedRevision + 1
      );
      assert.equal(after.rawTransaction, retained.rawTransaction);
      await f.transfers.prepare(RECIPIENT, '0.002');
      assert.equal(f.transfers.getSnapshot().review!.nonce, '1');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      assert.equal(f.signatures, 2);
      assert.equal(f.broadcasts.length, 2);
      assert.equal(Transaction.from(f.broadcasts[1]!).nonce, 1);
    } finally {
      await f.close();
    }
  });
}

for (const phase of ['signed', 'submitted'] as const) {
  test(`cancelled post-sign ${phase} acknowledgement still quarantines the current authority`, async () => {
    const f = await cancellationFixture();
    let hold: ReturnType<typeof f.holdJournal> | undefined;
    let pending: Promise<void> | undefined;
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      hold = f.holdJournal(phase);
      pending = f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.started;
      assert.equal(f.signatures, 1);
      assert.equal(f.sdkUnlocked, false);
      assert.equal(f.sdkPublic, true);
      const before = f.authority.getSnapshot();
      const retained = await f.readDurableJournal();
      assert(retained);
      assert.equal(JSON.parse(retained).entries[0].phase, phase);
      f.transfers.cancel();
      assert.equal(
        f.authority.getSnapshot(),
        before,
        'Back after signing does not itself lock custody'
      );
      await expectUnavailable(f.authority, async () => {
        hold!.finish();
        await rejected;
      });
      pending = undefined;
      assert.equal(f.authority.getSnapshot().phase, 'unavailable');
      assert.equal(f.authority.getSnapshot().error, 'UNAVAILABLE');
      assert.equal(f.authority.getSnapshot().account, null);
      assert.equal(f.sdkUnlocked, false, 'the actual SDK session is retired');
      await assert.rejects(
        f.runtime.session.readSelectedAddress(),
        /NOT_READY/
      );
      assert.equal(f.broadcasts.length, phase === 'signed' ? 0 : 1);
      assert.deepEqual(await f.readDurableJournal(), retained);
      await assert.rejects(
        f.runtime.backup.readPhrase({ method: 'device' }),
        /CLEANUP_FAILED/
      );
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      await f.close().catch(() => undefined);
    }
  });

  test(`a cancelled old-runtime ${phase} failure cannot lock the replacement authority`, async () => {
    const old = await cancellationFixture();
    const replacement = await cancellationFixture();
    let active = old;
    let locks = 0;
    const listeners = new Set<Parameters<typeof old.authority.subscribe>[0]>();
    const unsubscribe = [old, replacement].map((owner) =>
      owner.authority.subscribe((snapshot) => {
        if (active === owner)
          for (const listener of listeners) listener(snapshot);
      })
    );
    const transfers = new NativeTransfers(
      {
        getSnapshot: () => active.authority.getSnapshot(),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        lock() {
          locks++;
          active.authority.lock();
        },
      },
      () => active.runtime.transfers,
      { rpc: old.rpc }
    );
    let hold: ReturnType<typeof old.holdJournal> | undefined;
    let pending: Promise<void> | undefined;
    try {
      await transfers.prepare(RECIPIENT, '0.001');
      hold = old.holdJournal(phase);
      pending = transfers.confirm(transfers.getSnapshot().review!.id, { method: 'device' });
      const rejected = assert.rejects(pending, { code: 'CANCELLED' });
      await hold.started;
      const retained = await old.readDurableJournal();
      transfers.cancel();
      old.authority.lock();
      active = replacement;
      const before = replacement.authority.getSnapshot();
      hold.finish();
      await rejected;
      pending = undefined;
      assert.equal(
        locks,
        0,
        'late failure must not forward a lock to a different runtime'
      );
      assert.equal(replacement.authority.getSnapshot(), before);
      assert.equal(replacement.sdkUnlocked, false);
      assert.equal(replacement.sdkPublic, true);
      assert.equal(
        await replacement.runtime.session.readSelectedAddress(),
        before.account!.address
      );
      assert.equal(await replacement.readDurableJournal(), undefined);
      assert.deepEqual(await old.readDurableJournal(), retained);
      assert.equal(old.sdkUnlocked, false);
      assert.equal(old.broadcasts.length, phase === 'signed' ? 0 : 1);
    } finally {
      hold?.finish();
      await pending?.catch(() => undefined);
      transfers.dispose();
      unsubscribe.forEach((stop) => stop());
      await old.close().catch(() => undefined);
      await replacement.close();
    }
  });
}

for (const [status, phase] of [
  ['0x1', 'confirmed'],
  ['0x0', 'reverted'],
] as const) {
  test(`orphan receipt cannot ${
    phase === 'confirmed' ? 'confirm' : 'revert'
  } a real journal even when another transaction used the nonce`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      const saved = (await f.readJournal()) as TransferJournalEntry;
      const entry = saved;
      const tx = Transaction.from(entry.rawTransaction);
      f.setRecovery({
        receipt: {
          transactionHash: entry.hash,
          from: tx.from,
          to: RECIPIENT,
          status,
          blockNumber: '0x10',
          blockHash: '0x' + '1'.repeat(64),
        },
        nonce: '0x1',
        canonicalHash: '0x' + '2'.repeat(64),
      });
      await assert.rejects(f.observeSaved());
      assert.equal(f.authority.getSnapshot().phase, 'ready');
      assert.deepEqual(
        await f.readJournal(),
        saved,
        'the unresolved exact signed entry must remain recoverable'
      );
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    } finally {
      await f.close();
    }
  });

  test(`canonical ${phase} receipt updates the matching real journal`, async () => {
    const f = await cancellationFixture();
    try {
      await f.transfers.prepare(RECIPIENT, '0.001');
      await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
      const saved = (await f.readJournal()) as TransferJournalEntry;
      const entry = saved;
      f.setRecovery({
        receipt: {
          transactionHash: entry.hash,
          from: Transaction.from(entry.rawTransaction).from,
          to: RECIPIENT,
          status,
          blockNumber: '0x10',
          blockHash: '0x' + '1'.repeat(64),
        },
        nonce: '0x1',
        canonicalHash: '0x' + '1'.repeat(64),
      });
      await f.observeSaved();
      const next = (await f.readJournal()) as TransferJournalEntry;
      assert.equal(next.phase, phase);
      assert.equal(next.rawTransaction, entry.rawTransaction);
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    } finally {
      await f.close();
    }
  });
}

test('missing receipt with a consumed nonce records only nonce-consumed', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const before = (await f.readJournal()) as TransferJournalEntry;
    f.setRecovery({
      receipt: null,
      nonce: '0x1',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    await f.observeSaved();
    const after = (await f.readJournal()) as TransferJournalEntry;
    assert.equal(after.phase, 'nonce-consumed');
    assert.equal(after.rawTransaction, before.rawTransaction);
  } finally {
    await f.close();
  }
});

test('canonical receipt confirms without an advanced nonce or settlement-tag read', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const saved = (await f.readJournal()) as TransferJournalEntry;
    const entry = saved;
    f.setRecovery({
      receipt: {
        transactionHash: entry.hash,
        from: Transaction.from(entry.rawTransaction).from,
        to: RECIPIENT,
        status: '0x1',
        blockNumber: '0x10',
        blockHash: '0x' + '1'.repeat(64),
      },
      nonce: '0x0',
      canonicalHash: '0x' + '1'.repeat(64),
    });
    const before = f.requests.length;
    await f.observeSaved();
    const after = (await f.readJournal()) as TransferJournalEntry;
    assert.equal(after.phase, 'confirmed');
    assert.equal(after.rawTransaction, entry.rawTransaction);
    assert.equal(
      f.requests
        .slice(before)
        .some((request) => request.method === 'eth_getTransactionCount'),
      false
    );
    assert.equal(
      f.requests
        .slice(before)
        .some(
          (request) =>
            request.params.includes('finalized') ||
            request.params.includes('safe')
        ),
      false
    );
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    await f.close();
  }
});

test('actual SDK custody activity observes only its retained tuple through the common observer and retains raw bytes', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const tx = Transaction.from(f.broadcasts[0]!),
      before = f.signatures;
    const activity = f.runtime.activity!;
    const loaded = await activity.load(() => undefined);
    assert.equal(loaded.locals.length, 1);
    const local = loaded.locals[0]!;
    f.setRecovery({
      receipt: {
        transactionHash: tx.hash,
        from: tx.from,
        to: tx.to,
        status: '0x1',
        blockNumber: '0xa',
        blockHash: '0x' + '8'.repeat(64),
      },
      nonce: '0x1',
      canonicalHash: '0x' + '8'.repeat(64),
    });
    const start = f.requests.length;
    const observed = await activity.observeLocal!(
      local,
      () => undefined,
      new AbortController().signal
    );
    assert.equal(observed.status, 'mined');
    assert.equal(
      (await activity.load(() => undefined)).locals[0]!.phase,
      'confirmed'
    );
    const receiptCalls = f.requests
      .slice(start)
      .filter((row) => row.method === 'eth_getTransactionReceipt');
    assert.deepEqual(
      receiptCalls.map((row) => row.params),
      [[tx.hash]]
    );
    assert.equal(f.signatures, before);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(
      (await (await f.runtime.transfers!.journal(() => undefined)).load())!
        .rawTransaction,
      tx.serialized
    );
    f.authority.lock();
    await assert.rejects(
      activity.observeLocal!(
        local,
        () => undefined,
        new AbortController().signal
      )
    );
  } finally {
    await f.close();
  }
});

test('lost retained-observation phase acknowledgement locks the actual SDK and preserves its signed bytes', async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const tx = Transaction.from(f.broadcasts[0]!);
    const activity = f.runtime.activity!, local = (await activity.load(() => undefined)).locals[0]!;
    f.setRecovery({receipt:{transactionHash:tx.hash,from:tx.from,to:tx.to,status:'0x1',blockNumber:'0xa',blockHash:'0x'+'8'.repeat(64)},nonce:'0x1',canonicalHash:'0x'+'8'.repeat(64)});
    const gate = f.holdJournal('confirmed');
    const work = activity.observeLocal!(local, () => undefined, new AbortController().signal);
    const rejected = assert.rejects(work, {code:'CLEANUP_FAILED'});
    await gate.started; gate.finish(); await rejected;
    assert.equal(f.sdkUnlocked, false);
    assert(await f.readDurableJournal());
    assert.equal(f.broadcasts.length, 1);
    await f.reopenAfterQuarantine();
    const retained = await f.readJournal();
    assert.equal(retained?.rawTransaction, tx.serialized);
    assert.equal(retained?.phase, 'confirmed');
  } finally { await f.close(); }
});


test('manual native gap filling obeys the same retained spend budget as automatic sends', async () => {
  const f = await cancellationFixture();
  try {
    f.setBalance(1000000n);
    await f.transfers.prepare(RECIPIENT, '0.0000000000007', '1');
    const first = f.transfers.getSnapshot().review!;
    assert.equal(first.nonce, '1');
    await f.transfers.confirm(first.id, { method: 'device' });
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    for (const nonce of [undefined, '0']) {
      await assert.rejects(f.transfers.prepare(RECIPIENT, '0.0000000000006', nonce), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(f.signatures, 1);
      assert.equal(f.broadcasts.length, 1);
    }
    await f.transfers.prepare(RECIPIENT, '0.0000000000001', '0');
    const next = f.transfers.getSnapshot().review!;
    assert.equal(next.nonce, '0');
    await f.transfers.confirm(next.id, { method: 'device' });
    assert.equal(f.signatures, 2);
    assert.deepEqual(f.broadcasts.map(raw => Transaction.from(raw).nonce), [1, 0]);
  } finally { await f.close(); }
});


test('OS authorization reads the secret once per signed action and explicit Cancel preserves its exact review', async () => {
  const beforeOpen = credentialPort.secretReads;
  const f = await cancellationFixture();
  try {
    assert.equal(credentialPort.secretReads, beforeOpen, 'public open/import/restore never reads the protected secret');
    await f.transfers.prepare(RECIPIENT, '0.001');
    const review = f.transfers.getSnapshot().review!;
    credentialPort.refuseNext(operationAuthenticationCancellation());
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'CANCELLED' });
    assert.equal(f.authority.getSnapshot().phase, 'ready');
    assert.equal(f.transfers.getSnapshot().review?.id, review.id);
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 0);
    const beforeRetry = credentialPort.secretReads;
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(credentialPort.secretReads, beforeRetry + 1);
    assert.equal(f.signatures, 1); assert.equal(f.broadcasts.length, 1);
  } finally { await f.close(); }
});

for (const boundary of ['before-confirm', 'after-signature', 'after-storage'] as const)
for (const failure of ['revert', 'gas-growth'] as const) test(`native final admission rejects ${failure} ${boundary} with SDK and SQLite`, async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    const review = f.transfers.getSnapshot().review!;
    let changedAt = -1;
    const changeExecution = () => {
      changedAt = f.requests.length;
      if (failure === 'revert') f.execution.reverts = true;
      else f.execution.gas = '0x1e8480';
    };
    if (boundary === 'before-confirm') changeExecution();
    else if (boundary === 'after-signature') f.onSignature(changeExecution);
    else f.onSignedInsert(changeExecution);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), {
      code: failure === 'revert' ? 'FAILED' : 'EXPIRED',
    });
    assert(changedAt >= 0, 'the selected signing/storage boundary was reached');
    assert.equal(f.signatures, boundary === 'before-confirm' ? 0 : 1);
    assert.equal(f.broadcasts.length, 0);
    const finalEstimate = f.requests.slice(changedAt).find(request => request.method === 'eth_estimateGas');
    assert(finalEstimate, 'the retained native envelope is checked after the change');
    assert.equal((finalEstimate.params[0] as { to: string }).to.toLowerCase(), RECIPIENT.toLowerCase());
    assert.equal((finalEstimate.params[0] as { data: string }).data, '0x');
    assert.deepEqual(JSON.parse((await f.readDurableJournal()) ?? '{}').entries ?? [], []);
  } finally { await f.close(); }
});

for (const boundary of ['after-signature', 'after-storage'] as const) test(`native final admission rejects a raised base fee ${boundary}`, async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    const review = f.transfers.getSnapshot().review!;
    const changeBaseFee = () => { f.replacement.baseFee = '0xffff'; };
    if (boundary === 'after-signature') f.onSignature(changeBaseFee);
    else f.onSignedInsert(changeBaseFee);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'EXPIRED' });
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 0);
    assert(await f.readDurableJournal());
  } finally { await f.close(); }
});

for (const type of [0, 2] as const) test(`native final admission retains approved bytes when execution gas grows within the margin (type ${type})`, async () => {
  const f = await cancellationFixture(type);
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    const review = f.transfers.getSnapshot().review!;
    f.onSignedInsert(() => { f.execution.gas = '0x6000'; });
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.signatures, 1);
    assert.equal(f.broadcasts.length, 1);
    const signed = Transaction.from(f.broadcasts[0]!);
    assert.equal(signed.type, type);
    assert.equal(signed.gasLimit.toString(), review.gasLimit);
    assert.equal((signed.gasPrice ?? signed.maxFeePerGas)!.toString(), review.maximumFeePerGas);
    assert.equal(signed.maxPriorityFeePerGas?.toString() ?? null, review.priorityFeePerGas);
    assert.equal(signed.to, review.recipient);
    assert.equal(signed.value.toString(), review.amountUnits);
    assert.equal(signed.data, '0x');
    assert.equal(signed.nonce.toString(), review.nonce);
  } finally { await f.close(); }
});

async function prepareTokenTransfer(f: Awaited<ReturnType<typeof cancellationFixture>>) {
  const registry = await f.runtime.tokens!.load(() => undefined);
  await f.runtime.tokens!.add(registry.revision, {
    contractAddress: TOKEN_CONTRACT, name: 'Test token', symbol: 'TST', decimals: 0,
  }, () => undefined);
  await f.transfers.prepareToken(TOKEN_CONTRACT, RECIPIENT, '1');
}

for (const boundary of ['before-confirm', 'after-signature', 'after-storage'] as const)
for (const asset of ['native', 'token'] as const) test(`replacement final admission rejects ${asset} loss ${boundary}`, async () => {
  const f = await cancellationFixture();
  try {
    if (asset === 'token') await prepareTokenTransfer(f);
    else await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(f.transfers.getSnapshot().hash!);
    const review = f.transfers.getSnapshot().review!;
    let changed = false;
    const lose = () => { changed = true; if (asset === 'token') f.token.balance = 0n; else f.setBalance(0n); };
    if (boundary === 'before-confirm') lose();
    else if (boundary === 'after-signature') f.onSignature(lose);
    else f.onSignedInsert(lose);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), {
      code: asset === 'token' ? 'INSUFFICIENT_TOKEN_BALANCE' : 'INSUFFICIENT_BALANCE',
    });
    assert(changed);
    assert.equal(f.broadcasts.length, 1, 'only the original was broadcast');
    assert.equal(f.signatures, boundary === 'before-confirm' ? 1 : 2);
    const entries = JSON.parse((await f.readDurableJournal())!).entries;
    assert.deepEqual(entries.map((entry: { hash: string }) => entry.hash), [keccak256(f.broadcasts[0]!)]);
  } finally { await f.close(); }
});

for (const boundary of ['before-confirm', 'after-signature', 'after-storage'] as const)
test(`token final admission preserves reviewed precision ${boundary}`, async () => {
  const f = await cancellationFixture();
  try {
    await prepareTokenTransfer(f);
    const review = f.transfers.getSnapshot().review!;
    const change = () => { f.token.decimals = 18; };
    if (boundary === 'before-confirm') change();
    else if (boundary === 'after-signature') f.onSignature(change);
    else f.onSignedInsert(change);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'TOKEN_CHANGED' });
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.signatures, boundary === 'before-confirm' ? 0 : 1);
    assert.equal(f.token.decimals, 18);
  } finally { await f.close(); }
});

for (const source of ['pending', 'saved'] as const)
test(`approved ${source} cancellation avoids recommendation dependencies`, async () => {
  const f = await cancellationFixture();
  try {
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    const originalHash = f.transfers.getSnapshot().hash!;
    f.replacement.pending = source === 'pending';
    if (source === 'pending') await f.transfers.prepareCancellation(originalHash);
    else await f.transfers.prepareSavedCancellation(originalHash);
    const review = f.transfers.getSnapshot().review!;
    f.execution.feesUnavailable = true;
    f.requests.length = 0;
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    const actual = Transaction.from(f.broadcasts[1]!);
    assert.equal(actual.gasLimit.toString(), review.gasLimit);
    assert.equal((actual.gasPrice ?? actual.maxFeePerGas)!.toString(), review.maximumFeePerGas);
    assert.equal(f.requests.some(request => ['eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory'].includes(request.method)), false);
  } finally { await f.close(); }
});

for (const boundary of ['after-signature', 'after-storage'] as const)
test(`cancellation final admission rejects native balance loss ${boundary}`, async () => {
  const f = await cancellationFixture();
  try {
    const { review } = await prepareSavedCancellation(f);
    const lose = () => f.setBalance(0n);
    if (boundary === 'after-signature') f.onSignature(lose); else f.onSignedInsert(lose);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'INSUFFICIENT_BALANCE' });
    assert.equal(f.signatures, 2);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries.length, 1);
  } finally { await f.close(); }
});

for (const boundary of ['before-confirm', 'after-signature', 'after-storage'] as const)
test(`replacement final admission rejects paused token execution ${boundary}`, async () => {
  const f = await cancellationFixture();
  try {
    await prepareTokenTransfer(f);
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(f.transfers.getSnapshot().hash!);
    const review = f.transfers.getSnapshot().review!;
    let changedAt = -1;
    const pauseToken = () => { changedAt = f.requests.length; f.token.paused = true; };
    if (boundary === 'before-confirm') pauseToken();
    else if (boundary === 'after-signature') f.onSignature(pauseToken);
    else f.onSignedInsert(pauseToken);
    await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'FAILED' });
    assert(changedAt >= 0);
    assert.equal(f.signatures, boundary === 'before-confirm' ? 1 : 2);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.token.balance, 9n);
    assert.equal(f.token.decimals, 0);
    const simulation = f.requests.slice(changedAt).find(request => request.method === 'eth_call' &&
      (request.params[0] as { data: string }).data.startsWith('0xa9059cbb'));
    assert(simulation, 'the exact replacement is simulated after the pause');
    const call = simulation.params[0] as { gas: string; nonce: string };
    assert.equal(BigInt(call.gas).toString(), review.gasLimit);
    assert.equal(BigInt(call.nonce).toString(), review.nonce);
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries.length, 1);
  } finally { await f.close(); }
});

for (const asset of ['native', 'token'] as const) test(`counted SDK and SQLite ${asset} replacement confirmation`, async () => {
  const f = await cancellationFixture();
  try {
    if (asset === 'token') await prepareTokenTransfer(f);
    else await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    f.replacement.pending = true;
    await f.transfers.prepareSpeedUp(f.transfers.getSnapshot().hash!);
    const review = f.transfers.getSnapshot().review!;
    f.requests.length = 0;
    const httpBefore = f.httpRequests;
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.requests.length, asset === 'native' ? 26 : 37);
    assert.equal(f.httpRequests - httpBefore, asset === 'native' ? 22 : 31);
    assert.equal(f.requests.filter(request => request.method === 'eth_chainId').length, 9);
    console.log('REPLACEMENT_CONFIRM_COUNTS', JSON.stringify({ asset, methods: f.requests.length, http: f.httpRequests - httpBefore,
      chains: f.requests.filter(request => request.method === 'eth_chainId').length,
      calls: f.requests.map(request => request.method) }));
  } finally { await f.close(); }
});


for (const extra of [0n, 1000000n]) test(`Cancel remains affordable when the original debits pending balance (extra ${extra})`, async () => {
  const f = await cancellationFixture();
  try {
    f.setBalance(1000000000075600n + extra);
    await f.transfers.prepare(RECIPIENT, '0.001');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, { method: 'device' });
    f.replacement.pending = true; f.setPendingBalance(33600n + extra);
    await f.transfers.prepareCancellation(f.transfers.getSnapshot().hash!);
    const review = f.transfers.getSnapshot().review!;
    await f.transfers.confirm(review.id, { method: 'device' });
    assert.equal(f.broadcasts.length, 2);
    const actual = Transaction.from(f.broadcasts[1]!);
    assert.equal(actual.to, actual.from); assert.equal(actual.value, 0n);
    assert.equal(actual.gasLimit.toString(), review.gasLimit);
  } finally { await f.close(); }
});

for (const boundary of ['before-review', 'before-confirm'] as const)
test(`NFT Speed Up rejects missing ownership ${boundary} before signing`, async () => {
  const f = await cancellationFixture();
  try {
    const sender = Wallet.fromPhrase(PHRASE).address;
    const data = new Interface(['function transferFrom(address,address,uint256)']).encodeFunctionData('transferFrom', [sender, RECIPIENT, 7]);
    const original = await f.seedOriginal({ to: RECIPIENT, data, operation: 'erc721' });
    if (boundary === 'before-review') f.loseNft();
    if (boundary === 'before-review') await assert.rejects(f.transfers.prepareSpeedUp(original.hash!), { code: 'INSUFFICIENT_NFT_BALANCE' });
    else {
      await f.transfers.prepareSpeedUp(original.hash!);
      const review = f.transfers.getSnapshot().review!; f.loseNft();
      await assert.rejects(f.transfers.confirm(review.id, { method: 'device' }), { code: 'INSUFFICIENT_NFT_BALANCE' });
    }
    assert.equal(f.signatures, 0); assert.equal(f.broadcasts.length, 1);
    assert.equal(JSON.parse((await f.readDurableJournal())!).entries.length, 1);
  } finally { await f.close(); }
});
