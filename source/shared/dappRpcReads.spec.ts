import { getUnrestrictedMethods } from '../scripts/Background/controllers/message-handler/method-registry';

import { DAPP_RPC_READ_METHODS, normalizeDappRpcRead } from './dappRpcReads';

const address = `0x${'11'.repeat(20)}`,
  hash = `0x${'22'.repeat(32)}`;
it('admits only stateless methods already exposed by the extension provider', () => {
  expect(
    DAPP_RPC_READ_METHODS.every((method) =>
      getUnrestrictedMethods().includes(method)
    )
  ).toBe(true);
  for (const method of [
    'eth_sendRawTransaction',
    'eth_sendTransaction',
    'eth_sign',
    'eth_subscribe',
    'eth_newFilter',
    'debug_traceCall',
  ])
    expect(() => normalizeDappRpcRead(method, [])).toThrow();
});
it('preserves legacy receipt objects and canonicalizes exact quantities without rounding', () => {
  expect(
    normalizeDappRpcRead('eth_getTransactionReceipt', [{ hash }]).params
  ).toEqual([hash]);
  expect(
    normalizeDappRpcRead('eth_getStorageAt', [address, '18446744073709551616'])
      .params
  ).toEqual([address, '0x10000000000000000', 'latest']);
  expect(
    normalizeDappRpcRead('eth_getBalance', [
      address,
      { blockHash: hash, requireCanonical: true },
    ]).params
  ).toEqual([address, { blockHash: hash, requireCanonical: true }]);
});
it('detaches transactions and uses the same alias/fee validation as signing', () => {
  const input = {
    from: address,
    to: address,
    input: '0x1234',
    gas: 21000,
    value: '2',
  };
  const result = normalizeDappRpcRead('eth_call', [input]);
  input.input = '0xffff';
  expect(result.params).toEqual([
    { from: address, to: address, data: '0x1234', gas: '0x5208', value: '0x2' },
    'latest',
  ]);
  expect(() =>
    normalizeDappRpcRead('eth_call', [
      { to: address },
      'latest',
      { balance: '1' },
    ])
  ).toThrow();
  expect(() =>
    normalizeDappRpcRead('eth_estimateGas', [{ to: address, unchecked: true }])
  ).toThrow();
});
it.each([
  ['eth_getBalance', ['invalid']],
  ['eth_getBalance', [address, Number.MAX_SAFE_INTEGER + 1]],
  ['eth_getBlockByNumber', ['latest', 'true']],
  ['eth_getTransactionByBlockHashAndIndex', [hash, -1]],
  ['eth_feeHistory', ['0x401', 'latest']],
  ['eth_feeHistory', ['0x1', 'latest', [50, 10]]],
  ['eth_getBalance', [address, { blockNumber: '0x1', blockHash: hash }]],
  ['eth_call', [{ to: address, data: `0x${'00'.repeat(1024 * 1024)}` }]],
])('rejects malformed or oversized %s before any RPC', (method, params) => {
  expect(() => normalizeDappRpcRead(method as string, params)).toThrow();
});
