import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import {
  getNativeSendContext,
  getNativeSendCapabilities,
  NATIVE_NETWORKS,
} from '../src/custody/networkContext.ts';

const owner = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const hash = (number: number) => `0x${number.toString(16).padStart(64, '0')}`;
const expected = { hash: hash(1), from: owner, to: recipient, nonce: '0' };
const signal = () => new AbortController().signal;
type Call = { method: string; params: any[]; url: string; id: number };
function fixture(
  options: {
    block?: number;
    head?: number;
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
        result = '0x1644';
        break;
      case 'eth_getBlockByNumber': {
        assert.notEqual(
          call.params[0],
          'finalized',
          'depth policy never consumes finalized tag'
        );
        const number =
          call.params[0] === 'latest'
            ? options.head ?? 100
            : Number(BigInt(call.params[0]));
        result = {
          number: `0x${number.toString(16)}`,
          hash: hash(number),
          baseFeePerGas: '0x1',
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
        result = '0x100000000000000000';
        break;
      case 'eth_feeHistory':
        result = { oldestBlock: '0x63', baseFeePerGas: ['0x1', '0x1'] };
        break;
      case 'eth_maxPriorityFeePerGas':
        result = '0x1';
        break;
      case 'eth_estimateGas':
        result = '0x5208';
        break;
      case 'eth_getTransactionReceipt': {
        receiptReads++;
        if (options.oversized === receiptReads)
          return new Response('x'.repeat(17000), {
            headers: { 'Content-Type': 'application/json' },
          });
        const number = options.block ?? 89;
        result = options.missing
          ? null
          : {
              transactionHash: expected.hash,
              from: owner,
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
    result = options.update?.(call, result) ?? result;
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: call.id, result }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  };
  return {
    calls,
    rpc: new NativeTransferRpc({
      networkId: 'syscoin-nevm-testnet',
      fetch: fetcher,
    }),
    reader: new EvmTransferReadRpc('syscoin-nevm-testnet', { fetch: fetcher }),
  };
}

test('only the fixed NEVM testnet adds native send and never ERC20 capability', () => {
  for (const network of NATIVE_NETWORKS) {
    const capability = getNativeSendCapabilities(network.id);
    assert.equal(
      capability.native,
      ['ethereum', 'syscoin-nevm-testnet', 'zksys-testnet'].includes(network.id)
    );
    assert.equal(capability.erc20, network.id === 'ethereum');
    assert(Object.isFrozen(capability));
  }
  const context = getNativeSendContext('syscoin-nevm-testnet');
  assert.equal(context.chainId, '5700');
  assert.equal(context.symbol, 'TSYS');
  assert.equal(context.rpcUrl, 'https://rpc.tanenbaum.io');
  assert.deepEqual(context.settlement, {
    kind: 'nevm-depth-12',
    confirmations: 12,
  });
  assert(Object.isFrozen(context));
  assert(Object.isFrozen(context.settlement));
  const rpc = new NativeTransferRpc({ networkId: 'syscoin-nevm-testnet' });
  assert.throws(() =>
    Object.assign(rpc, {
      context: { ...context, rpcUrl: 'https://untrusted.invalid' },
    })
  );
  assert.throws(() =>
    Object.assign(rpc.context, { rpcUrl: 'https://untrusted.invalid' })
  );
  assert.throws(() => getNativeSendContext('syscoin-nevm'));
  assert.throws(() => new NativeTransferRpc({ networkId: 'base' }));
});

test('testnet quotes and broadcast bind chain5700 and its fixed endpoint', async () => {
  const f = fixture();
  const quote = await f.rpc.prepare(owner, recipient, '1', signal());
  assert.equal(quote.transaction.chainId, '5700');
  assert(
    f.calls.every(
      (call) => call.url === getNativeSendContext('syscoin-nevm-testnet').rpcUrl
    )
  );
  const wallet = Wallet.fromPhrase(
    'test test test test test test test test test test test junk'
  );
  const signed = await wallet.signTransaction({
    ...quote.transaction,
    from: wallet.address,
    nonce: 0,
  });
  const tx = Transaction.from(signed);
  assert.equal(await f.rpc.broadcast(signed, tx.hash!, signal()), tx.hash);
  const wrong = await wallet.signTransaction({
    ...quote.transaction,
    from: wallet.address,
    chainId: 1,
    nonce: 0,
  });
  await assert.rejects(
    f.rpc.broadcast(wrong, Transaction.from(wrong).hash!, signal()),
    { code: 'INVALID_RESPONSE' }
  );
  const before = f.calls.length;
  await assert.rejects(
    f.rpc.prepareToken(
      owner,
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
  assert.equal(f.calls.length, before);
  const mismatch = fixture({
    update: (call, result) => (call.method === 'eth_chainId' ? '0x1' : result),
  });
  await assert.rejects(mismatch.rpc.prepare(owner, recipient, '1', signal()), {
    code: 'INVALID_RESPONSE',
  });
  assert.deepEqual(
    mismatch.calls.map((call) => call.method),
    ['eth_chainId']
  );
});

for (const [block, eligible] of [
  [90, false],
  [89, true],
  [88, true],
] as const) {
  test(`testnet depth boundary at${
    101 - block
  }confirmations is explicit and never finalized`, async () => {
    const f = fixture({ block });
    const result = await f.rpc.receipt(expected, signal());
    assert.equal(result?.status, 'confirmed');
    assert.equal(result?.finalized, false);
    assert.equal(result?.terminalEligible, eligible);
    const nonceCalls = f.calls.filter(
      (call) => call.method === 'eth_getTransactionCount'
    );
    assert.deepEqual(
      nonceCalls.map((call) => call.params),
      [[owner, '0x59']]
    );
  });
}

test('missing and oversized receipts can prove only consumed nonce at the canonical depth anchor', async () => {
  for (const options of [
    { missing: true },
    { oversized: 1 },
    { oversized: 2 },
  ]) {
    const f = fixture(options);
    assert.deepEqual(await f.rpc.receipt(expected, signal()), {
      status: 'nonce-consumed',
      finalized: false,
      terminalEligible: true,
    });
  }
  const absent = fixture({ missing: true, consumed: false });
  assert.equal(
    await absent.rpc.receipt(expected, signal()),
    null,
    'absence may offer only explicit same-byte retry'
  );
  for (const options of [
    { oversized: 1, consumed: false },
    { oversized: 1, head: 10 },
  ])
    await assert.rejects(fixture(options).rpc.receipt(expected, signal()), {
      code: 'UNAVAILABLE',
    });
});

test('testnet depth rejects receipt, anchor and head inconsistencies', async () => {
  for (const update of [
    (call: Call, result: any) =>
      call.method === 'eth_getTransactionReceipt'
        ? { ...result, from: recipient }
        : result,
    (call: Call, result: any) =>
      call.method === 'eth_getTransactionReceipt'
        ? { ...result, transactionHash: hash(2) }
        : result,
    (call: Call, result: any) =>
      call.method === 'eth_getBlockByNumber' && call.params[0] === '0x59'
        ? { ...result, hash: hash(4) }
        : result,
    (call: Call, result: any) =>
      call.method === 'eth_getBlockByNumber' && call.params[0] === '0x64'
        ? { ...result, hash: hash(4) }
        : result,
  ])
    await assert.rejects(fixture({ update }).rpc.receipt(expected, signal()), {
      code: 'INVALID_RESPONSE',
    });
  let repeats = 0;
  const changed = fixture({
    update: (call, result: any) =>
      call.method === 'eth_getTransactionReceipt' && ++repeats === 2
        ? { ...result, status: '0x0' }
        : result,
  });
  await assert.rejects(changed.rpc.receipt(expected, signal()), {
    code: 'INVALID_RESPONSE',
  });
});

test('testnet read guards revoke every depth-policy boundary including repeated receipt', async () => {
  for (const method of [
    'eth_getBlockByNumber',
    'eth_getTransactionCount',
    'eth_getTransactionReceipt',
  ]) {
    let current = true;
    const f = fixture({
      onCall: (call) => {
        if (call.method === method) current = false;
      },
    });
    await assert.rejects(
      f.reader.receipt(expected, signal(), () => {
        if (!current) throw Error('changed');
      }),
      { code: 'CANCELLED' }
    );
    assert.equal(f.calls.at(-1)?.method, method);
  }
});
