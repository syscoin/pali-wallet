import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { getEvmTransferProfile } from '../src/custody/evmTransferProfiles.ts';
import {
  getNativeNetwork,
  getNativeSendContext,
  getNativeSendCapabilities,
  nativeTransferGasLimit,
} from '../src/custody/networkContext.ts';
import { snapshotUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const expected = { hash: hash(1), from: sender, to: recipient, nonce: '0' };
const signal = () => new AbortController().signal;
type Call = { method: string; params: any[]; url: string; id: number };
function fixture(
  options: {
    block?: number;
    anchor?: number;
    consumed?: boolean;
    missing?: boolean;
    oversized?: number;
    update?: (call: Call, result: unknown) => unknown;
    onCall?: (call: Call) => void;
  } = {}
) {
  const calls: Call[] = [];
  let receiptReads = 0;
  const fetcher = async (url: string, init: RequestInit) => {
    const call: Call = { ...JSON.parse(String(init.body)), url };
    calls.push(call);
    options.onCall?.(call);
    let result: unknown;
    switch (call.method) {
      case 'eth_chainId':
        result = '0xdee1';
        break;
      case 'eth_getBlockByNumber': {
        const number =
          call.params[0] === 'latest'
            ? 100
            : call.params[0] === 'finalized'
            ? options.anchor ?? 90
            : Number(BigInt(call.params[0]));
        result = {
          number: `0x${number.toString(16)}`,
          hash: hash(number),
          baseFeePerGas: '0x64',
          gasLimit: '0x1000000',
        };
        break;
      }
      case 'eth_getTransactionCount':
        result =
          call.params[1] === 'pending' || options.consumed === false
            ? '0x0'
            : '0x1';
        break;
      case 'eth_getBalance':
        result = '0x10000000000000000';
        break;
      case 'eth_feeHistory':
        result = { oldestBlock: '0x63', baseFeePerGas: ['0x64', '0x64'] };
        break;
      case 'eth_maxPriorityFeePerGas':
        result = '0x0';
        break;
      case 'eth_estimateGas':
        result = '0xea60';
        break;
      case 'eth_getTransactionReceipt': {
        receiptReads++;
        if (options.oversized === receiptReads)
          return new Response('x'.repeat(17000), {
            headers: { 'Content-Type': 'application/json' },
          });
        const number = options.block ?? 90;
        result = options.missing
          ? null
          : {
              transactionHash: expected.hash,
              from: sender,
              to: recipient,
              status: '0x1',
              blockHash: hash(number),
              blockNumber: `0x${number.toString(16)}`,
            };
        break;
      }
      case 'eth_sendRawTransaction':
        result = Transaction.from(call.params[0]).hash;
        break;
      default:
        throw Error(`Unexpected RPC ${call.method}`);
    }
    if (options.update) result = options.update(call, result);
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: call.id, result }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };
  return {
    calls,
    rpc: new NativeTransferRpc({ networkId: 'zksys-testnet', fetch: fetcher }),
    reader: new EvmTransferReadRpc('zksys-testnet', { fetch: fetcher }),
  };
}

test('fixed zkSYS context enables only native type-2 and keeps its own policy and gas cap', async () => {
  const context = getNativeSendContext('zksys-testnet');
  assert.equal(context.chainId, '57057');
  assert.equal(context.symbol, 'TSYS');
  assert.equal(context.rpcUrl, 'https://rpc-zk.tanenbaum.io');
  assert.deepEqual(context.settlement, { kind: 'zkos-finalized-executed' });
  assert.deepEqual(getNativeSendCapabilities('zksys-testnet'), {
    native: true,
    erc20: false,
  });
  assert.equal(
    getEvmTransferProfile('zksys-testnet').feeModel,
    'zkos-inclusive-gas'
  );
  assert.equal(nativeTransferGasLimit('zksys-testnet'), 16777216n);
  assert(Object.isFrozen(context));
  assert(Object.isFrozen(context.settlement));
  const f = fixture();
  assert.throws(() =>
    Object.assign(f.rpc, {
      context: { ...context, rpcUrl: 'https://wrong.invalid' },
    })
  );
  await assert.rejects(
    f.rpc.prepareToken(
      sender,
      {
        kind: 'erc20-transfer',
        recipient,
        amountUnits: '1',
        token: {
          contractAddress: recipient,
          name: 'Token',
          symbol: 'TOK',
          decimals: 18,
        },
      },
      signal()
    )
  );
  assert.equal(f.calls.length, 0);
  const mismatch = fixture({
    update: (call, result) =>
      call.method === 'eth_chainId' ? '0x1644' : result,
  });
  await assert.rejects(mismatch.rpc.prepare(sender, recipient, '1', signal()), {
    code: 'INVALID_RESPONSE',
  });
  assert.deepEqual(
    mismatch.calls.map((c) => c.method),
    ['eth_chainId']
  );
});

test('zkSYS quote binds selected fees and nonce before a pubdata-sensitive estimate', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(sender, recipient, '7', signal());
  const estimate = f.calls.findIndex((c) => c.method === 'eth_estimateGas');
  for (const method of [
    'eth_getTransactionCount',
    'eth_getBalance',
    'eth_feeHistory',
    'eth_maxPriorityFeePerGas',
  ])
    assert(f.calls.findIndex((c) => c.method === method) < estimate);
  assert.deepEqual(f.calls[estimate]!.params, [
    {
      type: '0x2',
      chainId: '0xdee1',
      from: sender,
      to: recipient,
      nonce: '0x0',
      value: '0x7',
      data: '0x',
      maxFeePerGas: '0xc8',
      maxPriorityFeePerGas: '0x0',
    },
    'pending',
  ]);
  assert.equal(quote.transaction.gasLimit, '72000');
  assert.equal(quote.transaction.maxPriorityFeePerGas, '0');
  assert.equal(quote.maximumFeeUnits, '14400000');
  assert.equal(quote.totalUnits, '14400007');
  assert(
    f.calls.every((c) => c.url === getNativeNetwork('zksys-testnet').rpcUrl)
  );
  const fees = await f.reader.quoteFees(
    quote.transaction as any,
    signal(),
    () => undefined
  );
  assert.deepEqual(fees.extras, []);
  assert.equal(fees.maximumTotalUnits, quote.totalUnits);
  assert.equal(fees.envelopeFeeCapUnits, quote.maximumFeeUnits);
});

test('requote preserves the approved cap and zero tip when new suggestions change', async () => {
  const first = fixture();
  const approved = (await first.rpc.prepare(sender, recipient, '7', signal()))
    .transaction;
  const second = fixture({
    update: (call, result) => {
      if (call.method === 'eth_maxPriorityFeePerGas') return '0x32';
      if (call.method === 'eth_feeHistory')
        return { oldestBlock: '0x63', baseFeePerGas: ['0x6e', '0x6e'] };
      if (call.method === 'eth_estimateGas') {
        assert.equal(call.params[0].maxFeePerGas, '0xc8');
        assert.equal(call.params[0].maxPriorityFeePerGas, '0x0');
        return '0x11170'; // changed resource cost is exposed to confirmation, not hidden by a new tip
      }
      return result;
    },
  });
  const quote = await second.rpc.requote(approved, signal());
  assert.equal(quote.transaction.maxFeePerGas, approved.maxFeePerGas);
  assert.equal(quote.transaction.maxPriorityFeePerGas, '0');
  assert.equal(quote.transaction.gasLimit, '84000');
  const tooExpensive = fixture({
    update: (c, r) =>
      c.method === 'eth_feeHistory'
        ? { oldestBlock: '0x63', baseFeePerGas: ['0x100', '0x100'] }
        : r,
  });
  await assert.rejects(tooExpensive.rpc.requote(approved, signal()), {
    code: 'INVALID_RESPONSE',
  });
  assert(!tooExpensive.calls.some((c) => c.method === 'eth_estimateGas'));
});

test('zkSYS rejects gas-cap overflow, total overflow, unaffordable native collateral and stale nonce', async () => {
  for (const gas of ['0x1000001', '0xe00000']) {
    const f = fixture({
      update: (c, r) => (c.method === 'eth_estimateGas' ? gas : r),
    });
    await assert.rejects(f.rpc.prepare(sender, recipient, '1', signal()), {
      code: 'INVALID_RESPONSE',
    });
  }
  const low = fixture({
    update: (c, r) => (c.method === 'eth_getBalance' ? '0x100' : r),
  });
  await assert.rejects(low.rpc.prepare(sender, recipient, '1', signal()), {
    code: 'INSUFFICIENT_BALANCE',
  });
  const overflow = fixture({
    update: (c, r) =>
      c.method === 'eth_feeHistory'
        ? { oldestBlock: '0x63', baseFeePerGas: ['0x1', '0x' + 'f'.repeat(64)] }
        : r,
  });
  await assert.rejects(overflow.rpc.prepare(sender, recipient, '1', signal()));
  const quote = await fixture().rpc.prepare(sender, recipient, '1', signal());
  const nonce = fixture({
    update: (c, r) => (c.method === 'eth_getTransactionCount' ? '0x1' : r),
  });
  await assert.rejects(nonce.rpc.requote(quote.transaction, signal()), {
    code: 'INVALID_RESPONSE',
  });
  assert.throws(() =>
    snapshotUnsignedTransfer(
      { ...quote.transaction, gasLimit: '16777217' } as any,
      getNativeNetwork('zksys-testnet')
    )
  );
});

for (const [block, consumed, eligible] of [
  [90, true, true],
  [91, true, false],
  [90, false, false],
] as const) {
  test(`zkSYS receipt block ${block}, consumed ${consumed} uses numeric finalized execution`, async () => {
    const f = fixture({ block, consumed });
    const value = await f.rpc.receipt(expected, signal());
    assert.equal(value?.status, 'confirmed');
    assert.equal(value?.finalized, false);
    assert.equal(value?.terminalEligible, eligible);
    assert(
      f.calls.some(
        (c) => c.method === 'eth_getTransactionCount' && c.params[1] === '0x5a'
      )
    );
    assert(
      !f.calls.some(
        (c) =>
          c.method === 'eth_getTransactionCount' && c.params[1] === 'latest'
      )
    );
  });
}

for (const oversized of [undefined, 1, 2]) {
  test(`missing or oversized receipt ${oversized} never invents successful execution`, async () => {
    const f = fixture({ oversized, missing: oversized === undefined });
    assert.deepEqual(await f.rpc.receipt(expected, signal()), {
      status: 'nonce-consumed',
      finalized: false,
      terminalEligible: true,
    });
    const notConsumed = fixture({
      oversized: oversized === 2 ? 1 : oversized,
      missing: oversized === undefined,
      consumed: false,
    });
    if (oversized === undefined)
      assert.equal(await notConsumed.rpc.receipt(expected, signal()), null);
    else
      await assert.rejects(notConsumed.rpc.receipt(expected, signal()), {
        code: 'UNAVAILABLE',
      });
  });
}

test('unavailable finality, contradictory anchors, forged receipt and reorgs cannot retire a journal', async () => {
  for (const update of [
    (c: Call, r: any) =>
      c.method === 'eth_getBlockByNumber' && c.params[0] === 'finalized'
        ? null
        : r,
    (c: Call, r: any) =>
      c.method === 'eth_getBlockByNumber' && c.params[0] === 'finalized'
        ? { ...r, number: '0x65' }
        : r,
    (c: Call, r: any) =>
      c.method === 'eth_getBlockByNumber' && c.params[0] === '0x5a'
        ? { ...r, hash: hash(400) }
        : r,
    (c: Call, r: any) =>
      c.method === 'eth_getTransactionReceipt' ? { ...r, from: recipient } : r,
    (c: Call, r: any) =>
      c.method === 'eth_getBlockByNumber' && c.params[0] === '0x64'
        ? { ...r, hash: hash(400) }
        : r,
  ])
    await assert.rejects(fixture({ update }).rpc.receipt(expected, signal()));
  let reads = 0;
  const moved = fixture({
    update: (c, r: any) =>
      c.method === 'eth_getTransactionReceipt' && ++reads === 2
        ? { ...r, status: '0x0' }
        : r,
  });
  await assert.rejects(moved.rpc.receipt(expected, signal()), {
    code: 'INVALID_RESPONSE',
  });
});

test('every zkSYS receipt read respects authority revocation', async () => {
  const baseline = fixture();
  await baseline.reader.receipt(expected, signal(), () => undefined);
  for (let stop = 1; stop <= baseline.calls.length; stop++) {
    let valid = true,
      reads = 0;
    const f = fixture({
      onCall: () => {
        if (++reads === stop) valid = false;
      },
    });
    await assert.rejects(
      f.reader.receipt(expected, signal(), () => {
        if (!valid) throw Error('revoked');
      }),
      { code: 'CANCELLED' }
    );
  }
});

test('zkSYS broadcasts only fixed-chain type-2 bytes below the protocol gas cap', async () => {
  const wallet = Wallet.fromPhrase(
    'test test test test test test test test test test test junk'
  );
  const f = fixture();
  const tx = {
    type: 2,
    chainId: 57057,
    to: recipient,
    nonce: 0,
    value: 1,
    gasLimit: 72000,
    maxFeePerGas: 200,
    maxPriorityFeePerGas: 0,
  };
  const raw = await wallet.signTransaction(tx);
  assert.equal(
    await f.rpc.broadcast(raw, Transaction.from(raw).hash!, signal()),
    Transaction.from(raw).hash
  );
  for (const change of [{ chainId: 5700 }, { gasLimit: 16777217 }]) {
    const bad = await wallet.signTransaction({ ...tx, ...change });
    await assert.rejects(
      f.rpc.broadcast(bad, Transaction.from(bad).hash!, signal()),
      { code: 'INVALID_RESPONSE' }
    );
  }
});
