import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { keccak256 } from 'ethers/crypto';
import {
  encodeErc20Transfer,
  decodeErc20Transfer,
  parseTokenAmount,
} from '../../../source/shared/erc20.ts';
import {
  snapshotErc20TransferIntent,
  assertTransferIntentEnvelope,
} from '../src/custody/transferIntent.ts';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';

const sender = '0x52908400098527886E0F7030069857D2E4169EE7';
const recipient = '0x1111111111111111111111111111111111111111';
const contract = '0x2222222222222222222222222222222222222222';
const intent = snapshotErc20TransferIntent({
  kind: 'erc20-transfer',
  chainId: '1',
  token: {
    contractAddress: contract,
    name: 'Public fixture token',
    symbol: 'FIX',
    decimals: 2,
  },
  recipient,
  amountUnits: '123',
});
const word = (value: bigint | number) =>
  `0x${BigInt(value).toString(16).padStart(64, '0')}`;
type Request = { id: number; method: string; params: any[] };
function fixture(
  options: {
    decimals?: number;
    tokens?: bigint;
    eth?: bigint;
    simulation?: string;
    changedBlock?: boolean;
    gas?: bigint;
  } = {}
) {
  const requests: Request[] = [];
  let blocks = 0;
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body)) as Request;
      requests.push(request);
      let result: unknown;
      switch (request.method) {
        case 'eth_chainId':
          result = '0x1';
          break;
        case 'eth_getBlockByNumber':
          result = {
            number: '0x123',
            gasLimit: '0x1c9c380', baseFeePerGas:'0x1',
            hash:
              '0x' +
              (options.changedBlock && ++blocks > 1 ? 'b' : 'a').repeat(64),
          };
          break;
        case 'eth_getCode':
          result = '0x6000';
          break;
        case 'eth_getTransactionCount':
          result = '0x0';
          break;
        case 'eth_getBalance':
          result = `0x${(options.eth ?? 10n ** 18n).toString(16)}`;
          break;
        case 'eth_gasPrice':
          result='0x1';
          break;
        case 'eth_feeHistory':
          result = { oldestBlock: '0x123', baseFeePerGas: ['0x1', '0x1'] };
          break;
        case 'eth_maxPriorityFeePerGas':
          result = '0x1';
          break;
        case 'eth_estimateGas':
          result = `0x${(options.gas ?? 50000n).toString(16)}`;
          break;
        case 'eth_call':
          result =
            request.params[0].data === '0x313ce567'
              ? word(options.decimals ?? 2)
              : request.params[0].data.startsWith('0x70a08231')
              ? word(options.tokens ?? 10000n)
              : options.simulation ?? word(1);
          break;
        case 'eth_sendRawTransaction':
          result = keccak256(request.params[0]);
          break;
        default:
          throw new Error(`Unexpected fixture method ${request.method}`);
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  return { rpc, requests };
}
test('token amounts and transfer calldata preserve full uint8 precision and exact uint256 units', () => {
  assert.equal(parseTokenAmount('1.23', 2), '123');
  assert.equal(parseTokenAmount(`0.${'0'.repeat(254)}1`, 255), '1');
  assert.equal(
    parseTokenAmount(((1n << 256n) - 1n).toString(), 0),
    ((1n << 256n) - 1n).toString()
  );
  for (const [amount, precision] of [
    ['0', 18],
    ['1.001', 2],
    ['1e3', 2],
    ['1.0', 0],
    ['01', 2],
    [(1n << 256n).toString(), 0],
  ] as const)
    assert.throws(() => parseTokenAmount(amount, precision));
  const encoded = encodeErc20Transfer(recipient, '123');
  assert.equal(encoded.length, 138);
  assert.deepEqual(decodeErc20Transfer(encoded), {
    recipient,
    amountUnits: '123',
  });
  for (const bad of [
    encoded + '00',
    encoded.slice(0, -2),
    encoded.replace('a9059cbb', '095ea7b3'),
    encoded.slice(0, 10) + '1' + encoded.slice(11),
  ])
    assert.throws(() => decodeErc20Transfer(bad));
  assert.throws(() => encodeErc20Transfer('0x' + '0'.repeat(40), '1'));
});
test('intent binds exact contract, recipient, amount and zero native value without accessors', () => {
  const tx = {
    chainId: '1',
    to: contract,
    value: '0',
    data: encodeErc20Transfer(recipient, '123'),
  };
  assert.doesNotThrow(() => assertTransferIntentEnvelope(tx, intent));
  for (const change of [
    { to: recipient },
    { value: '1' },
    { chainId: '8453' },
    { data: encodeErc20Transfer(recipient, '124') },
    { data: '0x' },
  ])
    assert.throws(() =>
      assertTransferIntentEnvelope({ ...tx, ...change }, intent)
    );
  assert.throws(() => assertTransferIntentEnvelope(tx));
  let reads = 0;
  assert.throws(() =>
    snapshotErc20TransferIntent(
      Object.defineProperty({ ...intent }, 'amountUnits', {
        enumerable: true,
        get() {
          reads++;
          return '123';
        },
      })
    )
  );
  assert.equal(reads, 0);
  assert.throws(() =>
    assertTransferIntentEnvelope(
      Object.defineProperty({ ...tx }, 'data', {
        enumerable: true,
        get() {
          reads++;
          return tx.data;
        },
      }),
      intent
    )
  );
  assert.equal(reads, 0);
});
test('token quote simulates and estimates the exact call with separate token and ETH funding', async () => {
  const { rpc, requests } = fixture();
  const quote = await rpc.prepareToken(
    sender,
    intent,
    new AbortController().signal
  );
  assert.equal(quote.transaction.to, contract);
  assert.equal(quote.transaction.value, '0');
  assert.equal(quote.transaction.data, encodeErc20Transfer(recipient, '123'));
  assert.equal(quote.maximumFeeUnits, '180000');
  assert.equal(quote.totalUnits, '180000');
  assert.equal(quote.tokenBalanceUnits, '10000');
  assert.deepEqual(requests[0]!.params, []);
  assert.equal(requests[0]!.method, 'eth_chainId');
  const estimate = requests.find((r) => r.method === 'eth_estimateGas')!;
  assert.deepEqual(estimate.params, [
    {
      from: sender,
      to: contract,
      value: '0x0',
      data: encodeErc20Transfer(recipient, '123'),
      type:'0x2', chainId:'0x1', nonce:'0x0', maxFeePerGas:'0x3',maxPriorityFeePerGas:'0x1',
    },
    'pending',
  ]);
  await fixture({ simulation: '0x' }).rpc.prepareToken(
    sender,
    intent,
    new AbortController().signal
  );
});
test('token quote rejects false returns, changed precision, insufficient balances and inconsistent observations', async () => {
  for (const [options, code] of [
    [{ simulation: word(0) }, 'TOKEN_TRANSFER_REJECTED'],
    [{ decimals: 3 }, 'TOKEN_CHANGED'],
    [{ tokens: 122n }, 'INSUFFICIENT_TOKEN_BALANCE'],
    [{ eth: 179999n }, 'INSUFFICIENT_BALANCE'],
    [{ changedBlock: true }, 'INVALID_RESPONSE'],
    [{ gas: 30000001n }, 'INVALID_RESPONSE'],
  ] as const) {
    await assert.rejects(
      fixture(options).rpc.prepareToken(
        sender,
        intent,
        new AbortController().signal
      ),
      { code }
    );
  }
});
test('broadcast accepts only signed native transfers or the exact supplied token intent', async () => {
  const signer = Wallet.fromPhrase(
    'test test test test test test test test test test test junk'
  );
  const raw = await signer.signTransaction({
    type: 2,
    chainId: 1,
    nonce: 0,
    to: contract,
    value: 0,
    data: encodeErc20Transfer(recipient, '123'),
    gasLimit: 60000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
  const { rpc, requests } = fixture();
  await assert.rejects(
    rpc.broadcast(raw, keccak256(raw), new AbortController().signal),
    { code: 'INVALID_RESPONSE' }
  );
  assert.equal(requests.length, 0);
  await assert.rejects(
    rpc.broadcast(raw, keccak256(raw), new AbortController().signal, {
      ...intent,
      amountUnits: '124',
    }),
    { code: 'INVALID_RESPONSE' }
  );
  assert.equal(requests.length, 0);
  assert.equal(
    await rpc.broadcast(
      raw,
      keccak256(raw),
      new AbortController().signal,
      intent
    ),
    keccak256(raw)
  );
});
