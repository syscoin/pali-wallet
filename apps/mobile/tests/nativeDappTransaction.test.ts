import { Interface } from 'ethers/abi';
import type { ApprovalContractMetadata } from '../../../source/shared/approval.ts';
import { createOwnedEvmFeeFunding, type EvmFeeFunding, NATIVE_EVM_FEE_FUNDING } from '../../../source/shared/evmFeeApproval.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { keccak256 } from 'ethers/crypto';
import { serializePreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import { nativeConnectionSubmissionFailure, prepareNativeConnectionTransaction } from '../src/connections/transactionRuntime.ts';
import { EvmTransferReadRpc, type NativeAutomaticNoncePlanner } from '../src/custody/evmTransferReadRpc.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const recipient = `0x${'22'.repeat(20)}`;
const network = getNativeNetwork('ethereum');
function fixture(funding: EvmFeeFunding = NATIVE_EVM_FEE_FUNDING, nativeBalance = '0x100000000000000', pendingHeader: 'normal' | 'null' | 'malformed' = 'normal', priorityFeeError?: number) {
  let current = true, now = 1, estimate = 21_000, estimates = 0, signs = 0, broadcasts = 0;
  let signingHook = () => {};
  let metadataReads = 0;
  let assertRefreshedState: ((provider: unknown) => Promise<void>) | undefined;
  let metadataReader = async (_contract: string): Promise<ApprovalContractMetadata | undefined> => undefined;
  const nonceOverrides: (number | undefined)[] = [];
  const calls: { method: string; params: any[] }[] = [];
  const lifetime = new AbortController();
  const guard = () => { assert(current, 'retired'); };
  const planner: NativeAutomaticNoncePlanner = async (input) => {
    input.assertCurrent(); nonceOverrides.push(input.nonceOverride);
    return { kind: 'ready', nonce: input.nonceOverride ?? 4, balanceState: 'pending', nativeReservations: { canonical: 0n, pending: 0n } };
  };
  const fetcher = async (_url: string, init: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init.body));
    if (Array.isArray(request)) return Response.json(await Promise.all(request.map(async row => (await fetcher(_url, { ...init, body: JSON.stringify(row) })).json())));
    calls.push(request);
    const { method, params, id } = request;
    if (method === 'eth_maxPriorityFeePerGas' && priorityFeeError !== undefined)
      return Response.json({ jsonrpc: '2.0', id, error: { code: priorityFeeError, message: 'Priority fee request failed' } });
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_getBalance') result = nativeBalance;
    else if (method === 'eth_getBlockByNumber') result = params[0] === 'pending' && pendingHeader !== 'normal'
      ? pendingHeader === 'null' ? null : []
      : { number: params[0] === 'latest' ? '0x10' : params[0], hash: `0x${'aa'.repeat(32)}`, gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
    else if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') result = '0x2';
    else if (method === 'eth_feeHistory') result = { reward: [['0x2', '0x2', '0x2']] };
    else if (method === 'eth_estimateGas') { estimates++; result = `0x${estimate.toString(16)}`; }
    else if (method === 'eth_sendRawTransaction') { broadcasts++; result = keccak256(params[0]); }
    else throw new Error(`Unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const rpc = new EvmTransferReadRpc(network, { fetch: fetcher, monotonicMilliseconds: () => now });
  const sender = new NativeTransferRpc({ registration: network, fetch: fetcher });
  const prepare = (input: unknown) => prepareNativeConnectionTransaction(input, {
    funding, gasPolicy: { kind: 'estimate' }, network, rpc, planner, signal: lifetime.signal, assertCurrent: guard, now: () => now,
    assertRefreshedState: provider => assertRefreshedState?.(provider) ?? Promise.resolve(),
    async readApprovalMetadata(contract, check) { metadataReads++; check(); const result = await metadataReader(contract); check(); return result; },
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
    onRefresh(hook: (provider: unknown) => Promise<void>) { assertRefreshedState = hook; },
    setMetadataReader(read: typeof metadataReader) { metadataReader = read; }, get metadataReads() { return metadataReads; },
    get signs() { return signs; }, get broadcasts() { return broadcasts; }, get estimates() { return estimates; } };
}

test('private full admission uses the owned refresh phase and retires before signing', async () => {
  const f = fixture();
  const phases: { send(method: string, params: unknown[]): Promise<unknown> }[] = [];
  f.onRefresh(async value => {
    const phase = value as (typeof phases)[number];
    phases.push(phase);
    await phase.send('eth_getBalance', [wallet.address, 'pending']);
  });
  const review = await f.prepare({ from: wallet.address, to: recipient });
  assert.equal(phases.length, 0);
  f.onSign(() => assert.equal(phases.length, 1));
  await review.submit(f.guard, () => {}, { kind: 'transaction' });
  assert.equal(phases.length, 2);
  for (const phase of phases) await assert.rejects(async () => phase.send('eth_getBalance', [wallet.address, 'pending']), { code: 'CANCELLED' });
  assert.equal(f.broadcasts, 1);
});

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
  const f = fixture(), input = { from: wallet.address, to: recipient };
  const review = await f.prepare(input);
  f.increaseEstimate();
  await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }), error => {
    assert.match((error as Error).message, /REVIEW_REQUIRED/);
    assert.equal(nativeConnectionSubmissionFailure(error), 'retryable');
    return true;
  });
  assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
  const fresh = await f.prepare(input);
  assert.notEqual(fresh.transaction.gasLimit, review.transaction.gasLimit);
  assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
  await fresh.submit(f.guard, () => {}, { kind: 'transaction' });
  assert.equal(f.signs, 1); assert.equal(f.broadcasts, 1);
});

test('gas growth during signing requires submission evidence before allowing a new review', async () => {
  const f = fixture(), review = await f.prepare({ from: wallet.address, to: recipient });
  f.onSign(f.increaseEstimate);
  await assert.rejects(review.submit(f.guard, () => {}, { kind: 'transaction' }), error => {
    assert.match((error as Error).message, /REVIEW_REQUIRED/);
    assert.equal(nativeConnectionSubmissionFailure(error), undefined);
    return true;
  });
  assert.equal(f.signs, 1); assert.equal(f.broadcasts, 0);
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
    await assert.rejects(review.submit(f.guard, () => undefined, { kind: 'transaction' }), /credit unavailable/);
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

test('external dapp requests retain market fee observation with complete explicit fees', async () => {
  for (const fees of [{ gasPrice: '0x7' }, { type: '0x2', maxFeePerGas: '0x7', maxPriorityFeePerGas: '0x2' }]) {
    const f = fixture();
    await f.prepare({ from: wallet.address, to: recipient, ...fees });
    assert(f.calls.some(call => call.method === 'eth_getBlockByNumber' && call.params[0] === 'pending'));
    assert(f.calls.some(call => call.method === 'eth_gasPrice'));
    assert(f.calls.some(call => call.method === 'eth_maxPriorityFeePerGas'));
    assert.equal(f.signs, 0);
    assert.equal(f.broadcasts, 0);
  }
});

for (const code of [-32601, 4200]) test(`dapp preparation and submission preserve fee-history fallback for unsupported priority RPC ${code}`, async () => {
  const f = fixture(NATIVE_EVM_FEE_FUNDING, '0x100000000000000', 'normal', code);
  const review = await f.prepare({ from: wallet.address, to: recipient, value: '0x1', data: '0x1234' });
  assert.equal(review.transaction.type, 2);
  if (review.transaction.type === 2) assert.equal(review.transaction.maxPriorityFeePerGas, '3');
  assert.deepEqual(f.calls.filter(call => call.method === 'eth_feeHistory').map(call => call.params), [['0x5', 'latest', [25, 50, 75]]]);
  await review.submit(f.guard, () => undefined, { kind: 'transaction' });
  assert.equal(f.signs, 1);
  assert.equal(f.broadcasts, 1);
});

test('dapp preparation does not use fee-history fallback for other priority RPC errors', async () => {
  const f = fixture(NATIVE_EVM_FEE_FUNDING, '0x100000000000000', 'normal', -32005);
  await assert.rejects(f.prepare({ from: wallet.address, to: recipient, value: '0x1' }));
  assert.equal(f.calls.filter(call => call.method === 'eth_feeHistory').length, 0);
  assert.equal(f.signs, 0);
  assert.equal(f.broadcasts, 0);
});

test('recognized asset call obtains bound display metadata without signing', async () => {
  const f = fixture();
  const iface = new Interface(['function transfer(address,uint256)']);
  f.setMetadataReader(async contract => {
    assert.equal(contract.toLowerCase(), recipient.toLowerCase());
    return { standard: 'ERC-20', token: { contractAddress: contract, name: 'USD token', symbol: 'USD', decimals: 6 } };
  });
  const intended = `0x${'33'.repeat(20)}`;
  const review = await f.prepare({ from: wallet.address, to: recipient, data: iface.encodeFunctionData('transfer', [intended, 2500000]) });
  assert.equal(review.assetTransfer?.recipient.toLowerCase(), intended.toLowerCase());
  assert.equal(review.assetTransfer?.items[0]?.units, '2500000');
  assert.equal(review.assetTransfer?.token?.decimals, 6);
  assert.equal(f.metadataReads, 1); assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
});

test('metadata arriving after owner retirement cannot publish an asset review', async () => {
  const f = fixture();
  const iface = new Interface(['function transfer(address,uint256)']);
  f.setMetadataReader(async () => { f.retire(); return undefined; });
  await assert.rejects(f.prepare({ from: wallet.address, to: recipient, data: iface.encodeFunctionData('transfer', [recipient, 1]) }));
  assert.equal(f.metadataReads, 1); assert.equal(f.signs, 0); assert.equal(f.broadcasts, 0);
});

test('ordinary native transfer does not request token metadata', async () => {
  const f = fixture(); await f.prepare({ from: wallet.address, to: recipient, value: '0x1' });
  assert.equal(f.metadataReads, 0);
});
