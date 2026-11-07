import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { EVM_CANCELLATION_GAS_LIMIT } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeTransfers } from '../src/custody/transfers.ts';
import type { SavedCollectible } from '../src/portfolio/tokenRegistry.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'Public collectible controller password 2!';
const wallet = Wallet.fromPhrase(phrase);
const owner = wallet.address;
const recipient = '0x1111111111111111111111111111111111111111';
const contractAddress = '0x2222222222222222222222222222222222222222';
const max = ((1n << 256n) - 1n).toString();
const network = getNativeNetwork('ethereum');
const block = {
  number: '0x123',
  hash: '0x' + 'a'.repeat(64),
  gasLimit: '0x1c9c380',
  baseFeePerGas: '0x64',
};
const unrelatedHash = '0x' + 'd'.repeat(64);
type ObservationFault = 'different-hash' | 'reorg' | 'absent-transaction' | 'wrong-index';
const abi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function transferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'error ERC721NonexistentToken(uint256)',
]);
const current = () => undefined;

function collectibleFixture(tokenStandard: 'ERC-721' | 'ERC-1155') {
  const tokenId = tokenStandard === 'ERC-721' ? '0' : max;
  const units = tokenStandard === 'ERC-721' ? '1' : max;
  const collectible: SavedCollectible = tokenStandard === 'ERC-721'
    ? { contractAddress, tokenStandard }
    : { contractAddress, tokenStandard, tokenId };
  const data = tokenStandard === 'ERC-721'
    ? abi.encodeFunctionData('transferFrom', [owner, recipient, tokenId])
    : abi.encodeFunctionData('safeTransferFrom', [owner, recipient, tokenId, units, '0x']);
  return { collectible, tokenId, units, data };
}

type Call = Readonly<{ jsonrpc: string; id: number; method: string; params: unknown[] }>;
type Case = ReturnType<typeof collectibleFixture>;

async function withController(
  asset: Case,
  mode: 'success' | 'hold-preflight' | 'hold-adapter' | 'lost-ack' | 'hold-replay',
  exercise: (fixture: {
    transfers: NativeTransfers;
    calls: Call[];
    posted: string[];
    preflight: Promise<void>;
    releasePreflight(): void;
    signedCommit: Promise<void>;
    acknowledgeCommit(): void;
    adapterEntered: Promise<AbortSignal>;
    adapterObservedAbort: Promise<boolean>;
    releaseAdapter(): void;
    retained: () => Promise<Readonly<{ operation: string; phase: string; hash: string }>[]>;
    retainedBytes(hash: string): Promise<string | undefined>;
    reopen(): Promise<NativeTransfers>;
    confirmOnChain(raw: string): void;
    setPendingNonce(nonce: string): void;
    setCanonicalNonce(nonce: string): void;
    setExpectedEstimateNonce(nonce: string, tag: 'latest' | 'pending'): void;
    invalidateCancellationObservation(mode: ObservationFault, readNumber: 1 | 2): void;
    holdOriginalObservation(hash: string): Readonly<{
      started: Promise<void>;
      release(): void;
      observe(): Promise<void>;
    }>;
    reorg(): void;
    replaceSaved(): Promise<void>;
    advanceClock(milliseconds: number): void;
    removeHolding(): void;
  }) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'pali-nft-controller-'));
  const file = join(directory, 'wallet.sqlite');
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('Public network forbidden');
  };
  let storage!: SqliteWalletStorage;
  let runtime!: KeyringRuntime;
  const committed = Promise.withResolvers<void>();
  const acknowledge = Promise.withResolvers<void>();
  const factory = createKeyringRuntimeFactory({
    async ensureCryptoReady() { assert.ok(globalThis.crypto.subtle); },
    async openStorage() {
      let wroteSignedRecord = false;
      const sql = nodeConnection(file, {
        async after(kind, statement) {
          if (kind === 'run' && statement.startsWith('INSERT INTO evm_signed_records'))
            wroteSignedRecord = true;
          if (kind !== 'exec' || statement !== 'COMMIT' || !wroteSignedRecord) return;
          wroteSignedRecord = false;
          if (mode === 'success') {
            committed.resolve();
            await acknowledge.promise;
          }
        },
      });
      storage = await SqliteWalletStorage.open(sql.connection, digest, INSTALLATION, true);
      return storage;
    },
  });
  const openAuthority = () => new NativeCustodyAuthority({
    async open() {
      runtime = (await factory.open()) as KeyringRuntime;
      return runtime;
    },
  });
  let authority = openAuthority();
  const preflight = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const adapterEntered = Promise.withResolvers<AbortSignal>();
  const adapterObservedAbort = Promise.withResolvers<boolean>();
  const adapterRelease = Promise.withResolvers<void>();
  const calls: Call[] = [];
  const posted: string[] = [];
  let clockOffset = 0;
  let hasHolding = true;
  let confirmed: Transaction | undefined;
  let pendingNonce: string | undefined;
  let canonicalNonce: string | undefined;
    let expectedEstimateNonce: string | undefined;
    let expectedEstimateTag: 'latest' | 'pending' = 'pending';
  let invalidObservation: Readonly<{ mode: ObservationFault; readNumber: 1 | 2 }> | undefined;
  let omitTransaction = false;
  let confirmationsRead = 0;
  let heldBlock: Readonly<{ hash: string; started(): void; wait: Promise<void> }> | undefined;
  const releaseHeldBlock = Promise.withResolvers<void>();
  const confirmedBlockHash = () => confirmed?.to === owner ? block.hash : '0x' + 'c'.repeat(64);
  const retained = async () => {
    const { signedRecords } = await storage.recovery.readSnapshot();
    return signedRecords.flatMap(({ value }) => JSON.parse(value).entries) as
      Readonly<{ operation: string; phase: string; hash: string }>[];
  };
  const openTransfers = (): NativeTransfers => new NativeTransfers(authority, () => runtime?.transfers, {
    now: () => performance.now() + clockOffset,
    fetch: async (url, init) => {
      assert.equal(url, network.rpcUrl);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.signal?.aborted, false);
      const call: Call = JSON.parse(String(init.body));
      calls.push(call);
      let result: unknown;
      switch (call.method) {
        case 'eth_chainId':
          if (transfers.getSnapshot().phase === 'submitting' && (mode === 'hold-preflight' ||
              mode === 'hold-replay' && transfers.getSnapshot().review?.retry)) {
            preflight.resolve();
            await release.promise;
          }
          result = '0x1';
          break;
        case 'eth_getBlockByNumber': {
          const hash = confirmed?.hash;
          result = confirmed && call.params[0] === block.number
            ? { ...block, hash: confirmedBlockHash(), transactions: omitTransaction ? [unrelatedHash] : [unrelatedHash, hash] }
            : block;
          if (heldBlock && heldBlock.hash === hash && call.params[0] === block.number) {
            const hold = heldBlock;
            heldBlock = undefined;
            hold.started();
            await hold.wait;
          }
          break;
        }
        case 'eth_getCode':
          if (call.params[0] === owner) {
            assert.ok(call.params[1] === 'latest' || call.params[1] === 'pending');
            result = '0x';
          } else {
            assert.deepEqual(call.params, [contractAddress, block.number]);
            result = '0x6000';
          }
          break;
        case 'eth_call': {
          const callTx = call.params[0] as { from?: string; to: string; data: string };
          assert.equal(call.params[1], block.number);
          assert.equal(callTx.to, contractAddress);
          if (callTx.from !== undefined) {
            assert.deepEqual(callTx, { from: owner, to: contractAddress, value: '0x0', data: asset.data });
            result = '0x';
            break;
          }
          const { name, args } = abi.parseTransaction(callTx)!;
          if (name === 'ownerOf') {
            assert.equal(asset.collectible.tokenStandard, 'ERC-721');
            if (args[0].toString() !== asset.tokenId) {
              return Response.json({ jsonrpc: '2.0', id: call.id, error: {
                code: 3,
                message: 'execution reverted',
                data: abi.encodeErrorResult('ERC721NonexistentToken', [args[0]]),
              } });
            }
            result = abi.encodeFunctionResult(name, [hasHolding ? owner : recipient]);
          } else if (name === 'balanceOf') {
            assert.equal(asset.collectible.tokenStandard, 'ERC-1155');
            assert.equal(args[0], owner);
            assert.notEqual(args[1].toString(), asset.tokenId);
            result = abi.encodeFunctionResult(name, [0]);
          } else {
            assert.equal(name, 'balanceOfBatch');
            assert.deepEqual(Array.from(args[0]), [owner]);
            assert.deepEqual(Array.from(args[1]), [BigInt(asset.tokenId)]);
            result = abi.encodeFunctionResult(name, [[hasHolding ? asset.units : 0]]);
          }
          break;
        }
        case 'eth_getTransactionCount':
          assert.equal(call.params[0], owner);
          const minedNonce = confirmed ? '0x' + (confirmed.nonce + 1).toString(16) : canonicalNonce ?? '0x0';
          result = call.params[1] === 'pending' ? pendingNonce ?? minedNonce : minedNonce;
          break;
        case 'eth_getBalance':
          assert.equal(call.params[0], owner);
          assert.ok(call.params[1] === 'pending' || call.params[1] === 'latest');
          result = expectedEstimateTag === 'latest' && call.params[1] === 'pending'
            ? '0x1' : '0xffffffffffff';
          break;
        case 'eth_gasPrice':
          result = '0x65';
          break;
        case 'eth_maxPriorityFeePerGas':
          result = '0x2';
          break;
        case 'eth_estimateGas':
          if ((call.params[0] as { to: string }).to === recipient) {
            assert.deepEqual(call.params, [{
              from: owner, to: recipient, value: '0x1', data: '0x', type: '0x2',
              chainId: '0x1', nonce: confirmed ? '0x1' : '0x0', maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2',
            }, 'pending']);
            result = '0x5208';
          } else {
            assert.deepEqual(call.params, [{
              from: owner, to: contractAddress, value: '0x0', data: asset.data, type: '0x2',
              chainId: '0x1', nonce: expectedEstimateNonce ?? pendingNonce ?? '0x0', maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2',
            }, expectedEstimateTag]);
            result = '0x7530';
          }
          break;
        case 'eth_getTransactionReceipt':
          result = null;
          if (confirmed && call.params[0] === confirmed.hash) {
            const fault = ++confirmationsRead === invalidObservation?.readNumber ? invalidObservation.mode : undefined;
            omitTransaction = fault === 'absent-transaction';
            if (fault === 'reorg') {
              confirmed = undefined;
            } else {
              result = { transactionHash: fault === 'different-hash' ? '0x' + 'b'.repeat(64) : confirmed.hash,
                from: confirmed.from, to: confirmed.to, blockHash: confirmedBlockHash(), blockNumber: block.number,
                transactionIndex: fault === 'wrong-index' ? '0x0' : '0x1', status: '0x1' };
            }
          }
          break;
        case 'eth_getTransactionByHash':
          result = null;
          break;
        case 'eth_sendRawTransaction': {
          assert.equal(transfers.getSnapshot().phase, 'submitting');
          assert.equal(call.params.length, 1);
          const raw = call.params[0];
          assert.equal(typeof raw, 'string');
          const signed = Transaction.from(raw as string);
          // Inspect the committed database synchronously at fetch invocation.
          // The runtime's own queue could wait and observe a later commit.
          const observer = new DatabaseSync(file, { readOnly: true });
          try {
            const rows = observer.prepare('SELECT value FROM evm_signed_records').all();
            assert.equal(rows.length, 1);
            const persisted = rows[0]?.value;
            assert.equal(typeof persisted, 'string');
            const row = JSON.parse(persisted as string).entries.find((entry: { hash: string }) => entry.hash === signed.hash);
            assert.equal(row.hash, signed.hash);
            assert.equal(row.phase, 'signed');
            const operation = signed.to === owner ? 'cancel' : signed.to === recipient ? 'send'
              : asset.collectible.tokenStandard === 'ERC-721' ? 'erc721' : 'erc1155';
            assert.equal(row.operation, operation);
            assert.equal(Object.hasOwn(row, 'metadata'), false);
            assert.equal((persisted as string).includes(raw as string), false);
          } finally {
            observer.close();
          }
          if (mode === 'hold-adapter') {
            assert.ok(init.signal);
            adapterEntered.resolve(init.signal);
            // Model the native fetch adapter's await before physical admission.
            await adapterRelease.promise;
            const aborted = init.signal.aborted;
            adapterObservedAbort.resolve(aborted);
            if (aborted) throw Error('Synthetic adapter aborted before physical send');
          }
          posted.push(raw as string);
          if (mode === 'lost-ack' || mode === 'hold-replay') throw Error('Synthetic loss after POST');
          result = signed.hash;
          break;
        }
        default:
          assert.fail('Unexpected RPC method ' + call.method);
      }
      return Response.json({ jsonrpc: '2.0', id: call.id, result });
    },
  });
  let transfers = openTransfers();
  try {
    await authority.initialize();
    await authority.importPhrase(phrase, password);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    authority.lock();
    await authority.unlock(password);
    assert.equal(authority.getSnapshot().account?.address, owner);
    const registry = runtime.tokens!;
    let revision = (await registry.addCollectible(0, asset.collectible, current)).revision;
    const replaceSaved = async () => {
      const removed = await registry.removeCollectible(revision, asset.collectible, current);
      revision = (await registry.addCollectible(removed.revision, asset.collectible, current)).revision;
    };
    await exercise({
      transfers, calls, posted, retained, replaceSaved, advanceClock: (milliseconds) => { clockOffset += milliseconds; },
      async retainedBytes(hash) {
        return (await (await runtime.transfers!.journal(current)).load(hash))?.rawTransaction;
      },
      async reopen() {
        transfers.dispose();
        await authority.dispose();
        authority = openAuthority();
        transfers = openTransfers();
        await authority.initialize();
        await authority.unlock(password);
        return transfers;
      },
      setPendingNonce(nonce) { pendingNonce = nonce; },
      setCanonicalNonce(nonce) { canonicalNonce = nonce; },
      setExpectedEstimateNonce(nonce, tag) { expectedEstimateNonce = nonce; expectedEstimateTag = tag; },
      confirmOnChain(raw) { confirmed = Transaction.from(raw); confirmationsRead = 0; },
      invalidateCancellationObservation(mode, readNumber) { invalidObservation = { mode, readNumber }; },
      holdOriginalObservation(hash) {
        const started = Promise.withResolvers<void>();
        heldBlock = { hash, started: started.resolve, wait: releaseHeldBlock.promise };
        return { started: started.promise, release: releaseHeldBlock.resolve, async observe() {
          const concurrent = openTransfers();
          try { await concurrent.recover(false, hash); }
          finally { concurrent.dispose(); }
        } };
      },
      reorg() { confirmed = undefined; invalidObservation = undefined; omitTransaction = false; },
      removeHolding: () => { hasHolding = false; },
      preflight: preflight.promise,
      releasePreflight: () => release.resolve(),
      signedCommit: committed.promise,
      acknowledgeCommit: () => acknowledge.resolve(),
      adapterEntered: adapterEntered.promise,
      adapterObservedAbort: adapterObservedAbort.promise,
      releaseAdapter: () => adapterRelease.resolve(),
    });
    assert.equal(networkCalls, 0);
  } finally {
    releaseHeldBlock.resolve();
    acknowledge.resolve();
    release.resolve();
    adapterRelease.resolve();
    transfers.dispose();
    try { await authority.dispose(); }
    finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function reviewCollectible(transfers: NativeTransfers, asset: Case) {
  await transfers.prepareCollectible(asset.collectible, recipient, asset.tokenId, asset.units);
  const snapshot = transfers.getSnapshot();
  assert.equal(snapshot.phase, 'review');
  const review = snapshot.review!;
  assert.deepEqual(review.collectible, {
    kind: 'nft-transfer',
    chainId: '1',
    from: owner,
    contractAddress,
    recipient,
    tokenStandard: asset.collectible.tokenStandard,
    tokenId: asset.tokenId,
    amountUnits: asset.units,
  });
  assert.equal(review.recipient, recipient);
  assert.equal(review.amountUnits, asset.units);
  assert.equal(review.nonce, '0');
  assert.equal(review.gasLimit, '36000');
  assert.equal(review.maximumFeeUnits, '9072000');
  assert.equal(review.totalUnits, review.maximumFeeUnits);
  assert.equal(review.context.registrationHash, network.registrationHash);
  assert.equal(review.intent, undefined);
  assert.equal(Object.hasOwn(review, 'rawTransaction'), false);
  assert.equal(Object.hasOwn(review, 'transaction'), false);
  return review.id;
}

test('collectible review preserves an explicit override below the external pending count', async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'success', async ({ transfers, posted, setPendingNonce, setExpectedEstimateNonce, acknowledgeCommit }) => {
    acknowledgeCommit();
    setPendingNonce('0x1');
    setExpectedEstimateNonce('0x0', 'latest');
    await transfers.view.prepareCollectible(asset.collectible, recipient, asset.tokenId, asset.units, '0');
    const approved = transfers.getSnapshot().review!;
    assert.equal(approved.nonce, '0');
    assert.equal(approved.nonceOverride, 0);
    await transfers.confirm(approved.id);
    assert.deepEqual(posted.map((bytes) => Transaction.from(bytes).nonce), [0]);
  });
});

test('a collectible waits for an earlier native send to become canonical', async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'success', async ({ transfers, calls, posted, retained, setPendingNonce, setCanonicalNonce, setExpectedEstimateNonce, acknowledgeCommit }) => {
    acknowledgeCommit();
    await transfers.prepare(recipient, '0.000000000000000001');
    await transfers.confirm(transfers.getSnapshot().review!.id);
    assert.equal(posted.length, 1);

    // An acknowledged earlier nonce must block even when the endpoint's
    // pending count has not yet caught up.
    await assert.rejects(transfers.prepareCollectible(asset.collectible, recipient, asset.tokenId, asset.units), { code: 'EXPIRED' });
    assert.match(transfers.getSnapshot().message ?? '', /network is still updating/);
    assert.equal(posted.length, 1);

    // Pending progress alone is not canonical asset state.
    setPendingNonce('0x1');
    await assert.rejects(transfers.prepareCollectible(asset.collectible, recipient, asset.tokenId, asset.units), { code: 'EXPIRED' });
    assert.match(transfers.getSnapshot().message ?? '', /network is still updating/);
    assert.equal(posted.length, 1);

    // The fixture advances both the sampled-block and latest account count.
    setCanonicalNonce('0x1');
    setExpectedEstimateNonce('0x1', 'pending');
    await transfers.prepareCollectible(asset.collectible, recipient, asset.tokenId, asset.units);
    const approved = transfers.getSnapshot().review!;
    assert.equal(approved.nonce, '1');
    const firstConfirmCall = calls.length;
    await transfers.confirm(approved.id);
    assert.deepEqual(posted.map((bytes) => Transaction.from(bytes).nonce), [0, 1]);
    assert.equal((await retained()).length, 2);
    assert.equal(calls.slice(firstConfirmCall).filter(({ method, params }) =>
      method === 'eth_getTransactionCount' && params[1] === 'pending').length, 2,
    'confirmation reads pending once to refresh the review and once at wire admission');
  });
});

for (const tokenStandard of ['ERC-721', 'ERC-1155'] as const) {
  test(`controller signs and posts the exact reviewed ${tokenStandard} only after durable acknowledgement`, async () => {
    const asset = collectibleFixture(tokenStandard);
    await withController(asset, 'success', async ({
      transfers, calls, posted, retained, signedCommit, acknowledgeCommit,
    }) => {
      await assert.rejects(transfers.confirm('no-review'), { code: 'EXPIRED' });
      assert.equal(calls.length, 0);
      const id = await reviewCollectible(transfers, asset);
      assert.equal(calls.filter((call) => call.method === 'eth_estimateGas').length, 1);
      assert.equal(calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
      assert.deepEqual(await retained(), []);
      const confirmation = transfers.confirm(id);
      await Promise.race([
        signedCommit,
        confirmation.then(() => assert.fail('Confirmation crossed the held SQLite acknowledgement')),
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
      acknowledgeCommit();
      await confirmation;
      assert.equal(calls.filter((call) => call.method === 'eth_estimateGas').length, 3);
      assert.equal(posted.length, 1);
      const expected = await wallet.signTransaction({
        chainId: 1, type: 2, to: contractAddress, data: asset.data, value: 0, nonce: 0,
        gasLimit: 36000, maxFeePerGas: 252, maxPriorityFeePerGas: 2,
      });
      assert.equal(posted[0], expected);
      const hash = Transaction.from(expected).hash;
      assert.equal(transfers.getSnapshot().phase, 'pending');
      assert.equal(transfers.getSnapshot().hash, hash);
      assert.equal(transfers.getSnapshot().collectible?.tokenStandard, tokenStandard);
      const [record] = await retained();
      assert.equal(record?.hash, hash);
      assert.equal(record?.phase, 'submitted');
      await assert.rejects(transfers.confirm(id), { code: 'EXPIRED' });
      assert.equal(posted.length, 1);
    });
  });
}

test('remove and re-add retires an existing NFT review before signing or POST', async () => {
  const asset = collectibleFixture('ERC-1155');
  await withController(asset, 'success', async ({ transfers, calls, posted, retained, replaceSaved }) => {
    const id = await reviewCollectible(transfers, asset);
    const requestCount = calls.length;
    await replaceSaved();
    await assert.rejects(transfers.confirm(id), { code: 'COLLECTIBLE_CHANGED' });
    assert.equal(calls.length, requestCount);
    assert.equal(posted.length, 0);
    assert.deepEqual(await retained(), []);
    assert.equal(transfers.getSnapshot().review, null);
  });
});

test('remove and re-add while NFT broadcast preflight waits preserves the signed record without POST', async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'hold-preflight', async ({
    transfers, calls, posted, retained, replaceSaved, preflight, releasePreflight,
  }) => {
    const id = await reviewCollectible(transfers, asset);
    const pending = transfers.confirm(id);
    await Promise.race([
      preflight,
      pending.then(() => assert.fail('Confirmation finished before the held chain preflight')),
    ]);
    assert.equal(transfers.getSnapshot().phase, 'submitting');
    const [saved] = await retained();
    assert.equal(saved?.phase, 'signed');
    assert.equal(saved?.operation, 'erc721');
    await replaceSaved();
    releasePreflight();
    await assert.rejects(pending, { code: 'COLLECTIBLE_CHANGED' });
    const outcome = transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.review, null);
    assert.equal(outcome.hash, saved?.hash);
    assert.equal(outcome.collectible?.tokenStandard, 'ERC-721');
    assert.match(outcome.message ?? '', /saved and did not broadcast/);
    assert.deepEqual(await retained(), [saved]);
    assert.equal(posted.length, 0);
    assert.equal(calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
    await transfers.recover(true, saved?.hash);
    const retry = transfers.getSnapshot().review;
    assert.equal(retry?.collectible?.tokenStandard, 'ERC-721');
    assert.equal(retry?.replay?.hash, saved?.hash);
    assert.equal(posted.length, 0);
    await transfers.confirm(retry!.id);
    assert.equal(transfers.getSnapshot().phase, 'pending');
    assert.equal(posted.length, 1);
    assert.equal(Transaction.from(posted[0]!).hash, saved?.hash);
  });
});

test('inventory retirement after NFT POST invocation preserves the exact acknowledgement', async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'hold-adapter', async ({
    transfers, calls, posted, retained, replaceSaved, adapterEntered,
    adapterObservedAbort, releaseAdapter,
  }) => {
    const id = await reviewCollectible(transfers, asset);
    const pending = transfers.confirm(id);
    const signal = await Promise.race([
      adapterEntered,
      pending.then(() => assert.fail('Confirmation finished before the async adapter hold')),
    ]);
    assert.equal(signal.aborted, false);
    assert.equal(calls.filter((call) => call.method === 'eth_sendRawTransaction').length, 1);
    const [saved] = await retained();
    assert.equal(saved?.phase, 'signed');
    assert.equal(saved?.operation, 'erc721');

    const replacing = replaceSaved();
    assert.equal(signal.aborted, false);
    releaseAdapter();
    await replacing;
    assert.equal(await adapterObservedAbort, false);
    await pending;

    const outcome = transfers.getSnapshot();
    assert.equal(posted.length, 1);
    assert.equal(outcome.phase, 'pending');
    assert.equal(outcome.review, null);
    assert.equal(outcome.hash, saved?.hash);
    assert.equal(outcome.collectible?.tokenStandard, 'ERC-721');
    assert.equal((await retained())[0]?.phase, 'submitted');
  });
});

test('NFT POST with a lost acknowledgement stays unknown and has no automatic resend', async () => {
  const asset = collectibleFixture('ERC-1155');
  await withController(asset, 'lost-ack', async ({ transfers, calls, posted, retained }) => {
    const id = await reviewCollectible(transfers, asset);
    await transfers.confirm(id);
    const outcome = transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.review, null);
    assert.equal(outcome.collectible?.tokenStandard, 'ERC-1155');
    assert.match(outcome.message ?? '', /Submission could not be confirmed/);
    assert.equal(posted.length, 1);
    assert.equal(calls.filter((call) => call.method === 'eth_sendRawTransaction').length, 1);
    const [saved] = await retained();
    assert.equal(saved?.phase, 'signed');
    assert.equal(saved?.hash, outcome.hash);
    await transfers.recover(true, outcome.hash!);
    const retry = transfers.getSnapshot().review;
    assert.equal(transfers.getSnapshot().phase, 'review');
    assert.equal(retry?.collectible?.tokenStandard, 'ERC-1155');
    assert.equal(posted.length, 1);
    await transfers.confirm(retry!.id);
    assert.equal(transfers.getSnapshot().phase, 'unknown');
    assert.deepEqual(posted, [posted[0], posted[0]]);
  });
});

test('an explicitly approved NFT retry cannot dispatch after a held preflight expires', { timeout: 5_000 }, async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'hold-replay', async ({ transfers, calls, posted, retained, advanceClock, preflight, releasePreflight }) => {
    await transfers.confirm(await reviewCollectible(transfers, asset));
    const first = transfers.getSnapshot().hash!;
    assert.equal(posted.length, 1);
    await transfers.recover(true, first);
    const review = transfers.getSnapshot().review!;
    assert.equal(review.replay?.hash, first);
    const pending = transfers.confirm(review.id);
    await Promise.race([preflight, pending.then(() => assert.fail('Retry did not enter preflight'))]);
    advanceClock(review.replay!.validForMs);
    releasePreflight();
    await pending;
    assert.equal(calls.filter((call) => call.method === 'eth_sendRawTransaction').length, 1);
    assert.equal(transfers.getSnapshot().hash, first);
    assert.equal(transfers.getSnapshot().phase, 'unknown');
    assert.equal((await retained())[0]?.hash, first);
  });
});

test('a saved NFT that loses ownership can be explicitly cancelled after restart and release its nonce', async () => {
  const asset = collectibleFixture('ERC-721');
  await withController(asset, 'success', async ({
    transfers, calls, posted, retained, retainedBytes, reopen, confirmOnChain,
    invalidateCancellationObservation, holdOriginalObservation, reorg, removeHolding, signedCommit, acknowledgeCommit,
  }) => {
    const pending = transfers.confirm(await reviewCollectible(transfers, asset));
    await Promise.race([signedCommit, pending.then(() => assert.fail('Send did not commit a signed record'))]);
    removeHolding();
    acknowledgeCommit();
    await assert.rejects(pending, { code: 'INSUFFICIENT_NFT_BALANCE' });
    const [saved] = await retained();
    assert.equal(saved?.phase, 'signed');
    assert.equal(transfers.getSnapshot().hash, saved?.hash);
    const hash = saved!.hash;
    const original = await retainedBytes(hash);
    assert.ok(original);
    assert.equal(Transaction.from(original).hash, hash);
    const reopened = await reopen();
    assert.equal(await retainedBytes(hash), original);
    await assert.rejects(reopened.prepare(recipient, '0.000000000000000001'), { code: 'PENDING_TRANSFER' });
    await reopened.recover(true, hash);
    const retry = reopened.getSnapshot().review;
    assert.equal(retry?.collectible?.tokenId, asset.tokenId);
    await reopened.confirm(retry!.id);
    assert.match(reopened.getSnapshot().message ?? '', /no longer has enough/);
    assert.equal(reopened.getSnapshot().hash, hash);
    assert.deepEqual(await retained(), [saved]);
    assert.deepEqual(posted, []);
    assert.equal(calls.some((call) => call.method === 'eth_sendRawTransaction'), false);

    // The ordinary pending route still requires a mempool observation.
    await assert.rejects(reopened.prepareCancellation(hash), { code: 'EXPIRED' });
    await reopened.prepareSavedCancellation(hash);
    const review = reopened.getSnapshot().review!;
    assert.equal(review.replacement?.mode, 'cancel');
    assert.equal(review.replacement?.originalHash, hash);
    assert.equal(review.recipient, owner);
    assert.equal(review.nonce, '0');
    assert.equal(review.amountUnits, '0');
    assert.equal(posted.length, 0);
    await reopened.confirm(review.id);
    assert.equal(posted.length, 1);
    const cancel = Transaction.from(posted[0]);
    assert.equal(cancel.from, owner);
    assert.equal(cancel.to, owner);
    assert.equal(cancel.nonce, 0);
    assert.equal(cancel.data, '0x');
    assert.equal(cancel.value, 0n);
    assert.equal(cancel.gasLimit, EVM_CANCELLATION_GAS_LIMIT);
    assert.ok(cancel.maxFeePerGas! > Transaction.from(original).maxFeePerGas!);
    assert.equal(await retainedBytes(hash), original);
    await assert.rejects(reopened.recover(true, hash), { code: 'EXPIRED' });
    assert.equal(posted.length, 1);

    const cancellationHash = cancel.hash!;
    const faults = [
      ['absent-transaction', 1], ['wrong-index', 1],
      ['absent-transaction', 2], ['wrong-index', 2],
      ['different-hash', 2], ['reorg', 2],
    ] as const;
    for (const [fault, readNumber] of faults) {
      confirmOnChain(posted[0]!);
      invalidateCancellationObservation(fault, readNumber);
      await assert.rejects(reopened.recover(false, cancellationHash), { code: 'EXPIRED' });
      const after = await retained();
      assert.equal(after.find((entry) => entry.hash === hash)?.phase, 'signed');
      assert.equal(after.find((entry) => entry.hash === cancellationHash)?.phase, 'submitted');
      assert.equal(await retainedBytes(hash), original);
      assert.equal(posted.length, 1);
    }

    // Fork A mined the original, then fork B mined its competing cancellation.
    reorg();
    confirmOnChain(original);
    await reopened.recover(false, hash);
    assert.equal(reopened.getSnapshot().phase, 'confirmed');
    assert.equal((await retained()).find((entry) => entry.hash === hash)?.phase, 'confirmed');
    const held = holdOriginalObservation(hash);
    const oldObservation = assert.rejects(held.observe(), { code: 'EXPIRED' });
    await held.started;
    confirmOnChain(posted[0]!);
    try { await reopened.recover(false, cancellationHash); }
    finally { held.release(); }
    await oldObservation;
    assert.equal(reopened.getSnapshot().phase, 'confirmed');
    assert.equal((await retained()).find((entry) => entry.hash === hash)?.phase, 'nonce-consumed');
    assert.equal(await retainedBytes(hash), original);

    // Reopening observed phases after a reorg never revives spending replay.
    reorg();
    const beforeFence = await retained();
    await reopened.prepare(recipient, '0.000000000000000001');
    const unexpectedSpend = reopened.getSnapshot().review;
    if (unexpectedSpend)
      await reopened.confirm(unexpectedSpend.id).catch(() => undefined);
    assert.deepEqual(await retained(), beforeFence, 'No new spending record may cross the cancellation fence');
    assert.equal(posted.length, 1);
    assert.equal(reopened.getSnapshot().phase, 'unknown');
    assert.equal(reopened.getSnapshot().review, null);
    assert.equal(reopened.getSnapshot().hash, cancellationHash);
    assert.match(reopened.getSnapshot().message ?? '', /saved cancellation/i);
    await reopened.recover(true, cancellationHash);
    const retryCancellation = reopened.getSnapshot().review;
    assert.equal(retryCancellation?.replay?.hash, cancellationHash);
    assert.equal(retryCancellation?.replay?.operation, 'cancel');
    assert.equal(await retainedBytes(cancellationHash), posted[0]);
    assert.equal(posted.length, 1);
    await reopened.recover(false, cancellationHash);
    assert.equal((await retained()).find((entry) => entry.hash === cancellationHash)?.phase, 'submitted');
    await assert.rejects(reopened.recover(true, hash), { code: 'EXPIRED' });
    assert.equal(await retainedBytes(hash), original);
    assert.equal(posted.length, 1);

    confirmOnChain(posted[0]!);
    await reopened.recover(false, cancellationHash);
    await reopened.prepare(recipient, '0.000000000000000001');
    const next = reopened.getSnapshot().review!;
    assert.equal(next.nonce, '1');
    await reopened.confirm(next.id);
    assert.equal(posted.length, 2);
    assert.equal(Transaction.from(posted[1]).nonce, 1);
    assert.equal(await retainedBytes(hash), original);
  });
});
