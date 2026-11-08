import { createOwnedEvmFeeFunding, type EvmFeeFunding, NATIVE_EVM_FEE_FUNDING } from '../../../source/shared/evmFeeApproval.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { prepareNativeConnectionTransaction } from '../src/connections/transactionRuntime.ts';
import { EvmTransferReadRpc, type NativeAutomaticNoncePlanner } from '../src/custody/evmTransferReadRpc.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const recipient = `0x${'22'.repeat(20)}`;
const network = getNativeNetwork('ethereum');
function fixture(funding: EvmFeeFunding = NATIVE_EVM_FEE_FUNDING, nativeBalance = '0x100000000000000', pendingHeader: 'normal' | 'null' | 'malformed' = 'normal') {
  let current = true, now = 1, estimate = 21_000, estimates = 0, signs = 0, broadcasts = 0;
  let signingHook = () => {};
  const nonceOverrides: (number | undefined)[] = [];
  const calls: { method: string; params: any[] }[] = [];
  const lifetime = new AbortController();
  const guard = () => { assert(current, 'retired'); };
  const planner: NativeAutomaticNoncePlanner = async (input) => {
    input.assertCurrent(); nonceOverrides.push(input.nonceOverride);
    return { kind: 'ready', nonce: input.nonceOverride ?? 4, balanceState: 'pending', nativeReservations: { canonical: 0n, pending: 0n } };
  };
  const fetcher = async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)); calls.push(request);
    const { method, params, id } = request;
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_getBalance') result = nativeBalance;
    else if (method === 'eth_getBlockByNumber') result = params[0] === 'pending' && pendingHeader !== 'normal'
      ? pendingHeader === 'null' ? null : []
      : { number: params[0] === 'latest' ? '0x10' : params[0], hash: `0x${'aa'.repeat(32)}`, gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
    else if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') result = '0x2';
    else if (method === 'eth_estimateGas') { estimates++; result = `0x${estimate.toString(16)}`; }
    else if (method === 'eth_sendRawTransaction') { broadcasts++; result = keccak256(params[0]); }
    else throw new Error(`Unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const rpc = new EvmTransferReadRpc(network, { fetch: fetcher, monotonicMilliseconds: () => now });
  const sender = new NativeTransferRpc({ registration: network, fetch: fetcher });
  const prepare = (input: unknown) => prepareNativeConnectionTransaction(input, {
    funding, gasPolicy: { kind: 'estimate' }, network, rpc, planner, signal: lifetime.signal, assertCurrent: guard, now: () => now,
    async sign(transaction, assertCurrent) {
      assertCurrent(); signs++; signingHook(); assertCurrent();
      const rawTransaction = await wallet.signTransaction(Transaction.from(serializePreparedEvmTransaction(transaction)));
      return { rawTransaction, hash: keccak256(rawTransaction) };
    },
    async submit(transaction, signed, assertCurrent, verifyDispatch, onBroadcast, submission) {
      assert.equal(submission.kind, 'transaction');
      await verifyDispatch(planner, assertCurrent);
      return sender.broadcastDapp(signed.rawTransaction, signed.hash, transaction, lifetime.signal,
        async (initiate, preflight) => { await preflight?.(); return initiate(); }, assertCurrent, onBroadcast);
    },
  });
  return { prepare, calls, nonceOverrides, guard, retire() { current = false; lifetime.abort(); },
    expire() { now += 90_000; }, increaseEstimate() { estimate = 40_000; },
    onSign(hook: () => void) { signingHook = hook; },
    get signs() { return signs; }, get broadcasts() { return broadcasts; }, get estimates() { return estimates; } };
}

for (const destination of [recipient, null]) test(`generic dapp ${destination === null ? 'creation' : 'call'} keeps exact access list and explicit nonce`, async () => {
  const f = fixture();
  const accessList = [{ address: recipient, storageKeys: [`0x${'33'.repeat(32)}`] }];
  const review = await f.prepare({ from: wallet.address, to: destination, data: '0x60006000', nonce: '0x7', value: '0x0', type: '0x2', accessList });
  accessList[0]!.storageKeys[0] = `0x${'44'.repeat(32)}`;
  assert.equal(review.transaction.to, destination);
  assert.equal(review.transaction.nonce, '7');
  assert.equal(review.transaction.type, 2);
  if (review.transaction.type === 2) assert.equal(review.transaction.accessList[0]!.storageKeys[0], `0x${'33'.repeat(32)}`);
  let admittedHash: string | undefined;
  const hash = await review.submit(f.guard, (value) => { assert.equal(f.broadcasts, 0); admittedHash = value; }, { kind: 'transaction' });
  assert.equal(hash, admittedHash);
  assert.equal(f.signs, 1); assert.equal(f.broadcasts, 1);
  assert.deepEqual(f.nonceOverrides, [7, 7, 7]);
  for (const { params } of f.calls.filter(({ method }) => method === 'eth_estimateGas')) {
    assert.equal(params[0].nonce, '0x7');
    assert.equal(params[0].to ?? null, destination);
    assert.equal(params[0].accessList[0].storageKeys[0], `0x${'33'.repeat(32)}`);
  }
  await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }), /REVIEW_REQUIRED/);
});

test('a missing submission context fails closed before signing', async () => {
  const f = fixture(), review = await f.prepare({ from: wallet.address, to: recipient });
  await assert.rejects(review.submit(f.guard, () => {}, undefined as never), /REVIEW_REQUIRED/);
  assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
});

test('expired or revoked review cannot sign or broadcast', async () => {
  for (const action of ['expire', 'retire'] as const) {
    const f = fixture(), review = await f.prepare({ from: wallet.address, to: recipient });
    f[action]();
    await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }));
    assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
  }
});

test('fresh gas growth preserves the review envelope and requires a new review', async () => {
  const f = fixture(), review = await f.prepare({ from: wallet.address, to: recipient });
  f.increaseEstimate();
  await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }), /REVIEW_REQUIRED/);
  assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
});

test('revocation inside signing prevents the submission path', async () => {
  const f = fixture(), review = await f.prepare({ from: wallet.address, to: recipient });
  f.onSign(f.retire);
  await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }));
  assert.equal(f.signs, 1); assert.equal(f.broadcasts, 0);
});

test('invalid generic envelopes fail before RPC', async () => {
  for (const input of [
    { from: wallet.address, to: recipient, chainId: '0x2' },
    { from: wallet.address, to: 'wrong.eth' },
    { from: wallet.address, to: recipient, gasPrice: '0x1', accessList: [] },
    { from: wallet.address, to: recipient, data: `0x${'00'.repeat(512 * 1024 + 1)}` },
  ]) {
    const f = fixture();
    await assert.rejects(f.prepare(input)); assert.equal(f.calls.length, 0);
  }
});


for (const lose of ['never', 'before-confirm', 'during-sign'] as const) test(`verified fee funding is rechecked through dispatch (${lose})`, async () => {
  let credit = true, checks = 0;
  const funding = createOwnedEvmFeeFunding(async approval => {
    checks++;
    if (!credit) throw new Error('credit unavailable');
    return BigInt(approval.maximumFeeUnits);
  });
  const f = fixture(funding, '0x0');
  const review = await f.prepare({ from: wallet.address, to: recipient, value: '0x0', data: '0x1234' });
  assert.equal(review.maximumTotalUnits, '0');
  assert.equal(review.coveredFeeUnits, review.maximumFeeUnits);
  if (lose === 'before-confirm') credit = false;
  if (lose === 'during-sign') f.onSign(() => { credit = false; });
  if (lose === 'never') {
    await review.submit(f.guard, () => undefined, { kind: 'transaction' });
    assert.equal(f.signs, 1); assert.equal(f.broadcasts, 1); assert.equal(checks, 3);
  } else {
    await assert.rejects(review.submit(f.guard, () => undefined, { kind: 'transaction' }), { code: 'UNAVAILABLE' });
    assert.equal(f.broadcasts, 0);
    assert.equal(f.signs, lose === 'during-sign' ? 1 : 0);
  }
});

test('fee funding cannot cover transferred native value or be forged', async () => {
  const funding = createOwnedEvmFeeFunding(async approval => BigInt(approval.maximumFeeUnits));
  await assert.rejects(fixture(funding, '0x0').prepare({ from: wallet.address, to: recipient, value: '0x1', data: '0x' }));
  await assert.rejects(fixture({ kind: 'verified-credit' }, '0x0').prepare({ from: wallet.address, to: recipient, value: '0x0', data: '0x' }));
});


test('null pending block uses canonical fee bounds while malformed pending data remains invalid', async () => {
  const f = fixture(NATIVE_EVM_FEE_FUNDING, '0x100000000000000', 'null');
  const review = await f.prepare({ from: wallet.address, to: recipient, data: '0x1234' });
  await review.submit(f.guard, () => undefined, { kind: 'transaction' });
  assert.equal(f.broadcasts, 1);
  const malformed = fixture(NATIVE_EVM_FEE_FUNDING, '0x100000000000000', 'malformed');
  await assert.rejects(malformed.prepare({ from: wallet.address, to: recipient }), { code: 'INVALID_RESPONSE' });
  assert.equal(malformed.signs, 0);
});
