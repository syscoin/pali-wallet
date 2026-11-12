import { unsignedTransferBytes } from '../src/custody/evmFeeContracts.ts';
import { createTestOperationAuthorizer } from './fixtures/operationAuthorization.ts';
import { authorizePrivateNoteReplay } from '../../../source/wallet/privateNoteReplay.ts';
import { evmSubmissionFailure } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import type { EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
import type { CustodySnapshot, NativeOperationCredential } from '../src/custody/types.ts';
import { NativeTransfers, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE } from '../src/custody/transfers.ts';
import { EvmSignedReplay } from '../../../source/wallet/evmSignedReplay.ts';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { createNativeSignedRecordView } from '../src/custody/sharedSignedRecords.ts';
import { signedRecordTestSession, historicalSignedBundle, submitFixtureEvmTransaction } from './signedRecordTestSession.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeTransferRpc, NativeTransferRpcError } from '../src/custody/transferRpc.ts';
const wallet = Wallet.fromPhrase(
  'test test test test test test test test test test test junk'
);
const to = '0x1111111111111111111111111111111111111111';
const OPERATION_CREDENTIAL = { method: 'device' } as const;
const token = Object.freeze({
  contractAddress: '0x3333333333333333333333333333333333333333',
  name: 'Public fixture token',
  symbol: 'FIX',
  decimals: 2,
});
const otherToken = Object.freeze({
  ...token,
  contractAddress: '0x4444444444444444444444444444444444444444',
  name: 'Other public fixture token',
  symbol: 'OTHER',
});
function fixture(maximumAccountType?: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor' | 'SmartAccount') {
  let state: CustodySnapshot = {
    phase: 'ready',
    revision: 1,
    presence: 'existing',
    backup: 'confirmed',
    account: { network: 'ethereum', address: wallet.address },
    error: null,
  };
  const listeners = new Set<(state: CustodySnapshot) => void>();
  const records: Record<string, unknown> = {};
  let availableBalance = '0x10000000000000000';
  let canonicalBalance: string | undefined;
  let expectedEstimateState: 'latest' | 'pending' | undefined;
  let nonce = '0x0';
  let minedNonce = '0x0';
  let tokenChanged = false;
  let oldBlockReorganized = false;
  const tokenReadsAfterChange: string[] = [];
  const postChangeReads: string[] = [];
  let baseFee = '0x1';
  let dropped = false;
  let final = false;
  let receiptMissing = false;
  let observationUnavailable = false;
  let payerIsEoa = false;
  let signatures = 0;
  let authentications = 0;
  let locks = 0;
  let authenticationError: string | null = null;
  let authenticationRefusal = false;
  const authenticationRefusals = new WeakSet<object>();
  const refusal = (code: string) => { const error = Error(code); authenticationRefusals.add(error); return error; };
  let authenticationGate: Promise<void> | null = null;
  let altered: 'value' | 'signer' | 'hash' | 'oversized' | 'noncanonical' | null = null;
  let signGate: Promise<void> | null = null;
  let beforeCommit: (() => Promise<void>) | undefined;
  let beforeBroadcastChainResponse: (() => Promise<void>) | undefined;
  let postJournalTokenRead: (() => Promise<void>) | undefined;
  let postJournalNonceRead: (() => Promise<void>) | undefined;
  let failWrite = false;
  const broadcasts: string[] = [];
  const rpcMethods: string[] = [];
  const source = {
    getSnapshot: () => state,
    ...(maximumAccountType ? { getCatalogue: () => ({ revision: 1,
      accounts: [{ id: 'maximum-payer', type: maximumAccountType, index: 0, slip44: 60, address: wallet.address, label: 'Maximum payer' }],
      networks: [getNativeNetwork('ethereum')], utxoNetworks: [], active: { accountId: 'maximum-payer', networkId: 'ethereum' as const },
    }) } : {}),
    subscribe(listener: (state: CustodySnapshot) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lock() {
      locks++;
      state = {
        ...state,
        phase: 'locked',
        revision: state.revision + 1,
        account: null,
      };
      for (const listener of listeners) listener(state);
    },
  };
  const signedRecords = new EvmSignedRecords({
    async read(profile) { return records[profile] as string | undefined; },
    async compareAndSet(profile, expected, value, check) {
      if (beforeCommit) await beforeCommit();
      check(); if (records[profile] !== expected) return false;
      if (failWrite) throw Error('Storage unavailable');
      records[profile] = value; return true;
    },
  });
  const operationAuthorization = createTestOperationAuthorizer((credential, check): Promise<void> => runtime.authenticateOperation(credential, check), unsignedTransferBytes);
  const runtime = {
    releaseReplacement() {},
    authorizeOperation: operationAuthorization.authorizeOperation,
    releaseOperationAuthorization: operationAuthorization.releaseOperationAuthorization,
    isAuthenticationRefusal(error: unknown) { return !!error && typeof error === 'object' && authenticationRefusals.has(error); },
    async authenticateOperation(credential: NativeOperationCredential, guard: () => void) {
      guard(); authentications++;
      if (!credential || credential.method !== 'device')
        throw refusal('INVALID_CREDENTIAL');
      if (authenticationGate) await authenticationGate;
      guard();
      if (authenticationError) throw authenticationRefusal ? refusal(authenticationError) : Error(authenticationError);
    },
    evmSubmissionFailure,
    async replacementOriginal(hash: string, mode: 'cancel' | 'speed-up', guard: () => void) {
      const retained = await signedRecords.readReplacement(signedRecordTestSession(guard), '1', wallet.address, hash, mode);
      guard();
      if (!retained?.binding) return null;
      return { rawTransaction: retained.original.rawTransaction, binding: retained.binding, rates: retained.rates };
    },
    replay(guard: () => void, transport: Parameters<import('../src/custody/transfers.ts').NativeTransferRuntime['replay']>[1], options: Parameters<import('../src/custody/transfers.ts').NativeTransferRuntime['replay']>[2]) {
      return new EvmSignedReplay(signedRecords, () => ({authorizeReplay: (entry) => authorizePrivateNoteReplay(entry, guard, async () => { throw Error('Unexpected private replay'); }, async () => { throw new Error('Unexpected private withdrawal'); }),recordSession:signedRecordTestSession(guard),assertCurrent:guard,
        context:{account:{id:0,type:'HDAccount',address:wallet.address},network:{kind:'ethereum',chainId:1,slip44:60,url:getNativeNetwork('ethereum').rpcUrl}},...transport}), options.now, options.randomBytes);
    },
    submit: submitFixtureEvmTransaction(signedRecords),
    async token(contractAddress: string, guard: () => void) {
      guard();
      if (contractAddress === otherToken.contractAddress) return otherToken;
      assert.equal(contractAddress, token.contractAddress);
      return token;
    },
    async journal(guard: () => void) {
      guard();
      return { ...createNativeSignedRecordView(signedRecords, signedRecordTestSession(guard), '1'.repeat(64),
        { index: 0, type: 'HDAccount', address: wallet.address }, getNativeNetwork('ethereum')) };
    },
    assertUnlocked(guard: () => void) { guard(); assert.equal(state.phase, 'ready'); },
    async sign(
      transaction: EvmUnsignedTransfer,
      authority: Parameters<import('../src/custody/transfers.ts').NativeTransferRuntime['sign']>[1]
    ) {
      const guard = authority.assertCurrent;
      operationAuthorization.consume(authority.authorization, transaction, guard);
      guard();
      signatures++;
      if (signGate) await signGate;
      guard();
      const signer = altered === 'signer'
        ? new Wallet(`0x${'22'.repeat(32)}`)
        : wallet;
      const request = transaction.type === 2 ? { ...transaction, accessList: transaction.accessList.map(entry => ({ address: entry.address, storageKeys: [...entry.storageKeys] })) } : transaction;
      const raw = await signer.signTransaction({
        ...request,
        ...(altered === 'signer' ? { from: signer.address } : {}),
        nonce: Number(transaction.nonce),
        ...(altered === 'value' ? { value: '999' } : {}),
      });
      guard();
      const rawTransaction = altered === 'oversized'
        ? raw + '0'.repeat(4098 - raw.length)
        : altered === 'noncanonical'
        ? `0x${raw.slice(2).toUpperCase()}`
        : raw;
      return {
        rawTransaction,
        hash: altered === 'hash' ? `0x${'0'.repeat(64)}` : keccak256(rawTransaction),
      };
    },
  };
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      rpcMethods.push(body.method);
      if (Object.keys(records).length && body.method === 'eth_call' && String(body.params[0].data).startsWith('0x70a08231') && postJournalTokenRead) { const hook = postJournalTokenRead; postJournalTokenRead = undefined; await hook(); }
      if (Object.keys(records).length && body.method === 'eth_getTransactionCount' && postJournalNonceRead) { const hook = postJournalNonceRead; postJournalNonceRead = undefined; await hook(); }
      if (tokenChanged && (body.method === 'eth_getTransactionCount' || body.method === 'eth_getBlockByNumber' || body.method === 'eth_chainId')) postChangeReads.push(body.method + ':' + (body.method === 'eth_getTransactionCount' ? body.params[1] : body.method === 'eth_getBlockByNumber' ? body.params[0] : ''));
      if (observationUnavailable && body.method === 'eth_getTransactionReceipt')
        throw Error('Observation unavailable');
      let result: unknown;
      if (body.method === 'eth_chainId') {
        if (Object.keys(records).length > 0 && beforeBroadcastChainResponse)
          await beforeBroadcastChainResponse();
        result = '0x1';
      }
      else if (body.method === 'eth_getCode')
        result = payerIsEoa && String(body.params[0]).toLowerCase() === wallet.address.toLowerCase() ? '0x' : '0x6000';
      else if (body.method === 'eth_call') {
        const selector = String(body.params[0].data).slice(0, 10);
        if (tokenChanged && (selector === '0x70a08231' || selector === '0xa9059cbb'))
          tokenReadsAfterChange.push(`${selector}:${String(body.params[1])}`);
        result = '0x' + (selector === '0x313ce567' ? 2n
          : selector === '0x70a08231'
          ? (tokenChanged && body.params[1] === '0x21' ? 0n : 10000n)
          : selector === '0xa9059cbb' && tokenChanged && body.params[1] === '0x21' ? 0n
          : 1n).toString(16).padStart(64, '0');
      }
      else if (body.method === 'eth_getBalance') {
        assert.ok(['latest', 'pending', '0x20', '0x21'].includes(body.params[1]));
        result = body.params[1] === 'pending' ? availableBalance : canonicalBalance ?? availableBalance;
      }
      else if (body.method === 'eth_getTransactionCount')
        result =
          body.params[1] !== 'pending' ? (final ? '0x1' : minedNonce) : nonce;
      else if (body.method === 'eth_getBlockByNumber')
        result = { number: body.params[0] === 'latest' ? (tokenChanged ? '0x21' : '0x20') : body.params[0],
          hash: '0x' + ((body.params[0] === '0x21' || (body.params[0] === 'latest' && tokenChanged) ||
            (body.params[0] === '0x20' && oldBlockReorganized)) ? '3' : '2').repeat(64), baseFeePerGas: baseFee, gasLimit: '0x1c9c380' };
      else if (body.method === 'eth_gasPrice') result = '0x2';
      else if (body.method === 'eth_feeHistory')
        result = { oldestBlock: '0x1', baseFeePerGas: ['0x1', baseFee] };
      else if (body.method === 'eth_maxPriorityFeePerGas') result = '0x1';
      else if (body.method === 'eth_estimateGas') {
        if (expectedEstimateState) assert.equal(body.params[1], expectedEstimateState);
        result = '0x5208';
      }
      else if (body.method === 'eth_sendRawTransaction') {
        const record = (JSON.parse(Object.values(records)[0] as string) as { entries: { phase: string }[] }).entries[0]!;
        assert(['signed', 'submitted'].includes(record.phase));
        broadcasts.push(body.params[0]);
        if (dropped) throw Error('Acknowledgment lost');
        result = keccak256(body.params[0]);
      } else if (body.method === 'eth_getTransactionByHash') result = null;
      else if (body.method === 'eth_getTransactionReceipt')
        result =
          final && !receiptMissing
            ? {
                transactionHash: body.params[0],
                from: wallet.address,
                to,
                status: '0x1',
                blockNumber: '0x10',
                blockHash: '0x' + '2'.repeat(64),
              }
            : null;
      else throw Error('Unexpected method');
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  let clock = 100;
  let ids = 0;
  const transfers = new NativeTransfers(source, () => runtime, {
    rpc,
    now: () => clock,
    randomBytes: (length) => new Uint8Array(length).fill(++ids),
  });
  return {
    transfers,
    signedRecords,
    records,
    broadcasts,
    rpcMethods,
    rpc,
    runtime,
    source,
    signatures: () => signatures,
    authentications: () => authentications,
    locks: () => locks,
    failAuthentication(code: string | null) { authenticationError = code; authenticationRefusal = false; },
    refuseAuthentication(code: string) { authenticationError = code; authenticationRefusal = true; },
    holdAuthentication(promise: Promise<void>) { authenticationGate = promise; },
    tokenReadsAfterChange,
    holdPostJournalTokenRead(hook: () => Promise<void>) { postJournalTokenRead = hook; },
    holdPostJournalNonceRead(hook: () => Promise<void>) { postJournalNonceRead = hook; },
    postChangeReads,
    changeTokenAtNextBlock() { tokenChanged = true; },
    reorganizeQuotedBlock() { oldBlockReorganized = true; },
    nextNonce() {
      nonce = '0x1';
    },
    consumeNonce() {
      nonce = '0x1';
      minedNonce = '0x1';
    },
    advanceCanonicalNonce() {
      minedNonce = '0x1';
    },
    insufficient() {
      availableBalance = '0x1';
    },
    setPendingBalance(balance: bigint) {
      canonicalBalance ??= availableBalance;
      availableBalance = `0x${balance.toString(16)}`;
    },
    externalPendingBalance(state: 'latest' | 'pending') {
      canonicalBalance = '0xde0b6b3a7640000';
      availableBalance = '0x1';
      expectedEstimateState = state;
    },
    lowerFeesWithReducedBalance() {
      baseFee = '0x0';
      availableBalance = '0x' + (1000000000000000n + 42000n).toString(16);
    },
    loseAcknowledgment() {
      dropped = true;
    },
    setPayerEoa() {
      payerIsEoa = true;
    },
    setObservationUnavailable(value: boolean) {
      observationUnavailable = value;
    },
    finalize() {
      final = true;
    },
    consumeElsewhere() {
      final = true;
      receiptMissing = true;
    },
    changeSignedFields(fault: NonNullable<typeof altered> = 'value') {
      altered = fault;
    },
    expire() {
      clock += 100000;
    },
    holdSigning(promise: Promise<void>) {
      signGate = promise;
    },
    holdWrite(wait: () => Promise<void>) {
      beforeCommit = wait;
    },
    holdBroadcastChainResponse(wait: () => Promise<void>) {
      beforeBroadcastChainResponse = wait;
    },
    failStorage() {
      failWrite = true;
    },
    unlock() {
      state = {
        ...state,
        phase: 'ready',
        revision: state.revision + 1,
        account: { network: 'ethereum', address: wallet.address },
      };
      for (const listener of listeners) listener(state);
    },
    close() {
      transfers.dispose();
    },
  };
}
for (const type of ['HDAccount', 'Imported', 'Ledger', 'Trezor'] as const) {
  test(`native MAX ${type} reserves the shared fee policy and sends exactly the review`, async () => {
    const f = fixture(type);
    try {
      await f.transfers.prepareMaximum(to);
      const approved = f.transfers.getSnapshot().review;
      assert(approved);
      const reserve = type === 'Ledger' || type === 'Trezor' ? 1_000_000_000_000n : 0n;
      assert.equal(BigInt(approved.amountUnits) + BigInt(approved.maximumFeeUnits) + reserve, 0x10000000000000000n);
      assert.equal(f.authentications(), 0);
      assert.equal(f.signatures(), 0);
      assert.equal(f.broadcasts.length, 0);
      await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
      assert.equal(f.authentications(), 1);
      assert.equal(f.signatures(), 1);
      assert.equal(f.broadcasts.length, 1);
      const sent = Transaction.from(f.broadcasts[0]);
      assert.equal(sent.value.toString(), approved.amountUnits);
      assert.equal(sent.gasLimit.toString(), approved.gasLimit);
      assert.equal(sent.maxFeePerGas?.toString() ?? sent.gasPrice?.toString(), approved.maximumFeePerGas);
    } finally { f.close(); }
  });
}

test('native MAX refuses externally pending and retained outgoing transactions', async () => {
  const external = fixture('HDAccount');
  try {
    external.nextNonce();
    await assert.rejects(external.transfers.prepareMaximum(to), { code: 'MAX_PENDING' });
    assert.equal(external.transfers.getSnapshot().review, null);
    assert.equal(external.signatures(), 0);
    assert.equal(external.broadcasts.length, 0);
  } finally { external.close(); }
  const retained = fixture('HDAccount');
  try {
    const approved = await review(retained);
    retained.loseAcknowledgment();
    await retained.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(retained.transfers.getSnapshot().phase, 'unknown');
    const signed = retained.signatures(), posts = retained.broadcasts.length;
    await assert.rejects(retained.transfers.prepareMaximum(to), { code: 'MAX_PENDING' });
    assert.equal(retained.signatures(), signed);
    assert.equal(retained.broadcasts.length, posts);
  } finally { retained.close(); }
});

test('native MAX preserves an explicit unused higher nonce through the reviewed signature', async () => {
  const f = fixture('HDAccount');
  try {
    await f.transfers.prepareMaximum(to, '7');
    const approved = f.transfers.getSnapshot().review;
    assert(approved);
    assert.equal(approved.nonce, '7');
    assert.equal(approved.nonceOverride, 7);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(Transaction.from(f.broadcasts[0]).nonce, 7);
    assert.equal(Transaction.from(f.broadcasts[0]).value.toString(), approved.amountUnits);
    assert.equal(f.signatures(), 1);
  } finally { f.close(); }
  const pending = fixture('HDAccount');
  try {
    pending.nextNonce();
    await assert.rejects(pending.transfers.prepareMaximum(to, '7'), { code: 'MAX_PENDING' });
    assert.equal(pending.signatures(), 0);
  } finally { pending.close(); }
});

test('native MAX never rewrites an approved amount after balance growth or loss', async () => {
  for (const grows of [true, false]) {
    const f = fixture('HDAccount');
    try {
      await f.transfers.prepareMaximum(to);
      const approved = f.transfers.getSnapshot().review;
      assert(approved);
      f.setPendingBalance(BigInt(approved.totalUnits) + (grows ? 1000n : -1n));
      if (grows) {
        await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
        assert.equal(Transaction.from(f.broadcasts[0]).value.toString(), approved.amountUnits);
      } else {
        await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL));
        assert.equal(f.signatures(), 0);
        assert.equal(f.broadcasts.length, 0);
      }
    } finally { f.close(); }
  }
});

test('native MAX keeps authentication, expiry, no-funds and payer-kind refusals', async () => {
  const f = fixture('HDAccount');
  try {
    await f.transfers.prepareMaximum(to);
    const approved = f.transfers.getSnapshot().review;
    assert(approved);
    f.refuseAuthentication('INVALID_CREDENTIAL');
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.transfers.getSnapshot().review, approved);
    assert.equal(f.signatures(), 0);
    f.expire();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' });
    assert.equal(f.broadcasts.length, 0);
  } finally { f.close(); }
  const empty = fixture('Imported');
  try {
    empty.insufficient();
    await assert.rejects(empty.transfers.prepareMaximum(to));
    assert.equal(empty.transfers.getSnapshot().review, null);
    assert.equal(empty.authentications(), 0);
    assert.equal(empty.signatures(), 0);
  } finally { empty.close(); }
  const smart = fixture('SmartAccount');
  try {
    await assert.rejects(smart.transfers.prepareMaximum(to));
    assert.equal(smart.transfers.getSnapshot().review, null);
    assert.equal(smart.signatures(), 0);
  } finally { smart.close(); }
});

// Authenticated, deterministic capacity setup in an unrelated chain scope. No
// network calls or production limits are changed; the same profile stores both.
async function fillSyntheticJournal(f: ReturnType<typeof fixture>) {
  const session=signedRecordTestSession();const profile=await session.keyring.getPrivateRecordProfileId();
  const make=async(nonce:number)=>{
    const rawTransaction=await wallet.signTransaction({type:2,chainId:7654321,nonce,to:wallet.address,value:1,gasLimit:21000,maxFeePerGas:3,maxPriorityFeePerGas:1});
    const tx=Transaction.from(rawTransaction);
    return {rawTransaction,hash:tx.hash!,from:wallet.address,chainId:'7654321',nonce,type:2,
      context:{account:{type:'HDAccount',id:0,address:wallet.address},network:{kind:'ethereum',chainId:7654321,slip44:60,url:'https://offline.invalid'},operation:'send' as const}};
  };
  const first=await make(0),second=await make(1),limit=16*1024*1024;
  const maximum=Object.fromEntries(Array.from({length:1023},(_,i)=>[`k${String(i).padStart(4,'0')}`,'x'.repeat(8192)]));
  const metadataBytes=(target:number)=>{const metadata=Object.fromEntries(Object.keys(maximum).map(key=>[key,'']));let remaining=target-Buffer.byteLength(JSON.stringify(metadata));
    assert(remaining>=0&&remaining<=1023*8192);for(const key of Object.keys(metadata)){const n=Math.min(remaining,8192);metadata[key]='x'.repeat(n);remaining-=n;}assert.equal(remaining,0);return metadata;};
  await f.signedRecords.append(session,first,maximum);
  let probe=f.records[profile] as string|undefined;
  const probeStore=new EvmSignedRecords({async read(){return probe;},async compareAndSet(_id,expected,next,guard){guard();if(probe!==expected)return false;probe=next;return true;}});
  await probeStore.append(session,second,{});assert(probe);
  const room=2+limit-Buffer.byteLength(probe);await f.signedRecords.append(session,second,metadataBytes(room-64));
  const full=f.records[profile] as string;assert.equal(Buffer.byteLength(full),limit-64);
  return {profile,full,first,second};
}

async function review(f: ReturnType<typeof fixture>) {
  await f.transfers.prepare(to, '0.001');
  const result = f.transfers.getSnapshot().review;
  assert(result);
  return result;
}

for (const [kind, amount] of [
  ['zero', '0'],
  ['over-precision', '1.001'],
  ['malformed', '1e3'],
] as const) {
  test(`invalid ERC20 ${kind} amount leaves an editable controller and accepts correction`, async () => {
    const f = fixture();
    const before = f.source.getSnapshot();
    const phases: string[] = [];
    f.transfers.subscribe((snapshot) => phases.push(snapshot.phase));
    try {
      await assert.rejects(
        f.transfers.prepareToken(token.contractAddress, to, amount),
        { code: 'INVALID_INPUT' }
      );
      assert.equal(f.transfers.getSnapshot().phase, 'idle');
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.equal(f.transfers.getSnapshot().hash, null);
      assert.deepEqual(phases, ['preparing', 'idle']);
      assert.equal(f.source.getSnapshot(), before);
      assert.deepEqual(f.records, {});
      assert.equal(f.rpcMethods.length, 0);
      assert.equal(f.signatures(), 0);
      assert.deepEqual(f.broadcasts, []);

      await f.transfers.prepareToken(token.contractAddress, to, '1.23');
      const corrected = f.transfers.getSnapshot();
      assert.equal(corrected.phase, 'review');
      assert.equal(corrected.review?.amountUnits, '123');
      assert.equal(corrected.review?.recipient, to);
      assert.equal(
        corrected.review?.intent?.token.contractAddress,
        token.contractAddress
      );
      assert.equal(f.source.getSnapshot(), before);
      assert(f.rpcMethods.includes('eth_estimateGas'));
      assert.equal(f.signatures(), 0);
      assert.deepEqual(f.records, {});
    } finally {
      f.close();
    }
  });
}

test('invalid ERC20 input makes no RPC or writes with a saved native transfer', async () => {
  const f = fixture();
  try {
    f.loseAcknowledgment();
    const approved = await review(f);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const before = structuredClone(f.records);
    const calls = f.rpcMethods.length;
    await assert.rejects(
      f.transfers.prepareToken(token.contractAddress, to, '0'),
      { code: 'INVALID_INPUT' }
    );
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.deepEqual(f.records, before);
    assert.equal(f.rpcMethods.length, calls);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});

test('ordinary coin and token sends preserve a deliberate override below the external pending count', async () => {
  for (const asset of ['coin', 'token'] as const) {
    const f = fixture();
    try {
      f.nextNonce();
      f.externalPendingBalance('latest');
      await assert.rejects(asset === 'coin'
        ? f.transfers.view.prepare(to, '0.9', '0')
        : f.transfers.view.prepareToken(token.contractAddress, to, '1.23', '0'), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(f.signatures(), 0);
      f.setPendingBalance(1000000000000000000n);
      await (asset === 'coin'
        ? f.transfers.view.prepare(to, '0.9', '0')
        : f.transfers.view.prepareToken(token.contractAddress, to, '1.23', '0'));
      const approved = f.transfers.getSnapshot().review!;
      assert.equal(approved.nonce, '0');
      assert.equal(approved.nonceOverride, 0);
      assert.equal(f.signatures(), 0);
      await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
      assert.equal(f.broadcasts.length, 1);
      assert.equal(Transaction.from(f.broadcasts[0]!).nonce, 0);
      assert.equal((await (await f.runtime.journal(() => undefined)).load())?.nonce, 0);
      await assert.rejects(f.transfers.view.prepare(to, '0.001', '0'), { code: 'NONCE_RETAINED' });
      assert.equal(f.transfers.getSnapshot().phase, 'idle');
      f.externalPendingBalance('pending');
      await assert.rejects(f.transfers.view.prepare(to, '0.001', '4'), { code: 'INSUFFICIENT_BALANCE' });
      assert.equal(f.transfers.getSnapshot().phase, 'idle');
      assert.equal(f.broadcasts.length, 1);
    } finally { f.close(); }
  }
});

for (const manual of [false, true]) {
  test(`ERC20 ${manual ? 'manual' : 'automatic'} final admission rechecks balance after journal persistence`, async () => {
    const f = fixture();
    try {
      await f.transfers.view.prepareToken(token.contractAddress, to, '1.23', manual ? '0' : undefined);
      const approved = f.transfers.getSnapshot().review!;
      let held = false;
      f.holdWrite(async () => { if (!held) { held = true; f.changeTokenAtNextBlock(); } });
      await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'INSUFFICIENT_TOKEN_BALANCE' });
      assert.equal(f.signatures(), 1);
      assert.equal(f.broadcasts.length, 0);
      assert(f.tokenReadsAfterChange.includes('0x70a08231:0x21'));
      const saved = await (await f.runtime.journal(() => undefined)).load();
      assert(saved?.rawTransaction);
      assert.equal(f.transfers.getSnapshot().hash, saved.hash);
    } finally { f.close(); }
  });
}

test('manual nonce rejects malformed inputs and accepts zero only while it is available', async () => {
  const f = fixture();
  try {
    for (const input of ['-1', '1.5', '0x0', '1e2', '9007199254740992']) {
      await assert.rejects(f.transfers.view.prepare(to, '0.001', input), { code: 'INVALID_NONCE' });
    }
    assert.equal(f.rpcMethods.length, 0);
    await f.transfers.view.prepare(to, '0.001', '0');
    const approved = f.transfers.getSnapshot().review!;
    assert.equal(approved.nonceOverride, 0);
    f.consumeNonce();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.signatures(), 0);
    await assert.rejects(f.transfers.view.prepare(to, '0.001', '0'), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.deepEqual(f.records, {});
  } finally { f.close(); }
});

test('a manual nonce claimed during durable append retains its exact signed bytes without posting', async () => {
  const f = fixture();
  try {
    await f.transfers.view.prepare(to, '0.001', '0');
    const approved = f.transfers.getSnapshot().review!;
    f.holdWrite(async () => f.consumeNonce());
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'NONCE_UNAVAILABLE' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved?.nonce, 0);
    assert.equal(saved?.hash, f.transfers.getSnapshot().hash);
  } finally { f.close(); }
});

test('a pending nonce change during durable append preserves the approved bytes without posting', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.holdWrite(async () => f.nextNonce());
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved?.nonce, 0);
    assert.equal(saved?.hash, f.transfers.getSnapshot().hash);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
  } finally { f.close(); }
});

test('real signed bytes are journaled before one network submission and never exposed to UI', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.signatures(), 1);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert(
      !JSON.stringify(f.transfers.getSnapshot()).includes(f.broadcasts[0]!)
    );
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), {
      code: 'EXPIRED',
    });
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('lagging pending balance reserves accepted predecessor value and fee until the count catches up', async () => {
  const f = fixture();
  try {
    const first = await review(f);
    await f.transfers.confirm(first.id, OPERATION_CREDENTIAL);
    f.setPendingBalance(BigInt(first.totalUnits) * 2n - 1n);
    await assert.rejects(f.transfers.prepare(to, '0.001'), { code: 'INSUFFICIENT_BALANCE' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);

    f.nextNonce();
    f.setPendingBalance(BigInt(first.totalUnits));
    const next = await review(f);
    assert.equal(next.nonce, '1');
    await f.transfers.confirm(next.id, OPERATION_CREDENTIAL);
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [0, 1]);
  } finally {
    f.close();
  }
});

test('same-token sends queue while reserving existing outgoing amounts', async () => {
  const f = fixture();
  try {
    await f.transfers.prepareToken(token.contractAddress, to, '1');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, OPERATION_CREDENTIAL);
    await f.transfers.prepareToken(token.contractAddress, to, '2');
    assert.equal(f.transfers.getSnapshot().review?.nonce, '1');
    await f.transfers.confirm(f.transfers.getSnapshot().review!.id, OPERATION_CREDENTIAL);
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [0, 1]);
    await assert.rejects(f.transfers.prepareToken(token.contractAddress, to, '98'), { code: 'INSUFFICIENT_TOKEN_BALANCE' });
    await f.transfers.prepareToken(otherToken.contractAddress, to, '2');
    assert.equal(f.transfers.getSnapshot().review?.nonce, '2');
  } finally { f.close(); }
});

test('asset state changes after signing retain recovery guidance without broadcast', async () => {
  const f = fixture();
  try {
    await f.transfers.prepareToken(token.contractAddress, to, '1');
    const approved = f.transfers.getSnapshot().review!;
    f.holdWrite(async () => f.nextNonce());
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' });
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    const snapshot = f.transfers.getSnapshot();
    assert.equal(saved?.hash, snapshot.hash);
    assert.equal(snapshot.phase, 'unknown');
    assert.match(snapshot.message ?? '', /signed transaction is saved/);
  } finally { f.close(); }
});

test('a pending count behind canonical uses latest affordability and the canonical nonce', async () => {
  const f = fixture();
  try {
    f.advanceCanonicalNonce();
    f.externalPendingBalance('latest');
    const approved = await review(f);
    assert.equal(approved.nonce, '1');
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [1]);
  } finally {
    f.close();
  }
});

test('a bridged nonce stays approved when pending catches up during the durable append', async () => {
  const f = fixture();
  try {
    await f.transfers.confirm((await review(f)).id, OPERATION_CREDENTIAL);
    const second = await review(f);
    assert.equal(second.nonce, '1');
    f.holdWrite(async () => f.nextNonce());
    await f.transfers.confirm(second.id, OPERATION_CREDENTIAL);
    assert.equal(f.transfers.getSnapshot().phase, 'pending');
    assert.deepEqual(f.broadcasts.map((raw) => Transaction.from(raw).nonce), [0, 1]);
  } finally {
    f.close();
  }
});

test('an expired review and a changed nonce cannot produce a signature or broadcast', async () => {
  for (const expire of [true, false]) {
    const f = fixture();
    try {
      const approved = await review(f);
      if (expire) f.expire();
      else f.nextNonce();
      await assert.rejects(
        f.transfers.confirm(approved.id, OPERATION_CREDENTIAL),
        { code: 'EXPIRED' }
      );
      assert.equal(f.signatures(), 0);
      assert.equal(f.broadcasts.length, 0);
    } finally {
      f.close();
    }
  }
});
test('locking after review prevents a signature or pending transaction', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.source.lock();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' });
    assert.equal(f.signatures(), 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});
test('lock while signing discards the late signature', async () => {
  const f = fixture();
  let release!: () => void;
  f.holdSigning(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    while (!f.signatures())
      await new Promise((resolve) => setImmediate(resolve));
    f.source.lock();
    release();
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
  } finally {
    f.close();
  }
});
test('operation authentication is required and a rejected credential preserves only the current unsigned review', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    assert.equal(f.authentications(), 0);
    await assert.rejects(Reflect.apply(f.transfers.confirm, f.transfers, [approved.id]), { code: 'INVALID_CREDENTIAL' });
    f.refuseAuthentication('INVALID_CREDENTIAL');
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'INVALID_CREDENTIAL' });
    assert.strictEqual(f.transfers.getSnapshot().review, approved);
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0); assert.equal(Object.keys(f.records).length, 0);
    f.failAuthentication(null);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(f.authentications(), 2); assert.equal(f.signatures(), 1); assert.equal(f.broadcasts.length, 1);
  } finally { f.close(); }
});

test('cancelled device confirmation permits explicit retry without signing first', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.refuseAuthentication('DEVICE_UNLOCK_UNAVAILABLE');
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'DEVICE_UNLOCK_UNAVAILABLE' });
    assert.strictEqual(f.transfers.getSnapshot().review, approved); assert.equal(f.signatures(), 0);
    f.failAuthentication(null);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(f.signatures(), 1);
  } finally { f.close(); }
});

for (const change of ['expiry', 'lock', 'cancel'] as const) test(`pending operation authentication cannot sign after ${change}`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  try {
    const approved = await review(f), reads = f.rpcMethods.length;
    f.holdAuthentication(held.promise);
    const confirmation = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const refused = assert.rejects(confirmation, { code: 'CANCELLED' });
    while (!f.authentications()) await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.rpcMethods.length, reads);
    if (change === 'expiry') f.expire();
    else if (change === 'lock') f.source.lock();
    else f.transfers.cancel();
    held.resolve(); await refused;
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0); assert.equal(Object.keys(f.records).length, 0);
  } finally { held.resolve(); f.close(); }
});

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED', 'DEVICE_UNLOCK_UNAVAILABLE'] as const) {
  test(`recognized ${code} authentication refusal keeps the exact review without locking`, async () => {
    const f = fixture();
    try {
      const approved = await review(f); f.refuseAuthentication(code);
      await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code });
      assert.equal(f.locks(), 0); assert.strictEqual(f.transfers.getSnapshot().review, approved);
      assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0);
      f.failAuthentication(null); await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
      assert.equal(f.signatures(), 1); assert.equal(f.locks(), 0);
    } finally { f.close(); }
  });
}

for (const code of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED', 'DEVICE_UNLOCK_UNAVAILABLE'] as const) {
  test(`unbranded ${code} cannot preserve a retryable review after authentication failure`, async () => {
    const f = fixture();
    try {
      const approved = await review(f); f.failAuthentication(code);
      await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'CANCELLED' });
      assert.equal(f.locks(), 1);
      assert.equal(f.source.getSnapshot().phase, 'locked');
      assert.equal(f.transfers.getSnapshot().review, null);
      assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0);
      assert.equal(Object.keys(f.records).length, 0);
      await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL));
      assert.equal(f.locks(), 1);
    } finally { f.close(); }
  });
}

test('unknown authentication failure revokes public custody exactly once before dropping its review', async () => {
  const f = fixture();
  try {
    const approved = await review(f); f.failAuthentication('STORAGE_UNAVAILABLE');
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'CANCELLED' });
    assert.equal(f.locks(), 1); assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0); assert.equal(Object.keys(f.records).length, 0);
  } finally { f.close(); }
});

for (const action of ['cancel', 'dispose'] as const) test(`late authentication after ${action} cannot lock a successor owner`, async () => {
  const f = fixture(), held = Promise.withResolvers<void>();
  try {
    const approved = await review(f); f.holdAuthentication(held.promise);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    while (!f.authentications()) await new Promise(resolve => setImmediate(resolve));
    if (action === 'cancel') f.transfers.cancel(); else f.transfers.dispose();
    assert.equal(f.locks(), 1);
    f.unlock(); assert.equal(f.source.getSnapshot().phase, 'ready');
    held.resolve(); await rejected;
    assert.equal(f.locks(), 1); assert.equal(f.source.getSnapshot().phase, 'ready');
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0);
  } finally { held.resolve(); f.close(); }
});

test('duplicate confirmation cannot trigger a second signing request', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), {
      code: 'BUSY',
    });
    await pending;
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('a valid signature for different fields is rejected before durable admission', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.changeSignedFields();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL));
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
  } finally {
    f.close();
  }
});
for (const fault of ['signer', 'hash', 'oversized', 'noncanonical'] as const) {
  test(`a ${fault} signing result is rejected before durable admission`, async () => {
    const f = fixture();
    try {
      const approved = await review(f);
      f.changeSignedFields(fault);
      await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'FAILED' });
      assert.equal(f.signatures(), 1);
      assert.equal(Object.keys(f.records).length, 0);
      assert.equal(f.broadcasts.length, 0);
      assert.equal(f.source.getSnapshot().phase, 'locked');
    } finally {
      f.close();
    }
  });
}
test('storage failure after signing never reaches the network', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.failStorage();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL));
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(f.source.getSnapshot().phase, 'locked');
  } finally {
    f.close();
  }
});
test('lost acknowledgement retries the same bytes with fresh consent, without a new signature', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    await assert.rejects(f.transfers.prepare(to, '0.002'), {
      code: 'PENDING_TRANSFER',
    });
    await f.transfers.recover(true);
    const retry = f.transfers.getSnapshot().review;
    assert(retry?.retry);
    f.refuseAuthentication('INVALID_CREDENTIAL');
    await assert.rejects(f.transfers.confirm(retry.id, OPERATION_CREDENTIAL), { code: 'INVALID_CREDENTIAL' });
    assert.equal(f.broadcasts.length, 1);
    f.failAuthentication(null);
    await f.transfers.confirm(retry.id, OPERATION_CREDENTIAL);
    assert.equal(f.authentications(), 3);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 2);
    assert.equal(f.broadcasts[0], f.broadcasts[1]);
  } finally {
    f.close();
  }
});
test('a saved transaction stays visible when status observation is unavailable', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const hash = f.transfers.getSnapshot().hash!;
    assert(hash);
    const retained = JSON.stringify(f.records);
    f.transfers.cancel(); // Activity opens a fresh recovery screen.
    f.setObservationUnavailable(true);
    await assert.rejects(f.transfers.recover(true, hash), { code: 'FAILED' });
    const unavailable = f.transfers.getSnapshot();
    assert.equal(unavailable.phase, 'unavailable');
    assert.equal(unavailable.hash, hash);
    assert.equal(unavailable.review, null);
    assert(!JSON.stringify(unavailable).includes(f.broadcasts[0]!));
    assert.equal(JSON.stringify(f.records), retained);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);

    f.setObservationUnavailable(false);
    await f.transfers.recover(false, hash);
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    assert.equal(f.transfers.getSnapshot().hash, hash);
    await f.transfers.recover(true, hash);
    assert.equal(f.transfers.getSnapshot().review?.replay?.hash, hash);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('a reentrant lock cannot bring back a cancelled saved-transaction review', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const hash = f.transfers.getSnapshot().hash;
    assert(hash);
    f.transfers.cancel();
    f.transfers.subscribe((state) => {
      if (state.hash === hash) f.source.lock();
    });

    await assert.rejects(f.transfers.recover(true, hash), { code: 'CANCELLED' });
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 1);
  } finally {
    f.close();
  }
});
test('finalized receipt releases the journal and records the result', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    f.finalize();
    await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(
      (JSON.parse(Object.values(f.records)[0] as string) as { entries: { phase: string }[] }).entries[0]!.phase,
      'confirmed'
    );
  } finally {
    f.close();
  }
});
test('a reentrant observer can lock before submission without leaking signed bytes to the network', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.transfers.subscribe((state) => {
      if (state.phase === 'submitting') f.source.lock();
    });
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), {
      code: 'CANCELLED',
    });
    assert.equal(f.broadcasts.length, 0);
    assert.deepEqual(f.records, {});
    assert.equal(f.transfers.getSnapshot().hash, null);
  } finally {
    f.close();
  }
});

test('effect replay recovers the pending journal after cancellation drains', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const hash = f.transfers.getSnapshot().hash;
    const first = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    const replay = f.transfers.recover();
    assert.equal(await first, 'CANCELLED');
    await replay;
    assert.equal(f.transfers.getSnapshot().phase, 'unknown');
    assert.equal(f.transfers.getSnapshot().hash, hash);
  } finally {
    f.close();
  }
});
test('cancelling a queued recovery prevents it from reviving an abandoned screen', async () => {
  const f = fixture();
  try {
    const first = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    const queued = f.transfers.recover().catch((error) => error.code);
    f.transfers.cancel();
    assert.equal(await first, 'CANCELLED');
    assert.equal(await queued, 'CANCELLED');
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
  } finally {
    f.close();
  }
});
test('disposal is terminal before a subscriber can reenter it', async () => {
  const f = fixture();
  let publications = 0;
  f.transfers.subscribe(() => {
    publications++;
    f.transfers.dispose();
  });
  f.transfers.dispose();
  f.transfers.dispose();
  assert.equal(publications, 1);
  assert.equal(f.transfers.getSnapshot().review, null);
  await assert.rejects(f.transfers.recover(), { code: 'CANCELLED' });
  await assert.rejects(f.transfers.prepare(to, '1'), { code: 'CANCELLED' });
});
test('a finalized nonce without the original receipt retires obsolete retries without claiming failure', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    f.loseAcknowledgment();
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    f.consumeElsewhere();
    await f.transfers.recover(true);
    assert.equal(f.transfers.getSnapshot().phase, 'nonce-consumed');
    assert.equal(f.transfers.getSnapshot().review, null);
    assert.match(
      f.transfers.getSnapshot().message ?? '',
      /result is unavailable/
    );
    f.nextNonce();
    await f.transfers.prepare(to, '0.002');
    assert.equal(f.transfers.getSnapshot().review?.nonce, '1');
  } finally {
    f.close();
  }
});

test('insufficient funds is reported without inventing a pending transaction', async () => {
  const f = fixture();
  try {
    f.insufficient();
    await assert.rejects(f.transfers.prepare(to, '1'), {
      code: 'INSUFFICIENT_BALANCE',
    });
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.equal(f.transfers.getSnapshot().phase, 'idle');
    assert.match(f.transfers.getSnapshot().message ?? '', /Not enough ETH/);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});

test('acknowledged transfer keeps its hash while the submitted marker is held and then fails', async () => {
  const f = fixture();
  const { promise: started, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const open = f.runtime.journal;
  f.runtime.journal = async (guard) => {
    const journal = await open(guard);
    const transition = journal.transition.bind(journal);
    journal.transition = async (hash, phase) => {
      if (phase === 'submitted') {
        enter();
        await held;
        throw Error('Submitted marker write failed');
      }
      return transition(hash, phase);
    };
    return journal;
  };
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const completion = pending.catch((error: unknown) => error);
    await Promise.race([started, pending]);
    const whileMarking = f.transfers.getSnapshot();
    release();
    const error = await completion;
    assert.equal(f.broadcasts.length, 1);
    const hash = keccak256(f.broadcasts[0]!);
    assert.equal(whileMarking.hash, hash);
    assert.equal(error, undefined);
    assert.equal(f.source.getSnapshot().phase, 'ready');
    const state = f.transfers.getSnapshot();
    assert.equal(state.phase, 'pending');
    assert.equal(state.hash, hash);
    assert.match(state.message ?? '', /submitted.*activity may take longer/i);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert.equal(saved!.rawTransaction, f.broadcasts[0]);
    assert.equal(saved!.phase, 'signed');
  } finally {
    release();
    f.close();
  }
});

test('a definite no-POST from the dispatch callback retains only the already saved identity', async () => {
  const f = fixture();
  f.rpc.broadcast = async () => {
    throw Object.assign(new NativeTransferRpcError('REVIEW_REQUIRED'), { transactionNotBroadcast: true });
  };
  try {
    const approved = await review(f);
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' });
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert(saved);
    assert.equal(f.broadcasts.length, 0);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.hash, saved.hash);
    assert.match(outcome.message ?? '', /saved/i);
    assert.doesNotMatch(outcome.message ?? '', /submission may have completed/i);
  } finally { f.close(); }
});

test('unexpected recovery journal failure does not claim an existing submitted transaction was never sent', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    await f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const before = structuredClone(f.records);
    f.finalize();
    const updateObservedPhase = f.signedRecords.updateObservedPhase.bind(f.signedRecords);
    f.signedRecords.updateObservedPhase = async (session, entry, revision, phase) => {
      if (phase === 'confirmed') throw Error('Unexpected storage failure during recovery');
      return updateObservedPhase(session, entry, revision, phase);
    };
    await assert.rejects(f.transfers.recover(), { code: 'FAILED' });
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(f.transfers.getSnapshot().hash, null);
    assert.match(f.transfers.getSnapshot().message ?? '', /check Activity for an existing transaction/);
    assert.doesNotMatch(f.transfers.getSnapshot().message ?? '', /not sent|no new transaction|pending transaction.*preserved/i);
    assert.deepEqual(f.records, before);
    assert.equal(f.broadcasts.length, 1);
  } finally { f.close(); }
});


test('expiry after a durable signed record preserves its recovery identity without broadcasting', async () => {
  const f = fixture();
  const append = f.signedRecords.append.bind(f.signedRecords);
  f.signedRecords.append = async (...args) => {
    const entry = await append(...args);
    f.expire();
    return entry;
  };
  try { const approved = await review(f); await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'EXPIRED' }); assert.equal(f.broadcasts.length, 0); assert.equal(f.transfers.getSnapshot().phase, 'unknown'); assert(f.transfers.getSnapshot().hash); } finally { f.close(); }
});

test('a final chain probe that outlives the review retains the exact signed record without a raw POST', async () => {
  const f = fixture();
  const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  f.holdBroadcastChainResponse(async () => {
    enter();
    await held;
  });
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const expired = assert.rejects(pending, { code: 'EXPIRED' });
    await Promise.race([entered, pending]);
    const durable = JSON.parse(Object.values(f.records)[0] as string).entries[0];
    assert.equal(durable.phase, 'signed');
    assert.equal(f.rpcMethods.at(-1), 'eth_chainId');
    assert.deepEqual(f.broadcasts, []);

    f.expire();
    release();
    await expired;
    assert.deepEqual(f.broadcasts, []);
    const saved = await (await f.runtime.journal(() => undefined)).load();
    assert(saved);
    assert.equal(saved.hash, durable.hash);
    assert.equal(saved.phase, 'signed');
    assert.equal(saved.hash, keccak256(saved.rawTransaction));
    assert.equal(f.signatures(), 1);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'unknown');
    assert.equal(outcome.hash, saved.hash);
    assert.equal(outcome.message, 'Your signed transaction is saved. Check it before sending again.');
  } finally {
    release();
    f.close();
  }
});

test('expiry before the signed record commits exposes no saved hash or retry', async () => {
  const f = fixture();
  const { promise: started, resolve: enter } = Promise.withResolvers<void>();
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  f.holdWrite(async () => { enter(); await held; });
  try {
    const approved = await review(f);
    const pending = f.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    const expired = assert.rejects(pending, { code: 'EXPIRED' });
    await Promise.race([started, pending]);
    const whilePersisting = f.transfers.getSnapshot();
    f.expire();
    release();
    await expired;
    assert.equal(f.signatures(), 1);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
    const outcome = f.transfers.getSnapshot();
    assert.equal(outcome.phase, 'idle');
    assert.equal(outcome.hash, null);
    assert.doesNotMatch(outcome.message ?? '', /saved|retry/i);
    assert.equal(whilePersisting.hash, null);
  } finally {
    release();
    f.close();
  }
});


test('rechecks the original approved maximum cost when fees and balance decrease', async () => {
  const f = fixture();
  try {
    const approved = await review(f);
    assert.equal(approved.totalUnits, '1000000000075600');
    f.lowerFeesWithReducedBalance();
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL), { code: 'INSUFFICIENT_BALANCE' });
    assert.equal(f.signatures(), 0);
    assert.equal(f.broadcasts.length, 0);
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.source.getSnapshot().phase, 'ready');
  } finally { f.close(); }
});

test('cancelling read-only preparation or recovery does not lock custody', async () => {
  for (const recover of [false, true]) {
    for (const dispose of [false, true]) {
      const f = fixture();
      const journal = f.runtime.journal;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      f.runtime.journal = async (guard) => {
        entered();
        await gate;
        return journal(guard);
      };
      try {
        const pending = recover
          ? f.transfers.recover()
          : f.transfers.prepare(to, '0.001');
        const rejected = assert.rejects(pending, { code: 'CANCELLED' });
        await started;
        if (dispose) f.transfers.dispose();
        else f.transfers.cancel();
        assert.equal(f.source.getSnapshot().phase, 'ready');
        release();
        await rejected;
        assert.equal(f.source.getSnapshot().phase, 'ready');
        assert.equal(f.signatures(), 0);
        assert.equal(f.broadcasts.length, 0);
      } finally {
        release();
        f.close();
      }
    }
  }
});

test('a rejected secret operation revokes custody before a queued cancellation can hide its failure', async () => {
  const f = fixture();
  let cancellationPhase: string | undefined;
  f.runtime.sign = () => {
    const failure = Promise.reject(new Error('Signing failed after SDK cleanup'));
    void failure.catch(() => {
      // The first reaction queues cancellation after runSecretOperation resumes
      // but before the outer transfer catch can observe the signing failure.
      queueMicrotask(() => {
        f.transfers.cancel();
        cancellationPhase = f.source.getSnapshot().phase;
      });
    });
    return failure;
  };
  try {
    const approved = await review(f);
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL));
    assert.equal(cancellationPhase, 'locked');
    assert.equal(f.source.getSnapshot().phase, 'locked');
    assert.equal(Object.keys(f.records).length, 0);
    assert.equal(f.broadcasts.length, 0);
  } finally {
    f.close();
  }
});


for (const type of [0, 2] as const) test(`current-format type ${type} terminal bytes above today's gas cap still reconcile`, async () => {
  const f = fixture();
  try {
    const signed = await wallet.signTransaction({ type, chainId: 1, nonce: 0, to, value: 1n, gasLimit: 17000000n,
      ...(type === 0 ? { gasPrice: 2n } : { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }) });
    const session = signedRecordTestSession();
    f.records[await session.keyring.getPrivateRecordProfileId()] = await historicalSignedBundle(session, signed);
    const before = JSON.stringify(f.records);
    f.finalize(); await f.transfers.recover();
    assert.equal(f.transfers.getSnapshot().phase, 'confirmed');
    assert.equal(f.transfers.getSnapshot().hash, keccak256(signed));
    assert.equal(JSON.stringify(f.records), before);
    assert.equal(f.signatures(), 0); assert.equal(f.broadcasts.length, 0);
    assert(!JSON.stringify(f.transfers.getSnapshot()).includes(signed));
  } finally { f.close(); }
});

test('predecessor choices page locally without changing consent or making more RPC reads',async()=>{
 const f=fixture();
 try {
  const raws = await Promise.all(Array.from({ length: 23 }, (_, index) =>
    wallet.signTransaction({ type: 2, chainId: 1, nonce: index === 22 ? 1 : 0, to, value: index + 1,
      gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 })));
  const session = signedRecordTestSession();
  f.records[await session.keyring.getPrivateRecordProfileId()] = await historicalSignedBundle(session, raws, 'signed');
  await f.transfers.recover(true);
  const before=f.transfers.getSnapshot().review!;
  assert.equal(before.replay!.predecessorCount,22);assert.equal(before.replay!.predecessors.length,20);
  const requests=f.rpcMethods.length;
  await f.transfers.loadMorePredecessors();
  const after=f.transfers.getSnapshot().review!;
  assert.equal(after.id,before.id);assert.equal(after.replay!.predecessors.length,22);
  assert.equal(new Set(after.replay!.predecessors.map(row=>row.hash)).size,22);
  assert.equal(f.rpcMethods.length,requests);assert.equal(f.broadcasts.length,0);assert.equal(f.signatures(),0);
 } finally {f.close();}
});


test('real SDK and NativeTransfers report a genuine journal capacity refusal without POST', async () => {
  let capturedCapacity:unknown;
  const f=fixture();try {
    const approved=await review(f);const {profile,full,first,second}=await fillSyntheticJournal(f);
    const realSubmit=f.runtime.submit;f.runtime.submit=async (...args)=>{try{return await realSubmit(...args);}catch(error){capturedCapacity=error;throw error;}};
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL),{code:'SIGNED_STORAGE_FULL'});
    assert.equal(f.broadcasts.length,0);assert.equal(f.signatures(),1);assert.equal(f.source.getSnapshot().phase,'ready');
    assert.equal(f.transfers.getSnapshot().hash,null);assert.equal(createHash('sha256').update(f.records[profile] as string).digest('hex'),createHash('sha256').update(full).digest('hex'));
    assert.equal(f.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_MESSAGE);
    const session=signedRecordTestSession();for(const entry of [first,second])assert((await f.signedRecords.readExact(session,entry.chainId,entry.from,entry.hash))?.rawTransaction===entry.rawTransaction);
  } finally { f.close(); }
  const healthy=fixture();try {const approved=await review(healthy);await healthy.transfers.confirm(approved.id, OPERATION_CREDENTIAL);assert.equal(healthy.broadcasts.length,1);assert.equal(healthy.transfers.getSnapshot().phase,'pending');}finally{healthy.close();}
  // A previously marked error delivered after a real local POST must never be
  // presented as a no-broadcast capacity refusal.
  assert(capturedCapacity instanceof Error);
  const dispatched=fixture();try {
    const approved=await review(dispatched);const realSubmit=dispatched.runtime.submit;
    dispatched.runtime.submit=async (...args)=>{await realSubmit(...args);throw capturedCapacity;};
    await dispatched.transfers.confirm(approved.id, OPERATION_CREDENTIAL);
    assert.equal(dispatched.broadcasts.length,1);assert.equal(dispatched.transfers.getSnapshot().phase,'unknown');
    assert.notEqual(dispatched.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_MESSAGE);
    assert.notEqual(dispatched.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE);
  }finally{dispatched.close();}
});

test('capacity refusal of a saved cancellation preserves the original exact record and sends no replacement', async () => {
  const f=fixture();try {
    const initial=await review(f);await f.transfers.confirm(initial.id, OPERATION_CREDENTIAL);const original=f.transfers.getSnapshot().hash!;
    const saved=await (await f.runtime.journal(()=>undefined)).load(original);assert(saved);
    f.setPayerEoa();
    await f.transfers.prepareSavedCancellation(original);const replacement=f.transfers.getSnapshot().review!;assert(replacement.replacement);
    const {profile,full}=await fillSyntheticJournal(f);
    await assert.rejects(f.transfers.confirm(replacement.id, OPERATION_CREDENTIAL),{code:'SIGNED_STORAGE_FULL'});
    assert.equal(f.broadcasts.length,1);assert.equal(f.source.getSnapshot().phase,'ready');assert.equal(createHash('sha256').update(f.records[profile] as string).digest('hex'),createHash('sha256').update(full).digest('hex'));
    const retained=await (await f.runtime.journal(()=>undefined)).load(original);assert(retained?.rawTransaction===saved.rawTransaction);
    assert.equal(f.transfers.getSnapshot().phase,'unknown');assert.equal(f.transfers.getSnapshot().hash,original);
    assert.equal(f.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE);
  } finally {f.close();}
});

test('forged capacity text from a runtime is not classified as a local journal refusal', async () => {
  const f=fixture();try {
    const approved=await review(f);f.runtime.submit=async()=>{throw Object.assign(new Error('EVM_SIGNED_RECORD_CAPACITY'),{transactionNotBroadcast:true,code:'EVM_SIGNED_STORAGE_FULL'});};
    await assert.rejects(f.transfers.confirm(approved.id, OPERATION_CREDENTIAL),{code:'FAILED'});assert.equal(f.broadcasts.length,0);
    assert.equal(f.source.getSnapshot().phase,'locked');assert.notEqual(f.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_MESSAGE);
    assert.notEqual(f.transfers.getSnapshot().message,SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE);
  }finally{f.close();}
});

test('a later attempt publishes a fresh review identity after submission is cancelled', async () => {
  const f = fixture();
  try {
    const first = await review(f);
    let submittingReview: typeof first | null = null;
    const unsubscribe = f.transfers.subscribe((state) => {
      if (state.phase === 'submitting') {
        submittingReview = state.review;
        f.transfers.cancel();
      }
    });
    await assert.rejects(f.transfers.confirm(first.id, OPERATION_CREDENTIAL), { code: 'CANCELLED' });
    unsubscribe();
    assert.strictEqual(submittingReview, first);
    assert.equal(f.broadcasts.length, 0);
    const second = await review(f);
    assert.notStrictEqual(second, first);
    assert.equal(f.transfers.getSnapshot().review, second);
    assert.equal(f.broadcasts.length, 0);
  } finally { f.close(); }
});
