import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { Interface } from 'ethers/abi';
import { readEvmAssetState, assertEvmAssetStateCanonical, simulateEvmAssetTransfer, type EvmAssetRead } from '../../../source/shared/evmAssetState.ts';
import type { NativeTransferDispatchValidation } from '../src/custody/transfers.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import { createKeyringRuntimeFactory, type KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  encodeNftTransferData,
  snapshotNftTransferIntent,
} from '../../../source/shared/nftTransfer.ts';
import { digest, INSTALLATION, nodeConnection } from './storageHelpers.ts';

const phrase =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'Public collectible fixture password 2!';
const wallet = Wallet.fromPhrase(phrase);
const from = wallet.address;
const contractAddress = '0x2222222222222222222222222222222222222222';
const multiContract = '0x52908400098527886E0F7030069857D2E4169EE7';
const recipient = '0x1111111111111111111111111111111111111111';
const max = ((1n << 256n) - 1n).toString();
const current = () => undefined;
const fixture = (tokenStandard: 'ERC-721' | 'ERC-1155', nonce: string) => {
  const is721 = tokenStandard === 'ERC-721';
  const target = is721 ? contractAddress : multiContract;
  const intent = snapshotNftTransferIntent({
    kind: 'nft-transfer', chainId: '1', from, contractAddress: target, recipient,
    tokenStandard, tokenId: is721 ? '0' : max, amountUnits: is721 ? '1' : max,
  });
  const approved = {
    from, to: target, chainId: '1', nonce, value: '0',
    data: encodeNftTransferData(intent), gasLimit: '150000',
    ...(is721
      ? { type: 2 as const, maxFeePerGas: '3', maxPriorityFeePerGas: '1' }
      : { type: 0 as const, gasPrice: '2' }),
  };
  return { intent, approved };
};

const validationFor = ({ intent, approved }: ReturnType<typeof fixture>): NativeTransferDispatchValidation => {
  const abi = new Interface(['function ownerOf(uint256) view returns(address)',
    'function balanceOf(address,uint256) view returns(uint256)',
    'function balanceOfBatch(address[],uint256[]) view returns(uint256[])',
    'error ERC721NonexistentToken(uint256)']);
  const asset = { standard: intent.tokenStandard === 'ERC-721' ? 'ERC721' as const : 'ERC1155' as const,
    contractAddress: intent.contractAddress, amountUnits: intent.amountUnits, tokenId: intent.tokenId };
  const block = { number: '0x1', hash: `0x${'a'.repeat(64)}` };
  const read: EvmAssetRead = async (method, params) => {
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getCode') return '0x6000';
    const call = params[0] as { from?: string; data: string };
    if (call.from) return '0x';
    const { name, args } = abi.parseTransaction(call)!;
    if (name === 'ownerOf') {
      if (args[0].toString() !== intent.tokenId)
        throw { code: 3, message: 'execution reverted', data: abi.encodeErrorResult('ERC721NonexistentToken', [args[0]]) };
      return abi.encodeFunctionResult(name, [from]);
    }
    if (name === 'balanceOf') return abi.encodeFunctionResult(name, [0]);
    assert.equal(name, 'balanceOfBatch');
    return abi.encodeFunctionResult(name, [[intent.amountUnits]]);
  };
  return async (planner, assertCurrent) => {
    assertCurrent();
    const state = await readEvmAssetState(read, from, asset);
    const plan = await planner({ latest: 0, pending: Number(approved.nonce), assetState: state,
      readPending: async () => null, assertCurrent });
    assert.equal(plan.kind, 'ready');
    assert.equal(plan.nonce, Number(approved.nonce));
    await simulateEvmAssetTransfer(read, state, approved, 'automatic');
    await assertEvmAssetStateCanonical(read, state);
    assertCurrent();
  };
};

test('published SDK and real SQLite bind saved collectibles, exact envelopes and dispatch lifecycle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pali-nft-runtime-'));
  const file = join(directory, 'wallet.sqlite');
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error('Public network forbidden');
  };
  let runtime!: KeyringRuntime;
  let storage!: SqliteWalletStorage;
  let authority: NativeCustodyAuthority | undefined;
  let held: { entered: PromiseWithResolvers<string>; release: PromiseWithResolvers<void> } | undefined;
  let heldRegistryWrite: { entered: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> } | undefined;
  const factory = createKeyringRuntimeFactory({ readEvmRetirement: null,
    async ensureCryptoReady() { assert.ok(globalThis.crypto.subtle); },
    async openStorage() {
      const fresh = !existsSync(file);
      let wroteSigned = false;
      const sql = nodeConnection(file, {
        async after(kind, statement) {
          const write = heldRegistryWrite;
          if (write && kind === 'run' && statement.startsWith('UPDATE keyring_records SET value = ? WHERE key = ?')) {
            write.entered.resolve();
            await write.release.promise;
          }
          if (kind === 'run' && statement.startsWith('INSERT INTO evm_signed_records')) wroteSigned = true;
          if (kind !== 'exec' || statement !== 'COMMIT' || !wroteSigned) return;
          wroteSigned = false;
          if (held) {
            const row = sql.database.prepare('SELECT value FROM evm_signed_records').get();
            assert.equal(typeof row?.value, 'string');
            held.entered.resolve(row!.value as string);
            await held.release.promise;
          }
        },
      });
      storage = await SqliteWalletStorage.open(sql.connection, digest, INSTALLATION, fresh);
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
    return authority;
  };
  try {
    const owner = await open();
    await owner.importPhrase(phrase, password);
    await runtime.backup.confirm(await runtime.backup.fingerprint());
    owner.lock();
    await owner.unlock(password);
    assert.equal(owner.getSnapshot().account?.address, from);
    const transfers = runtime.transfers!;
    const { intent, approved } = fixture('ERC-721', '0');
    const noBroadcast = async () => assert.fail('Unapproved NFT dispatch');

    const registry = runtime.tokens!;
    const resolveCollectible = transfers.collectible!;
    const single = { contractAddress, tokenStandard: 'ERC-721' as const };
    const multi = { contractAddress: multiContract, tokenStandard: 'ERC-1155' as const, tokenId: max };
    await assert.rejects(resolveCollectible(single, current), { code: 'NOT_READY' });
    const addedSingle = await registry.addCollectible(0, single, current);
    const addedMulti = await registry.addCollectible(addedSingle.revision, multi, current);
    for (const candidate of [
      { ...multi, tokenId: '0' },
      { contractAddress: multiContract, tokenStandard: 'ERC-721' as const },
      { ...single, contractAddress: recipient },
    ]) await assert.rejects(resolveCollectible(candidate, current), { code: 'NOT_READY' });

    let invocationCurrent = true;
    const proof = await resolveCollectible({
      ...multi, contractAddress: multiContract.toLowerCase(), tokenId: '0x' + 'f'.repeat(64),
    }, () => { if (!invocationCurrent) throw Error('Lookup retired'); });
    assert.deepEqual(proof.collectible, multi);
    assert(Object.isFrozen(proof));
    assert(Object.isFrozen(proof.collectible));
    invocationCurrent = false;
    proof.assertCurrent();
    assert.equal(proof.signal.aborted, false);
    await registry.load(current);
    proof.assertCurrent();
    await assert.rejects(registry.removeCollectible(addedMulti.revision, multi,
      () => { throw Error('Mutation denied'); }), /Mutation denied/);
    proof.assertCurrent();
    assert.equal(proof.signal.aborted, false);

    let reentrantRemoval: Promise<unknown> | undefined;
    const secondProof = await resolveCollectible(multi, () => {
      if (reentrantRemoval) return;
      reentrantRemoval = registry.removeCollectible(addedMulti.revision, multi, current);
      void reentrantRemoval.catch(() => undefined);
    });
    await assert.rejects(reentrantRemoval!, { code: 'BUSY' });
    secondProof.assertCurrent();
    assert.equal(secondProof.signal, proof.signal);
    assert.equal(proof.signal.aborted, false);
    let abortEvents = 0;
    proof.signal.addEventListener('abort', () => { abortEvents++; });
    const registryGate = { entered: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
    heldRegistryWrite = registryGate;
    const removing = registry.removeCollectible(addedMulti.revision, multi, current);
    void removing.catch(() => undefined);
    assert.equal(proof.signal.aborted, true);
    assert.equal(abortEvents, 1);
    assert.throws(proof.assertCurrent, { code: 'CANCELLED' });
    assert.throws(secondProof.assertCurrent, { code: 'CANCELLED' });
    await Promise.race([
      registryGate.entered.promise,
      removing.then(() => assert.fail('Registry write skipped the SQLite hold')),
    ]);
    assert.equal(proof.signal.aborted, true);
    heldRegistryWrite = undefined;
    registryGate.release.resolve();
    const removed = await removing;
    await assert.rejects(resolveCollectible(multi, current), { code: 'NOT_READY' });
    await registry.addCollectible(removed.revision, multi, current);
    assert.throws(proof.assertCurrent, { code: 'CANCELLED' });
    const beforeSelection = await resolveCollectible(multi, current);
    assert.notEqual(beforeSelection.signal, proof.signal);
    assert.equal(beforeSelection.signal.aborted, false);
    const manage = (change: Parameters<NativeCustodyAuthority['manageAccounts']>[0]) =>
      owner.manageAccounts(change, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const createSecond = manage({ kind: 'create', label: 'Second account', password });
    assert.equal(beforeSelection.signal.aborted, true);
    await createSecond;
    await assert.rejects(resolveCollectible(multi, current), { code: 'NOT_READY' });
    await manage({ kind: 'select', id: 'hd:60:0' });
    assert.throws(beforeSelection.assertCurrent, /CANCELLED/);
    const beforeNetwork = await resolveCollectible(multi, current);
    assert.equal(beforeNetwork.signal.aborted, false);
    const selectNetwork = (networkId: string) =>
      owner.selectNetwork(networkId, owner.getSnapshot().revision, owner.getCatalogue()!.revision);
    const changeNetwork = selectNetwork('base');
    assert.equal(beforeNetwork.signal.aborted, true);
    await changeNetwork;
    await assert.rejects(resolveCollectible(multi, current), { code: 'NOT_READY' });
    await selectNetwork('ethereum');
    assert.throws(beforeNetwork.assertCurrent, /CANCELLED/);
    const currentSingle = (await resolveCollectible(single, current)).assertCurrent;
    const proofForSubmission = await resolveCollectible(multi, current);
    const currentMulti = proofForSubmission.assertCurrent;

    for (const altered of [
      { ...approved, from: recipient },
      { ...approved, to: recipient },
      { ...approved, value: '1' },
      { ...approved, chainId: '57' },
      { ...approved, data: approved.data + '00' },
    ])
      await assert.rejects(transfers.sign(altered, current, intent), { code: 'INVALID_INPUT' });
    await assert.rejects(transfers.sign(approved, current), { code: 'INVALID_INPUT' });
    assert.equal(owner.getSnapshot().phase, 'ready');

    const signed = await transfers.sign(approved, currentSingle, intent);
    const expected = await wallet.signTransaction({ ...approved, nonce: 0 });
    assert.equal(signed.rawTransaction, expected);
    assert.equal(Transaction.from(signed.rawTransaction).from, from);
    assert.equal((await storage.recovery.readSnapshot()).signedRecords.length, 0);

    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, current, noBroadcast, intent, approved), { code: 'EXPIRED' });
    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, current, noBroadcast, intent, undefined!));
    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, current, noBroadcast, undefined, undefined!));
    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, current, noBroadcast, intent, {
      ...approved, nonce: '1',
    }, undefined, validationFor({ intent, approved })), /does not match expected unsigned envelope/);
    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, current, noBroadcast, intent, {
      ...approved, gasLimit: '160000',
    }, undefined, validationFor({ intent, approved })), /does not match expected unsigned envelope/);
    const accessList = await wallet.signTransaction({ ...approved, nonce: 0, accessList: [
      { address: contractAddress, storageKeys: ['0x' + '1'.repeat(64)] },
    ] });
    await assert.rejects(transfers.submit(accessList, Transaction.from(accessList).hash!, current, noBroadcast, intent, approved, undefined, validationFor({ intent, approved })),
      /does not match expected unsigned envelope/);
    const otherWallet = new Wallet('0x' + '01'.repeat(32));
    const otherSigned = await otherWallet.signTransaction({ ...approved, from: otherWallet.address, nonce: 0 });
    await assert.rejects(transfers.submit(otherSigned, Transaction.from(otherSigned).hash!, current, noBroadcast, intent, approved, undefined, validationFor({ intent, approved })));
    await assert.rejects(transfers.submit(signed.rawTransaction, signed.hash, () => { throw Error('Stale review'); },
      noBroadcast, intent, approved, undefined, validationFor({ intent, approved })), /Stale review/);
    assert.equal((await storage.recovery.readSnapshot()).signedRecords.length, 0);

    let sent = 0;
    const mutableApproval = { ...approved };
    const mutableIntent = { ...intent };
    const dispatch = transfers.submit(signed.rawTransaction, signed.hash, currentSingle, ({ rawTransaction, admit }) => admit(async () => {
      assert.equal(rawTransaction, signed.rawTransaction);
      const { signedRecords } = await storage.recovery.readSnapshot();
      assert.equal(signedRecords.length, 1);
      assert.equal(signedRecords[0]!.value.includes(signed.rawTransaction), false);
      const row = JSON.parse(signedRecords[0]!.value).entries[0];
      assert.equal(row.operation, 'erc721');
      assert.equal(row.phase, 'signed');
      assert.equal(row.hash, signed.hash);
      assert.equal(Object.hasOwn(row, 'metadata'), false);
      sent++;
      return signed.hash;
    }, async () => undefined), mutableIntent, mutableApproval, undefined, validationFor({ intent, approved }));
    mutableApproval.nonce = '17';
    mutableIntent.recipient = contractAddress;
    await dispatch;
    assert.equal(sent, 1);

    const multiple = fixture('ERC-1155', '1');
    const signed1155 = await transfers.sign(multiple.approved, currentMulti, multiple.intent);
    assert.equal(signed1155.rawTransaction, await wallet.signTransaction({ ...multiple.approved, nonce: 1 }));
    const gate = { entered: Promise.withResolvers<string>(), release: Promise.withResolvers<void>() };
    held = gate;
    const pending = transfers.submit(signed1155.rawTransaction, signed1155.hash, currentMulti, noBroadcast, multiple.intent, multiple.approved, undefined, validationFor(multiple));
    const beforeDispatch = await Promise.race([
      gate.entered.promise,
      pending.then(() => assert.fail('Submission crossed the held acknowledgement')),
    ]);
    const stored = JSON.parse(beforeDispatch).entries.find((entry: { hash: string }) => entry.hash === signed1155.hash);
    assert.equal(stored.operation, 'erc1155');
    assert.equal(Object.hasOwn(stored, 'metadata'), false);
    assert.equal(beforeDispatch.includes(signed1155.rawTransaction), false);
    await assert.rejects(resolveCollectible(multi, current), { code: 'BUSY' });
    assert.equal(proofForSubmission.signal.aborted, false);
    owner.lock();
    assert.equal(proofForSubmission.signal.aborted, true);
    assert.throws(currentMulti, /CANCELLED/);
    gate.release.resolve();
    held = undefined;
    await assert.rejects(pending);
    await assert.rejects(transfers.sign(multiple.approved, current, multiple.intent), { code: 'CANCELLED' });
    await owner.dispose();

    const reopened = await open();
    await reopened.unlock(password);
    const reopenedProof = await runtime.transfers!.collectible!(multi, current);
    assert.deepEqual(reopenedProof.collectible, multi);
    assert.equal(reopenedProof.signal.aborted, false);
    assert.throws(currentMulti, /CANCELLED/);
    const records = (await runtime.activity!.load(current)).locals;
    const semantic721 = records.find((row) => row.hash === signed.hash)?.collectibleTransfer;
    const semantic1155 = records.find((row) => row.hash === signed1155.hash)?.collectibleTransfer;
    assert.deepEqual(semantic721, intent);
    assert.deepEqual(semantic1155, multiple.intent);
    assert.equal(networkRequests, 0);
    await reopened.dispose();
    assert.equal(reopenedProof.signal.aborted, true);
  } finally {
    heldRegistryWrite?.release.resolve();
    held?.release.resolve();
    await authority?.dispose().catch(() => undefined);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
