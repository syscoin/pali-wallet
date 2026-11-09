import { getUnrestrictedMethods } from '../scripts/Background/controllers/message-handler/method-registry';

import {
  DAPP_PUBLIC_RPC_METHODS,
  DAPP_RPC_METHOD_CLASSIFICATION,
  classifyDappRpcMethod,
  executeDappRpcRequest,
  normalizeDappRpcRequest,
} from './dappRpcReads';

const address = `0x${'11'.repeat(20)}`,
  hash = `0x${'22'.repeat(32)}`;
it.each([
  null,
  {},
  {
    fromBlock: 'earliest',
    toBlock: 'pending',
    address: [address, address],
    topics: [null, [hash, null], []],
  },
  {
    blockHash: hash,
    fromBlock: null,
    toBlock: null,
    address: null,
    topics: null,
  },
  { fromBlock: '0x00', toBlock: 'safe', address, topics: [hash, [hash]] },
])(
  'preserves valid bounded log filters without block-range or canonical-chain policy: %p',
  (filter) => {
    const original = JSON.parse(JSON.stringify(filter));
    const normalized = normalizeDappRpcRequest('eth_getLogs', [filter]);
    expect(filter).toEqual(original);
    expect(normalized.params).toEqual([
      filter && 'fromBlock' in filter && filter.fromBlock === '0x00'
        ? { ...filter, fromBlock: '0x0' }
        : filter,
    ]);
  }
);
it.each([
  [address, ['', '0x', '0X', 'f', '0XABC', hash, '0'.repeat(64)]],
  [address, null, null],
  [address, [], 'pending'],
  [address, ['0x0'], { blockHash: hash, requireCanonical: false }],
  [address, [], `0x${'00'.repeat(31)}01`],
  [address, [], { blockHash: hash, blockNumber: null }],
  [address, [], { blockHash: hash, requireCanonical: null }],
  [
    address,
    [],
    { blockNumber: 'latest', blockHash: null, requireCanonical: true },
  ],
])(
  'preserves proof key strings/width and omitted or null block semantics: %p',
  (...params) => {
    expect(normalizeDappRpcRequest('eth_getProof', params).params).toEqual(
      params
    );
  }
);
it.each(['web3_clientVersion', 'net_listening', 'net_peerCount'])(
  '%s accepts exactly zero arguments',
  (method) => {
    expect(normalizeDappRpcRequest(method, undefined).params).toEqual([]);
    expect(() => normalizeDappRpcRequest(method, [null])).toThrow();
  }
);
it.each([
  ['eth_getLogs', []],
  ['eth_getLogs', [{ topics: ['0x1'] }]],
  ['eth_getLogs', [{ topics: [[[hash]]] }]],
  ['eth_getLogs', [{ address: [null] }]],
  ['eth_getLogs', [{ fromBlock: { blockHash: hash } }]],
  ['eth_getLogs', [{ blockHash: hash, toBlock: 'latest' }]],
  ['eth_getLogs', [{ blockHash: '0x1' }]],
  ['eth_getLogs', [{ extra: true }]],
  ['eth_getProof', [address]],
  ['eth_getProof', [address, ['0xgg']]],
  ['eth_getProof', [address, ['0x' + '0'.repeat(65)]]],
  ['eth_getProof', [address, [false]]],
  ['eth_getProof', [address, [], { blockHash: hash, blockNumber: '0x1' }]],
  ['personal_ecRecover', ['text']],
  ['personal_ecRecover', ['text', null]],
])('rejects malformed %s shapes before execution', (method, params) => {
  expect(() => normalizeDappRpcRequest(method as string, params)).toThrow();
});
it('applies existing byte/work limits to log filters, proof keys and public recovery', () => {
  for (const [method, params] of [
    ['eth_getLogs', [{ topics: Array(10_001).fill(hash) }]],
    ['eth_getProof', [address, Array(10_001).fill('0x0')]],
    ['personal_ecRecover', ['x'.repeat(1024 * 1024), 'signature']],
  ] as const)
    expect(() => normalizeDappRpcRequest(method, params)).toThrow(
      'Request exceeds wallet work limits'
    );
});
it('executes recovery locally with the SDK port and one shared checksum path', async () => {
  const read = jest.fn(),
    verifyPersonalMessage = jest.fn(
      () => '0x52908400098527886e0f7030069857d2e4169ee7'
    ),
    assertCurrent = jest.fn();
  await expect(
    executeDappRpcRequest(
      normalizeDappRpcRequest('personal_ecRecover', [
        '0xabc',
        'compact-signature',
      ]),
      { request: read, verifyPersonalMessage, assertCurrent }
    )
  ).resolves.toBe('0x52908400098527886E0F7030069857D2E4169EE7');
  expect(read).not.toHaveBeenCalled();
  expect(verifyPersonalMessage).toHaveBeenCalledWith(
    '0xabc',
    'compact-signature'
  );
  expect(assertCurrent).toHaveBeenCalledTimes(2);
});
it('checks ownership after successful and failed asynchronous reads and bounds response work', async () => {
  for (const failure of [false, true]) {
    let current = true;
    await expect(
      executeDappRpcRequest(normalizeDappRpcRequest('net_listening', []), {
        assertCurrent() {
          if (!current) throw Error('STALE');
        },
        verifyPersonalMessage() {
          throw Error('Must not verify');
        },
        async request() {
          current = false;
          if (failure) throw Error('Provider failed');
          return true;
        },
      })
    ).rejects.toThrow('STALE');
  }
  await expect(
    executeDappRpcRequest(normalizeDappRpcRequest('web3_clientVersion', []), {
      assertCurrent() {},
      verifyPersonalMessage() {
        throw Error('Must not verify');
      },
      async request() {
        return 'x'.repeat(1024 * 1024 + 1);
      },
    })
  ).rejects.toThrow('Request exceeds wallet work limits');
});
it.each([false, true])(
  'refuses an asynchronous initial authority guard, including rejection=%s, before any capability runs',
  async (rejected) => {
    for (const method of ['net_listening', 'personal_ecRecover']) {
      const read = jest.fn(),
        verifyPersonalMessage = jest.fn();
      await expect(
        executeDappRpcRequest(
          normalizeDappRpcRequest(
            method,
            method === 'personal_ecRecover' ? ['message', 'signature'] : []
          ),
          {
            request: read,
            verifyPersonalMessage,
            assertCurrent: () =>
              rejected
                ? Promise.reject(Error('late authority rejection'))
                : Promise.resolve(),
          }
        )
      ).rejects.toThrow('guard must be synchronous');
      expect(read).not.toHaveBeenCalled();
      expect(verifyPersonalMessage).not.toHaveBeenCalled();
    }
  }
);
it.each([false, true])(
  'refuses an asynchronous final authority guard after the owned RPC await, including rejection=%s',
  async (rejected) => {
    let guardCalls = 0,
      release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const read = jest.fn(() => pending),
      verifyPersonalMessage = jest.fn();
    const result = executeDappRpcRequest(
      normalizeDappRpcRequest('net_listening', []),
      {
        request: read,
        verifyPersonalMessage,
        assertCurrent() {
          if (++guardCalls === 2)
            return rejected
              ? Promise.reject(Error('late authority rejection'))
              : Promise.resolve();
        },
      }
    );
    const refused = expect(result).rejects.toThrow('guard must be synchronous');
    expect(read).toHaveBeenCalledTimes(1);
    release(true);
    await refused;
    expect(guardCalls).toBe(2);
    expect(verifyPersonalMessage).not.toHaveBeenCalled();
  }
);
it('classifies the exact unrestricted registry, including custom and unsupported methods, with no default forwarding', () => {
  const registry = getUnrestrictedMethods();
  expect(registry).toHaveLength(47);
  expect(Object.keys(DAPP_RPC_METHOD_CLASSIFICATION).sort()).toEqual(
    [...registry].sort()
  );
  expect(DAPP_PUBLIC_RPC_METHODS).toHaveLength(42);
  expect(new Set(DAPP_PUBLIC_RPC_METHODS).size).toBe(42);
  expect(
    Object.entries(DAPP_RPC_METHOD_CLASSIFICATION)
      .filter(([, kind]) => kind === 'custom')
      .map(([method]) => method)
      .sort()
  ).toEqual(['eth_accounts', 'eth_chainId', 'net_version']);
  expect(
    Object.entries(DAPP_RPC_METHOD_CLASSIFICATION)
      .filter(([, kind]) => kind === 'unsupported')
      .map(([method]) => method)
      .sort()
  ).toEqual(['eth_subscribe', 'eth_unsubscribe']);
  expect(
    Object.entries(DAPP_RPC_METHOD_CLASSIFICATION)
      .filter(([, kind]) => kind === 'node-control')
      .map(([method]) => method)
      .sort()
  ).toEqual([
    'eth_getFilterChanges',
    'eth_newBlockFilter',
    'eth_newFilter',
    'eth_newPendingTransactionFilter',
    'eth_submitHashrate',
    'eth_submitWork',
    'eth_uninstallFilter',
  ]);
  expect(classifyDappRpcMethod('future_unclassified')).toBeNull();
  for (const method of [
    'eth_sendRawTransaction',
    'eth_sendTransaction',
    'eth_sign',
    'eth_subscribe',
    'eth_accounts',
    'eth_chainId',
    'net_version',
    'debug_traceCall',
  ])
    expect(() => normalizeDappRpcRequest(method, [])).toThrow();
});

it.each([
  ['eth_coinbase', []],
  ['eth_getWork', null],
  ['eth_hashrate', []],
  ['eth_mining', undefined],
  ['web3_sha3', ['0Xabcd']],
  ['web3_sha3', ['']],
  ['web3_sha3', ['0x']],
  ['eth_getFilterChanges', ['0x0000aBcD']],
  ['eth_getFilterLogs', ['opaque-server-ID']],
  ['eth_uninstallFilter', ['0x00ABC']],
  ['eth_newBlockFilter', []],
  [
    'eth_newFilter',
    [{ blockHash: hash, fromBlock: null, topics: [null, [hash, null]] }],
  ],
  ['eth_newPendingTransactionFilter', []],
  ['eth_newPendingTransactionFilter', [true]],
  ['eth_newPendingTransactionFilter', [null]],
  ['eth_submitHashrate', ['0x1', hash]],
  ['eth_submitHashrate', [`0x${'00'.repeat(31)}01`, hash]],
  ['eth_submitHashrate', ['', hash]],
  ['eth_submitHashrate', [`0x${'ab'.repeat(40)}`, hash]],
  ['eth_submitWork', ['0x0000000000000001', hash, hash]],
])(
  'preserves the bounded asynchronous node contract for %s',
  (method, params) => {
    expect(normalizeDappRpcRequest(method as string, params).params).toEqual(
      params == null ? [] : params
    );
  }
);
it.each([
  ['eth_coinbase', [1]],
  ['eth_getWork', [1]],
  ['eth_hashrate', [1]],
  ['eth_mining', [1]],
  ['web3_sha3', ['0x1']],
  ['web3_sha3', [null]],
  ['web3_sha3', ['0x00', 'extra']],
  ['eth_getFilterChanges', [1]],
  ['eth_getFilterLogs', [null]],
  ['eth_uninstallFilter', [{}]],
  ['eth_newBlockFilter', [false]],
  ['eth_newFilter', [{ topics: [false] }]],
  ['eth_newPendingTransactionFilter', [1]],
  ['eth_newPendingTransactionFilter', [false, true]],
  ['eth_submitHashrate', [null, hash]],
  ['eth_submitHashrate', ['invalid', hash]],
  ['eth_submitHashrate', ['0x1', '0x1']],
  ['eth_submitWork', ['0x1', hash, hash]],
  ['eth_submitWork', ['0x0000000000000001', null, hash]],
  ['eth_submitWork', ['0x0000000000000001', hash]],
])(
  'rejects malformed public query/control %s before any node operation',
  (method, params) => {
    expect(() => normalizeDappRpcRequest(method as string, params)).toThrow();
  }
);
it('keeps existing byte/work limits for remote controls and hashing without node policy additions', () => {
  for (const [method, params] of [
    ['eth_getFilterChanges', ['x'.repeat(1024 * 1024)]],
    ['web3_sha3', [`0x${'00'.repeat(1024 * 1024)}`]],
    ['eth_newFilter', [{ topics: Array(10_001).fill(hash) }]],
    ['eth_submitHashrate', ['x'.repeat(1024 * 1024), hash]],
  ] as const)
    expect(() => normalizeDappRpcRequest(method, params)).toThrow(
      'Request exceeds wallet work limits'
    );
});
it('preserves legacy receipt objects and canonicalizes exact quantities without rounding', () => {
  expect(
    normalizeDappRpcRequest('eth_getTransactionReceipt', [{ hash }]).params
  ).toEqual([hash]);
  expect(
    normalizeDappRpcRequest('eth_getStorageAt', [
      address,
      '18446744073709551616',
    ]).params
  ).toEqual([address, '0x10000000000000000', 'latest']);
  expect(
    normalizeDappRpcRequest('eth_getBalance', [
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
  const result = normalizeDappRpcRequest('eth_call', [input]);
  input.input = '0xffff';
  expect(result.params).toEqual([
    { from: address, to: address, data: '0x1234', gas: '0x5208', value: '0x2' },
    'latest',
  ]);
  expect(() =>
    normalizeDappRpcRequest('eth_call', [
      { to: address },
      'latest',
      { balance: '1' },
    ])
  ).toThrow();
  expect(() =>
    normalizeDappRpcRequest('eth_estimateGas', [
      { to: address, unchecked: true },
    ])
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
    const result = normalizeDappRpcRequest(method, [input, 'pending']);
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
      expect(normalizeDappRpcRequest(method, [tx]).params[0]).toEqual({
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
  const result = normalizeDappRpcRequest('eth_call', [input]);
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
  expect(() =>
    normalizeDappRpcRequest('eth_sendTransaction', [input])
  ).toThrow();
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
    expect(() => normalizeDappRpcRequest(method, [tx])).toThrow();
});
it('keeps the existing byte and work limits for nested simulation fields', () => {
  expect(() =>
    normalizeDappRpcRequest('eth_estimateGas', [
      { blobs: [`0x${'00'.repeat(1024 * 1024)}`] },
    ])
  ).toThrow('Request exceeds wallet work limits');
  expect(() =>
    normalizeDappRpcRequest('eth_call', [
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
  expect(() => normalizeDappRpcRequest(method as string, params)).toThrow();
});
