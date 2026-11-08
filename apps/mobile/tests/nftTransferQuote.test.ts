import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { EvmTransferReadRpc, type EvmNftPreparedQuote } from '../src/custody/evmTransferReadRpc.ts';
import { snapshotNftQuoteEnvelope } from '../src/custody/evmFeeContracts.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeTransferRpc, NativeTransferRpcError } from '../src/custody/transferRpc.ts';
import { EvmAutoNonceAcceptance } from '../../../source/shared/evmAutoNonce.ts';

const wallet = new Wallet('0x' + '01'.repeat(32));
const owner = wallet.address;
const recipient = '0x0000000000000000000000000000000000000002';
const target = '0x0000000000000000000000000000000000000721';
const max = ((1n << 256n) - 1n).toString();
const network = createNativeNetwork({
  id: 'fixture-evm',
  name: 'Selected EVM',
  kind: 'evm',
  chainId: '1234',
  slip44: 60,
  rpcUrl: 'https://selected.invalid/rpc',
  symbol: 'TST',
  decimals: 18,
  testnet: true,
});
const selection = {
  network,
  owner,
  saved: { contractAddress: target, tokenStandard: 'ERC-721' as const },
};
const request = { recipient, tokenId: '0', amountUnits: '1' };
const block = { number: '0x123', hash: '0x' + 'a'.repeat(64), gasLimit: '0x1c9c380' };
const abi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function transferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'error ERC721NonexistentToken(uint256)',
]);
const erc721Data = abi.encodeFunctionData('transferFrom', [owner, recipient, 0]);
const erc1155Data = abi.encodeFunctionData('safeTransferFrom', [
  owner, recipient, max, max, '0x',
]);
const simulation = (call: Call) => call.method === 'eth_call' &&
  (call.params[0] as { from?: string }).from !== undefined;
type Call = { method: string; params: unknown[]; id: number; signal: AbortSignal };
type Reply = { result?: unknown; error?: unknown };
function fixture(options: {
  dynamic?: boolean;
  holding?: string;
  rewrite?: (call: Call, reply: Reply) => Reply | Promise<Reply>;
  monotonicMilliseconds?: () => number;
  timeoutMs?: number;
  responseUrl?: string;
} = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
      assert.equal(url, network.rpcUrl);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
      const call: Call = { ...JSON.parse(String(init.body)), signal: init.signal };
      calls.push(call);
      let reply: Reply;
      switch (call.method) {
        case 'eth_chainId': reply = { result: '0x4d2' }; break;
        case 'eth_getBlockByNumber':
          reply = { result: { ...block, baseFeePerGas: options.dynamic === false ? null : '0x64' } };
          break;
        case 'eth_getCode':
          assert.deepEqual(call.params, [target, block.number]);
          reply = { result: '0x6000' };
          break;
        case 'eth_call': {
          const tx = call.params[0] as { from?: string; to: string; data: string };
          assert.equal(call.params[1], block.number);
          assert.equal(tx.to, target);
          const { name, args } = abi.parseTransaction(tx)!;
          if (simulation(call)) {
            const simulation = call.params[0] as Record<string, unknown>;
            assert.deepEqual({ from: simulation.from, to: simulation.to, value: simulation.value, data: simulation.data },
              { from: owner, to: target, value: '0x0', data: tx.data });
            assert.match(String(simulation.gas), /^0x[0-9a-f]+$/);
            assert.match(String(simulation.nonce), /^0x[0-9a-f]+$/);
            reply = { result: '0x' };
          } else if (name === 'ownerOf') {
            reply = args[0] === 0n
              ? { result: abi.encodeFunctionResult(name, [options.holding ?? owner]) }
              : { error: {
                  code: 3,
                  message: 'execution reverted',
                  data: abi.encodeErrorResult('ERC721NonexistentToken', [args[0]]),
                } };
          } else if (name === 'balanceOf') {
            assert.equal(args[0], owner);
            assert.notEqual(args[1].toString(), max);
            reply = { result: abi.encodeFunctionResult(name, [0]) };
          } else {
            assert.equal(name, 'balanceOfBatch');
            assert.deepEqual(Array.from(args[0]), [owner]);
            assert.deepEqual(Array.from(args[1]), [BigInt(max)]);
            reply = { result: abi.encodeFunctionResult(name, [[options.holding ?? max]]) };
          }
          break;
        }
        case 'eth_getTransactionCount':
          assert.equal(call.params[0], owner);
          assert.ok(['latest', 'pending', block.number].includes(String(call.params[1])));
          reply = { result: '0x7' };
          break;
        case 'eth_getBalance':
          assert.equal(call.params[0], owner);
          assert.ok(['pending', block.number].includes(String(call.params[1])));
          reply = { result: '0xffffffffffff' };
          break;
        case 'eth_gasPrice': reply = { result: '0x65' }; break;
        case 'eth_maxPriorityFeePerGas': reply = { result: '0x2' }; break;
        case 'eth_estimateGas': reply = { result: '0x7530' }; break;
        case 'eth_sendRawTransaction':
          reply = { result: Transaction.from(String(call.params[0])).hash };
          break;
        default: assert.fail('Unowned RPC method');
      }
      const result = options.rewrite ? await options.rewrite(call, reply) : reply;
      const response = new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, ...result }), {
        headers: { 'Content-Type': 'application/json' },
      });
      if (options.responseUrl)
        Object.defineProperty(response, 'url', { value: options.responseUrl });
      return response;
  };
  const settings = {
    fetch,
    monotonicMilliseconds: options.monotonicMilliseconds ?? (() => 1000),
    timeoutMs: options.timeoutMs,
  };
  return {
    rpc: new EvmTransferReadRpc(network, settings),
    createOwner: () => new NativeTransferRpc({ registration: network, ...settings }),
    calls,
  };
}
const signal = () => new AbortController().signal;
const current = () => undefined;
const admission = (rpc: NativeTransferRpc, approval: EvmNftPreparedQuote, assertCurrent = current, onDispatch = current) => {
  let validated = false;
  const inventorySignal = signal();
  const acceptance = new EvmAutoNonceAcceptance();
  const planner: import('../src/custody/evmTransferReadRpc.ts').NativeAutomaticNoncePlanner = (input) => acceptance.plan({
    ...input, chainId: network.chainId, from: owner, endpoint: network.rpcUrl,
    snapshot: { owner: 'dispatch-fixture', minimumNonce: 0, retained: [], readAssetDebit: async () => 0n, readMaximumCost: async () => 0n },
  });
  return {
    mode: 'collectible' as const, approval, assertCurrent, inventorySignal, onDispatch,
    assertDispatchAdmission() { if (!validated) throw new NativeTransferRpcError('REVIEW_REQUIRED'); },
    async admit(send: () => Promise<string>, preflight?: () => Promise<void>) {
      validated = false;
      await rpc.verifyForDispatch(approval.envelope, inventorySignal, assertCurrent, planner, approval, undefined, approval.nonceOverride);
      validated = true;
      assert.ok(preflight);
      await preflight();
      return send();
    },
  };
};

test('ERC721 token zero has exact standard bytes and the existing dynamic fee policy on one sampled block', async () => {
  const { rpc, calls } = fixture();
  const quote = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
  assert.deepEqual(quote.envelope, {
    type: 2, accessList: [], from: owner, to: target, chainId: network.chainId, nonce: '7',
    value: '0', gasLimit: '36000', data: erc721Data,
    maxFeePerGas: '252', maxPriorityFeePerGas: '2',
  });
  assert.equal(quote.envelope.data.length, 202);
  assert.equal(quote.intent.tokenId, '0');
  assert.equal(quote.intent.recipient, recipient);
  assert.equal(quote.ownershipUnits, '1');
  assert.equal(quote.maximumFeeUnits, '9072000');
  assert.equal(quote.totalUnits, quote.maximumFeeUnits);
  assert.equal(quote.registrationHash, network.registrationHash);
  assert.equal(quote.expiresAtMonotonicMilliseconds, 91000);
  assert.deepEqual(quote.sampledBlock, { number: '291', hash: block.hash });
  assert.equal(Object.hasOwn(quote, 'transaction'), false);
  for (const part of [quote, quote.intent, quote.sampledBlock, quote.envelope])
    assert.equal(Object.isFrozen(part), true);
  assert.deepEqual(calls.filter((c) => c.method === 'eth_getBlockByNumber').map((c) => c.params),
    [['latest', false], [block.number, false]]);
  assert.deepEqual(calls.filter(simulation).map((c) => c.params),
    [[{ from: owner, to: target, value: '0x0', data: erc721Data, gas: '0x8ca0', nonce: '0x7', type: '0x2', maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2' }, block.number]]);
  assert.deepEqual(calls.find((c) => c.method === 'eth_estimateGas')?.params, [{
    from: owner, to: target, value: '0x0', data: erc721Data, type: '0x2',
    chainId: '0x4d2', nonce: '0x7', accessList: [], maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2',
  }, 'pending']);
  assert.equal(calls.at(0)?.method, 'eth_chainId');
  assert.equal(calls.at(-1)?.method, 'eth_chainId');
  assert.equal(new Set(calls.map((c) => c.id)).size, calls.length);
});

test('ERC1155 preserves uint256 IDs and quantities with standard empty bytes and the legacy fee policy', async () => {
  const { rpc, calls } = fixture({ dynamic: false });
  const quote = await rpc.prepareNft({
    ...selection, saved: { contractAddress: target, tokenStandard: 'ERC-1155', tokenId: max },
  }, { recipient, tokenId: max, amountUnits: max }, signal(), current, undefined, emptyNoncePlanner);
  assert.equal(quote.envelope.data, erc1155Data);
  assert.equal(quote.envelope.data.length, 394);
  assert.equal(quote.intent.amountUnits, max);
  assert.equal(quote.ownershipUnits, max);
  assert.equal(quote.envelope.type === 0 && quote.envelope.gasPrice, '101');
  assert.equal(quote.maximumFeeUnits, '3636000');
  assert.equal(calls.filter((c) => c.method === 'eth_call').length, 3);
});

test('normal envelopes still reject NFT bytes and the typed NFT envelope rejects mismatched reviewed fields', async () => {
  const { rpc } = fixture();
  const { intent, envelope } = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
  assert.deepEqual(snapshotNftQuoteEnvelope(envelope, network, intent), envelope);
  for (const change of [
    { from: recipient }, { to: recipient }, { chainId: '1' }, { value: '1' },
    { data: erc1155Data }, { data: erc721Data + '00' },
    { data: abi.encodeFunctionData('transferFrom', [owner, target, 0]) },
  ]) {
    assert.throws(() => snapshotNftQuoteEnvelope({ ...envelope, ...change }, network, intent),
      { code: 'INVALID_INPUT' });
  }
  const normal = fixture();
  for (const data of [erc721Data, erc1155Data]) {
    await assert.rejects(normal.rpc.prepare({ from: owner, to: target, value: '0', data }, signal(), current, undefined, undefined, emptyNoncePlanner),
      { code: 'INVALID_INPUT' });
    assert.throws(() => normal.rpc.quoteFees({ ...envelope, data }, signal(), current),
      { code: 'INVALID_INPUT' });
  }
  assert.equal(normal.calls.length, 0);
});

test('profile, saved ID, malformed input and asynchronous guards refuse before any request', async () => {
  const { rpc, calls } = fixture();
  const alternate = createNativeNetwork({ ...network, rpcUrl: 'https://different.invalid/rpc' });
  await assert.rejects(rpc.prepareNft({ ...selection, network: alternate }, request, signal(), current, undefined, emptyNoncePlanner),
    { code: 'PROFILE_CHANGED' });
  await assert.rejects(rpc.prepareNft({
    ...selection, saved: { contractAddress: target, tokenStandard: 'ERC-1155', tokenId: '1' },
  }, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_INPUT' });
  await assert.rejects(rpc.prepareNft(selection, { ...request, amountUnits: '2' }, signal(), current, undefined, emptyNoncePlanner),
    { code: 'INVALID_INPUT' });
  const withData = { ...request, data: erc721Data };
  await assert.rejects(rpc.prepareNft(selection, withData, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_INPUT' });
  await assert.rejects(rpc.prepareNft(selection, request, signal(), async () => undefined, undefined, emptyNoncePlanner),
    { code: 'CANCELLED' });
  assert.equal(calls.length, 0);
});

test('only exact empty successful simulation and enough verified holdings can produce a quote', async () => {
  for (const result of [true, false, '0x00', '0x' + '0'.repeat(63) + '1', null]) {
    const f = fixture({ rewrite: (call, reply) => simulation(call) ? { result } : reply });
    await assert.rejects(f.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), {
      code: typeof result === 'string' ? 'NFT_TRANSFER_REJECTED' : 'INVALID_RESPONSE',
    });
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
  }
  const providerFailure = fixture({ rewrite: (call, reply) => simulation(call)
    ? { result: '0x', error: { code: 3, message: 'execution reverted', data: '0x' } } : reply });
  await assert.rejects(providerFailure.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
  const noOwnership = fixture({ holding: recipient });
  await assert.rejects(noOwnership.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INSUFFICIENT_NFT_BALANCE' });
  assert.equal(noOwnership.calls.some(simulation), false);
  const badProbe = fixture({ rewrite: (_call, reply) => reply.error ? { ...reply, result: '0x' } : reply });
  await assert.rejects(badProbe.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
  assert.equal(badProbe.calls.filter((c) => c.method === 'eth_call').length, 1);
});

test('an explicit bounded simulation revert differs from an unsupported or malformed RPC error', async () => {
  const revert = { code: 3, message: 'execution reverted', data: '0x' };
  for (const [error, code] of [
    [revert, 'NFT_TRANSFER_REJECTED'],
    [{ ...revert, code: -32000, data: abi.encodeErrorResult('ERC721NonexistentToken', [0]) }, 'NFT_TRANSFER_REJECTED'],
    [{ ...revert, code: -32601 }, 'INVALID_RESPONSE'],
    [{ ...revert, message: 'provider unavailable' }, 'INVALID_RESPONSE'],
    [{ ...revert, data: '0x0' }, 'INVALID_RESPONSE'],
    [{ ...revert, data: '0x' + 'aa'.repeat(4097) }, 'INVALID_RESPONSE'],
  ] as const) {
    const f = fixture({ rewrite: (call, reply) => simulation(call) ? { error } : reply });
    await assert.rejects(f.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code });
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
  }
});

test('wrong chain, orphaned sampled block, unsafe nonce, unaffordable fees and invalid expiry refuse', async () => {
  const wrong = fixture({ rewrite: (call, reply) => call.method === 'eth_chainId' ? { result: '0x1' } : reply });
  await assert.rejects(wrong.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'PROFILE_CHANGED' });
  assert.deepEqual(wrong.calls.map((c) => c.method), ['eth_chainId']);
  const orphan = fixture({ rewrite: (call, reply) => call.method === 'eth_getBlockByNumber' && call.params[0] === block.number
    ? { result: { ...block, hash: '0x' + 'b'.repeat(64) } } : reply });
  await assert.rejects(orphan.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'REVIEW_REQUIRED' });
  const nonce = fixture({ rewrite: (call, reply) => call.method === 'eth_getTransactionCount'
    ? { result: '0x20000000000000' } : reply });
  await assert.rejects(nonce.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
  const poor = fixture({ rewrite: (call, reply) => call.method === 'eth_getBalance' ? { result: '0x1' } : reply });
  await assert.rejects(poor.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INSUFFICIENT_BALANCE' });
  await assert.rejects(fixture({ monotonicMilliseconds: () => Number.MAX_SAFE_INTEGER })
    .rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner), { code: 'INVALID_RESPONSE' });
});

test('held simulation discards a captured request after lock or A-B-A selection', async () => {
  for (const lock of [true, false]) {
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<Reply>();
    const controller = new AbortController();
    let generation = 0;
    const editable = { ...request };
    const f = fixture({ rewrite(call, reply) {
      if (!simulation(call)) return reply;
      entered.resolve();
      return finish.promise;
    } });
    const pending = f.rpc.prepareNft(selection, editable, controller.signal, () => {
      if (generation !== 0) throw new Error('Changed selection');
    }, undefined, emptyNoncePlanner);
    editable.recipient = target;
    await entered.promise;
    assert.equal((f.calls.at(-1)?.params[0] as { data: string }).data, erc721Data);
    if (lock) controller.abort();
    else generation += 2;
    finish.resolve({ result: '0x' });
    await assert.rejects(pending, { code: 'CANCELLED' });
    assert.equal(f.calls.at(-1)?.signal.aborted, true);
    assert.equal(f.calls.some((c) => c.method === 'eth_sendRawTransaction'), false);
  }
});

test('alternate response origin stops at chain preflight and a held response cannot outlive its owned deadline', async () => {
  const alternate = fixture({ responseUrl: 'https://different.invalid/rpc' });
  await assert.rejects(alternate.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner),
    { code: 'PROFILE_CHANGED' });
  assert.deepEqual(alternate.calls.map((c) => c.method), ['eth_chainId']);
  const finish = Promise.withResolvers<Reply>();
  const held = fixture({ timeoutMs: 10, rewrite: () => finish.promise });
  await assert.rejects(held.rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner),
    { code: 'CANCELLED' });
  finish.resolve({ result: '0x4d2' });
  assert.deepEqual(held.calls.map((c) => c.method), ['eth_chainId']);
  assert.equal(held.calls[0]?.signal.aborted, true);
});

test('failed ERC1155 batch does not issue a third ownership call or a transfer simulation', async () => {
  let calls = 0;
  const f = fixture({ rewrite: (call, reply) =>
    call.method === 'eth_call' && ++calls === 2 ? { result: '0x' } : reply });
  await assert.rejects(f.rpc.prepareNft({
    ...selection, saved: { contractAddress: target, tokenStandard: 'ERC-1155', tokenId: max },
  }, { recipient, tokenId: max, amountUnits: max }, signal(), current, undefined, emptyNoncePlanner),
  { code: 'INVALID_RESPONSE' });
  assert.equal(calls, 2);
  assert.equal(f.calls.some(simulation), false);
});

const signedQuote = async (quote: EvmNftPreparedQuote) => {
  const transaction = quote.envelope.type === 2 ? { ...quote.envelope, accessList: quote.envelope.accessList.map(entry => ({ address: entry.address, storageKeys: [...entry.storageKeys] })) } : quote.envelope;
  const raw = await wallet.signTransaction({ ...transaction, nonce: Number(transaction.nonce) });
  return { raw, hash: Transaction.from(raw).hash! };
};

test('owned NFT requote repeats exact simulation and ownership and never renews the approved bytes or deadline', async () => {
  let time = 1000;
  let refreshing = false;
  const f = fixture({
    monotonicMilliseconds: () => time,
    rewrite: (call, reply) => refreshing && call.method === 'eth_maxPriorityFeePerGas'
      ? { result: '0x63' }
      : reply,
  });
  const rpc = f.createOwner();
  const approval = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
  refreshing = true;
  time += 100;
  f.calls.length = 0;
  const fresh = await rpc.requoteNft(selection, approval, signal(), current, emptyNoncePlanner);
  assert.equal(fresh.envelope, approval.envelope);
  assert.equal(fresh.intent, approval.intent);
  assert.equal(fresh.expiresAtMonotonicMilliseconds, approval.expiresAtMonotonicMilliseconds);
  assert.equal(fresh.maximumFeeUnits, approval.maximumFeeUnits);
  assert.deepEqual(f.calls.filter(simulation).map((c) => c.params),
    [[{ from: owner, to: target, value: '0x0', data: erc721Data, gas: '0x8ca0', nonce: '0x7', type: '0x2', maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2' }, block.number]]);
  assert.deepEqual(f.calls.filter((c) => c.method === 'eth_call').length, 3);
  const estimate = f.calls.find((c) => c.method === 'eth_estimateGas');
  assert.deepEqual(estimate?.params, [{
    from: owner, to: target, value: '0x0', data: erc721Data, type: '0x2',
    chainId: '0x4d2', nonce: '0x7', accessList: [], maxFeePerGas: '0xfc', maxPriorityFeePerGas: '0x2',
  }, 'pending']);
  time = approval.expiresAtMonotonicMilliseconds;
  f.calls.length = 0;
  await assert.rejects(rpc.requoteNft(selection, approval, signal(), current, emptyNoncePlanner), { code: 'REVIEW_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('owned NFT requote refuses a changed selection, nonce, gas, holdings or transfer response', async () => {
  for (const [method, result, expected] of [
    ['eth_getTransactionCount', '0x8', 'REVIEW_REQUIRED'],
    ['eth_estimateGas', '0x8ca1', 'REVIEW_REQUIRED'],
    ['eth_call', '0x00', 'NFT_TRANSFER_REJECTED'],
    ['ownerOf', abi.encodeFunctionResult('ownerOf', [recipient]), 'INSUFFICIENT_NFT_BALANCE'],
  ] as const) {
    let changed = false;
    const f = fixture({ rewrite: (call, reply) => {
      if (!changed) return reply;
      const selectedOwnership = method === 'ownerOf' && call.method === 'eth_call' &&
        !simulation(call) && Object.hasOwn(reply, 'result');
      const requested = method === call.method && (method !== 'eth_call' || simulation(call));
      return selectedOwnership || requested ? { result } : reply;
    } });
    const rpc = f.createOwner();
    const approval = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
    f.calls.length = 0;
    await assert.rejects(rpc.requoteNft({ ...selection, owner: recipient }, approval, signal(), current, emptyNoncePlanner),
      { code: 'INVALID_RESPONSE' });
    assert.equal(f.calls.length, 0);
    changed = true;
    await assert.rejects(rpc.requoteNft(selection, approval, signal(), current, emptyNoncePlanner), { code: expected });
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
  }
});

test('NFT POST requires same-owner requote and exact signed bytes, then starts once with the owned signal', async () => {
  const f = fixture();
  const rpc = f.createOwner();
  const original = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
  const fresh = await rpc.requoteNft(selection, original, signal(), current, emptyNoncePlanner);
  const signed = await signedQuote(fresh);
  f.calls.length = 0;
  for (const approval of [original, { ...fresh }]) {
    await assert.rejects(rpc.broadcast(signed.raw, signed.hash, signal(), admission(rpc, approval)), { name: 'NativeTransferRpcError', code: 'REVIEW_REQUIRED' });
  }
  await assert.rejects(f.createOwner().broadcast(signed.raw, signed.hash, signal(), admission(rpc, fresh)), { name: 'NativeTransferRpcError', code: 'REVIEW_REQUIRED' });
  const transaction = fresh.envelope.type === 2 ? { ...fresh.envelope, accessList: fresh.envelope.accessList.map(entry => ({ address: entry.address, storageKeys: [...entry.storageKeys] })) } : fresh.envelope;
  const wrong = await wallet.signTransaction({ ...transaction, nonce: 8 });
  await assert.rejects(rpc.broadcast(wrong, Transaction.from(wrong).hash!, signal(), admission(rpc, fresh)), { name: 'NativeTransferRpcError', code: 'INVALID_RESPONSE' });
  await assert.rejects(rpc.broadcast(signed.raw, signed.hash, signal(), {
    ...admission(rpc, fresh), admit: (send: () => Promise<string>) => send(),
  }), { code: 'REVIEW_REQUIRED' });
  assert.equal(f.calls.length, 0);

  assert.equal(await rpc.broadcast(signed.raw, signed.hash, signal(), admission(rpc, fresh)), signed.hash);
  assert.equal(f.calls.at(0)?.method, 'eth_chainId');
  assert.equal(f.calls.filter(simulation).length, 1);
  assert.deepEqual(f.calls.filter(c => c.method === 'eth_sendRawTransaction').map(c => c.params), [[signed.raw]]);
  assert.equal(f.calls.at(-1)?.signal.aborted, true);
});

test('NFT POST does not start when currentness or original expiry changes during chain preflight', async () => {
  for (const expiry of [false, true]) {
    let time = 1000;
    let held = false;
    let generation = 0;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Reply>();
    const f = fixture({ monotonicMilliseconds: () => time, rewrite(call, reply) {
      if (!held || call.method !== 'eth_chainId') return reply;
      entered.resolve();
      return release.promise;
    } });
    const rpc = f.createOwner();
    const original = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
    const fresh = await rpc.requoteNft(selection, original, signal(), current, emptyNoncePlanner);
    const signed = await signedQuote(fresh);
    f.calls.length = 0;
    held = true;
    const pending = rpc.broadcast(signed.raw, signed.hash, signal(), admission(rpc, fresh, () => {
      if (generation !== 0) throw Error('Changed review');
    }));
    await entered.promise;
    if (expiry) time = original.expiresAtMonotonicMilliseconds;
    else generation += 2;
    release.resolve({ result: '0x4d2' });
    await assert.rejects(pending, expiry ? {
      name: 'NativeTransferRpcError', code: 'REVIEW_REQUIRED',
    } : /Changed review/);
    assert.equal(f.calls.at(0)?.method, 'eth_chainId');
    assert.equal(f.calls.some(c => c.method === 'eth_sendRawTransaction'), false);
  }
});

test('abort at final NFT transport admission prevents POST and a lost POST acknowledgement remains uncertain', async () => {
  const controller = new AbortController();
  let postFailure: Error | undefined;
  const f = fixture({ rewrite(call, reply) {
    if (postFailure && call.method === 'eth_sendRawTransaction') throw postFailure;
    return reply;
  } });
  const rpc = f.createOwner();
  const original = await rpc.prepareNft(selection, request, signal(), current, undefined, emptyNoncePlanner);
  const fresh = await rpc.requoteNft(selection, original, signal(), current, emptyNoncePlanner);
  const signed = await signedQuote(fresh);
  f.calls.length = 0;
  const options = admission(rpc, fresh);
  await assert.rejects(rpc.broadcast(signed.raw, signed.hash, controller.signal, {
    ...options,
    async admit(send: () => Promise<string>, preflight?: () => Promise<void>) {
      return options.admit(async () => {
        controller.abort();
        return send();
      }, preflight);
    },
  }), { name: 'NativeTransferRpcError', code: 'CANCELLED' });
  assert.equal(f.calls.some(c => c.method === 'eth_sendRawTransaction'), false);

  for (const failure of [Error('Lost response'), new NativeTransferRpcError('CANCELLED')]) {
    f.calls.length = 0;
    postFailure = failure;
    await assert.rejects(rpc.broadcast(signed.raw, signed.hash, signal(), options));
    assert.deepEqual(f.calls.filter(c => c.method === 'eth_sendRawTransaction').map(c => c.params), [[signed.raw]]);
  }
});


test('NFT automatic nonce binds sampled ownership block during quote and held dispatch', async () => {
  let advanced = false;
  const f = fixture({ rewrite: (call, reply) =>
    advanced && call.method === 'eth_getTransactionCount' && call.params[1] !== block.number
      ? { result: '0x8' } : reply,
  });
  const acceptance = new EvmAutoNonceAcceptance();
  const planner = (input: Parameters<EvmAutoNonceAcceptance['plan']>[0]) => acceptance.plan(input);
  const automatic = (input: Omit<Parameters<EvmAutoNonceAcceptance['plan']>[0], 'chainId' | 'from' | 'endpoint' | 'snapshot'>) => planner({
    ...input, chainId: network.chainId, from: owner, endpoint: network.rpcUrl,
    snapshot: { owner: 'fixture', minimumNonce: 0, retained: [], readAssetDebit: async () => 0n, readMaximumCost: async () => 0n },
  });
  const quote = await f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic);
  assert.equal(quote.envelope.nonce, '7');
  const tags = f.calls.filter((call) => call.method === 'eth_getTransactionCount').map((call) => call.params[1]);
  assert.deepEqual(new Set(tags), new Set(['latest', 'pending', block.number]));
  await f.rpc.verifyNftForDispatch(quote.intent, quote.envelope, signal(), current, false, undefined, automatic);
  advanced = true;
  await assert.rejects(f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic),
    { code: 'REVIEW_REQUIRED', reason: 'asset-state' });
  await assert.rejects(f.rpc.verifyNftForDispatch(quote.intent, quote.envelope, signal(), current, false, undefined, automatic),
    { code: 'REVIEW_REQUIRED', reason: 'asset-state' });
  assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
});


for (const phase of ['quote', 'dispatch'] as const) test(`NFT late same-sender block advance rejects ${phase}`, async () => {
    let advanced = false;
    let pauseEstimate = false;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const atEstimate = new Promise<void>((resolve) => { entered = resolve; });
    const f = fixture({ rewrite: async (call, reply) => {
      if (pauseEstimate && call.method === 'eth_estimateGas') {
        entered();
        await gate;
      }
      return advanced && call.method === 'eth_getTransactionCount' && call.params[1] === 'latest'
        ? { result: '0x8' } : reply;
    } });
    const acceptance = new EvmAutoNonceAcceptance();
    const automatic = (input: Omit<Parameters<EvmAutoNonceAcceptance['plan']>[0], 'chainId' | 'from' | 'endpoint' | 'snapshot'>) => acceptance.plan({
      ...input, chainId: network.chainId, from: owner, endpoint: network.rpcUrl,
      snapshot: { owner: 'fixture', minimumNonce: 0, retained: [], readAssetDebit: async () => 0n, readMaximumCost: async () => 0n },
    });
    const initial = phase === 'dispatch'
      ? await f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic)
      : undefined;
    f.calls.length = 0;
    pauseEstimate = true;
    const operation = phase === 'quote'
      ? f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic)
      : f.rpc.verifyNftForDispatch(initial!.intent, initial!.envelope, signal(), current, false, undefined, automatic);
    await atEstimate;
    assert.ok(f.calls.some((call) => call.method === 'eth_getTransactionCount' && call.params[1] === 'latest'));
    assert.ok(f.calls.some((call) => call.method === 'eth_getTransactionCount' && call.params[1] === block.number));
    advanced = true;
    release();
    await assert.rejects(operation, { code: 'REVIEW_REQUIRED' });
    assert.equal(f.calls.filter((call) => call.method === 'eth_getTransactionCount' && call.params[1] === 'latest').length, 2);
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
});

for (const phase of ['quote', 'dispatch'] as const) {
  test(`NFT ${phase} rejects a chain switch during the final nonce read`, async () => {
    let latestReads = 0;
    let switchAtLatest = phase === 'quote' ? 2 : Number.POSITIVE_INFINITY;
    let switched = false;
    const f = fixture({ rewrite: (call, reply) => {
      if (call.method === 'eth_getTransactionCount' && call.params[1] === 'latest' && ++latestReads === switchAtLatest)
        switched = true;
      return switched && call.method === 'eth_chainId' ? { result: '0x1' } : reply;
    } });
    const acceptance = new EvmAutoNonceAcceptance();
    const automatic = (input: Omit<Parameters<EvmAutoNonceAcceptance['plan']>[0], 'chainId' | 'from' | 'endpoint' | 'snapshot'>) => acceptance.plan({
      ...input, chainId: network.chainId, from: owner, endpoint: network.rpcUrl,
      snapshot: { owner: 'fixture', minimumNonce: 0, retained: [], readAssetDebit: async () => 0n, readMaximumCost: async () => 0n },
    });
    const quote = phase === 'dispatch'
      ? await f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic)
      : undefined;
    if (quote) switchAtLatest = latestReads + 2;
    const operation = quote
      ? f.rpc.verifyNftForDispatch(quote.intent, quote.envelope, signal(), current, false, undefined, automatic)
      : f.rpc.prepareNft(selection, request, signal(), current, undefined, automatic);
    await assert.rejects(operation, { code: 'PROFILE_CHANGED' });
    assert.equal(f.calls.some((call) => call.method === 'eth_sendRawTransaction'), false);
  });
}
