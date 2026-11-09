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
it('detaches simulation transactions and canonicalizes unambiguous aliases', () => {
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
it.each(['eth_call', 'eth_estimateGas'])(
  '%s preserves type 1 and gasPrice access lists independently of wallet signing support',
  (method) => {
    const entry = { address, storageKeys: [hash, hash] };
    const input = {
      from: address,
      to: null,
      type: '0x01',
      gasPrice: '1000000000',
      gasLimit: 21000,
      accessList: [entry, entry],
    };
    const result = normalizeDappRpcRead(method, [input, 'pending']);
    entry.storageKeys[0] = 'invalid';
    input.accessList.length = 0;
    expect(result.params).toEqual([
      {
        from: address,
        to: null,
        type: '0x1',
        gasPrice: '0x3b9aca00',
        gas: '0x5208',
        accessList: [
          { address, storageKeys: [hash, hash] },
          { address, storageKeys: [hash, hash] },
        ],
        data: '0x',
      },
      'pending',
    ]);
  }
);
it.each([
  { gas: '0x0' },
  { nonce: '0x20000000000000' },
  { maxFeePerGas: '0x0', maxPriorityFeePerGas: '0x0' },
  { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' },
  { gasPrice: '0x1', maxFeePerGas: '0x2' },
  { type: '0x0', maxFeePerGas: '0x2', accessList: [] },
  { type: '0x2', gasPrice: '0x1' },
  { type: '0x7f' },
])(
  'leaves simulation type, nonce and fee execution policy to the node: %p',
  (tx) => {
    for (const method of ['eth_call', 'eth_estimateGas'])
      expect(normalizeDappRpcRead(method, [tx]).params[0]).toEqual({
        ...tx,
        data: '0x',
      });
  }
);
it('preserves bounded blob and authorization simulation fields without creating a signing request', () => {
  const authorization = {
    chainId: '0x1',
    address,
    nonce: '0x0',
    yParity: '0x1',
    r: '0x2',
    s: '0x3',
  };
  const input = {
    from: address,
    to: address,
    type: '0x4',
    maxFeePerBlobGas: '0x0',
    blobVersionedHashes: [hash],
    blobs: ['0x1234'],
    commitments: ['0x5678'],
    proofs: ['0x9abc'],
    authorizationList: [authorization],
  };
  const result = normalizeDappRpcRead('eth_call', [input]);
  expect(result).toEqual({
    method: 'eth_call',
    params: [{ ...input, data: '0x' }, 'latest'],
  });
  input.blobVersionedHashes[0] = 'invalid';
  authorization.address = 'invalid';
  expect(result.params[0]).toMatchObject({
    blobVersionedHashes: [hash],
    authorizationList: [{ ...authorization, address }],
  });
  expect(() => normalizeDappRpcRead('eth_sendTransaction', [input])).toThrow();
});
it.each([
  null,
  [],
  { from: 'invalid' },
  { to: 'example.eth' },
  { gas: -1 },
  { gas: null },
  { gas: Number.MAX_SAFE_INTEGER + 1 },
  { value: `0x1${'0'.repeat(64)}` },
  { type: '0x100' },
  { data: '0x1' },
  { input: 'invalid' },
  { data: '0x00', input: '0x01' },
  { gas: '0x1', gasLimit: '0x2' },
  { accessList: {} },
  { accessList: [{ address, storageKeys: ['0x1'] }] },
  { accessList: [{ address, storageKeys: [], unchecked: true }] },
  { blobVersionedHashes: ['0x1'] },
  { blobs: ['0x1'] },
  { commitments: {} },
  { proofs: [false] },
  { authorizationList: [{ chainId: '0x1', address }] },
  {
    authorizationList: [
      {
        chainId: '0x1',
        address,
        nonce: '0x0',
        yParity: '0x100',
        r: '0x1',
        s: '0x1',
      },
    ],
  },
  { unchecked: true },
])('rejects malformed simulation fields before RPC: %p', (tx) => {
  for (const method of ['eth_call', 'eth_estimateGas'])
    expect(() => normalizeDappRpcRead(method, [tx])).toThrow();
});
it('keeps the existing byte and work limits for nested simulation fields', () => {
  expect(() =>
    normalizeDappRpcRead('eth_estimateGas', [
      { blobs: [`0x${'00'.repeat(1024 * 1024)}`] },
    ])
  ).toThrow('Request exceeds wallet work limits');
  expect(() =>
    normalizeDappRpcRead('eth_call', [
      { accessList: [{ address, storageKeys: Array(10_001).fill(hash) }] },
    ])
  ).toThrow('Request exceeds wallet work limits');
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
