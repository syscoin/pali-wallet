import { Interface } from 'ethers';

import {
  prepareSpentCompletion,
  type SpentCompletionRequest,
} from './spentCompletion';

const abi = new Interface([
  'event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)',
]);
const pool = '0x' + '11'.repeat(20),
  recipient = '0x' + '22'.repeat(20),
  relayer = '0x' + '33'.repeat(20);
const account = '0x' + '44'.repeat(20),
  nullifier = '0x' + '55'.repeat(32);
const wHash = '0x' + '66'.repeat(32),
  pendingHash = '0x' + '77'.repeat(32);
const wBlock = '0x' + '88'.repeat(32),
  alternateBlock = '0x' + '99'.repeat(32),
  finalHash = '0x' + 'aa'.repeat(32);

function fixture() {
  const encoded = abi.encodeEventLog(abi.getEvent('Withdrawal')!, [
    recipient,
    nullifier,
    relayer,
    BigInt(1),
  ]);
  const blocks: Record<string, any> = {
    finalized: { number: '0x80', hash: finalHash },
    '0x80': { number: '0x80', hash: finalHash },
    '0x70': { number: '0x70', hash: wBlock },
  };
  const receipts: Record<string, any> = {
    [wHash]: {
      transactionHash: wHash,
      blockHash: wBlock,
      blockNumber: '0x70',
      status: '0x1',
      logs: [
        {
          address: pool,
          transactionHash: wHash,
          blockHash: wBlock,
          blockNumber: '0x70',
          removed: false,
          ...encoded,
        },
      ],
    },
  };
  const txs: Record<string, any> = {
    [wHash]: {
      hash: wHash,
      from: account,
      nonce: '0x2',
      blockHash: wBlock,
      blockNumber: '0x70',
    },
  };
  let current = true;
  const rpc = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return blocks[String(params[0])];
    if (method === 'eth_getTransactionReceipt')
      return receipts[String(params[0])];
    if (method === 'eth_getTransactionByHash') return txs[String(params[0])];
    throw new Error('unexpected method');
  });
  const request: SpentCompletionRequest = {
    poolAddress: pool,
    nullifierHash: nullifier,
    withdrawal: {
      phase: 'submitted',
      mode: 'direct',
      transactionHash: wHash,
      from: account,
      nonce: '2',
    },
    rpc,
    assertCurrent: () => {
      if (!current) throw new Error('session changed');
    },
  };
  return {
    request,
    rpc,
    blocks,
    receipts,
    txs,
    invalidate: () => {
      current = false;
    },
  };
}

it('requests only the direct withdrawal hash during preparation and revalidation', async () => {
  const f = fixture();
  const expectedCalls = [
    ['eth_chainId', []],
    ['eth_getBlockByNumber', ['finalized', false]],
    ['eth_getBlockByNumber', ['0x80', false]],
    ['eth_getTransactionReceipt', [wHash]],
    ['eth_getBlockByNumber', ['0x70', false]],
    ['eth_getTransactionByHash', [wHash]],
    ['eth_getBlockByNumber', ['0x80', false]],
  ];

  const lease = await prepareSpentCompletion(f.request);
  expect(f.rpc.mock.calls.map(([method, params]) => [method, params])).toEqual(
    expectedCalls
  );
  f.rpc.mockClear();
  await lease.revalidate();
  expect(f.rpc.mock.calls.map(([method, params]) => [method, params])).toEqual(
    expectedCalls
  );
});

it.each([
  'wrong-pool',
  'wrong-nullifier',
  'failed-withdrawal',
  'unfinalized',
  'changed-canonical',
  'wrong-withdrawal-nonce',
  'wrong-withdrawal-payer',
  'duplicate-event',
])('fails closed for %s', async (kind) => {
  const f = fixture();
  if (kind === 'wrong-pool') f.receipts[wHash].logs[0].address = recipient;
  if (kind === 'wrong-nullifier')
    f.request.nullifierHash = '0x' + 'ab'.repeat(32);
  if (kind === 'failed-withdrawal') f.receipts[wHash].status = '0x0';
  if (kind === 'unfinalized') f.blocks.finalized.number = '0x60';
  if (kind === 'changed-canonical') f.blocks['0x70'].hash = alternateBlock;
  if (kind === 'wrong-withdrawal-nonce') f.txs[wHash].nonce = '0x3';
  if (kind === 'wrong-withdrawal-payer') f.txs[wHash].from = relayer;
  if (kind === 'duplicate-event')
    f.receipts[wHash].logs.push(f.receipts[wHash].logs[0]);
  await expect(prepareSpentCompletion(f.request)).rejects.toThrow();
});

it('refuses a reorg or changed session between preparation and commit revalidation', async () => {
  const f = fixture();
  const lease = await prepareSpentCompletion(f.request);
  f.blocks['0x70'].hash = alternateBlock;
  await expect(lease.revalidate()).rejects.toThrow(
    'privacy_spent_proof_unavailable'
  );
  f.blocks['0x70'].hash = wBlock;
  f.invalidate();
  await expect(lease.revalidate()).rejects.toThrow(
    'privacy_spent_proof_unavailable'
  );
});

it('accepts a relayed submitted hash without inventing an account nonce, but not a job-only journal', async () => {
  const f = fixture();
  f.request.withdrawal = {
    phase: 'submitted',
    mode: 'relayed',
    transactionHash: wHash,
  };
  await expect(prepareSpentCompletion(f.request)).resolves.toBeDefined();
  (f.request.withdrawal as any).transactionHash = undefined;
  await expect(prepareSpentCompletion(f.request)).rejects.toThrow();
});

it.each(['too-many-logs', 'oversized-event-data', 'extra-topic'])(
  'bounds untrusted receipt structures: %s',
  async (kind) => {
    const f = fixture();
    const log = f.receipts[wHash].logs[0];
    if (kind === 'too-many-logs')
      f.receipts[wHash].logs = Array(4097).fill(log);
    if (kind === 'oversized-event-data') log.data += '00'.repeat(5000);
    if (kind === 'extra-topic') log.topics.push('0x' + 'aa'.repeat(32));
    await expect(prepareSpentCompletion(f.request)).rejects.toThrow(
      'privacy_spent_proof_unavailable'
    );
  }
);

it('captures its original RPC and session checks instead of mutable request properties', async () => {
  const f = fixture();
  const lease = await prepareSpentCompletion(f.request);
  f.request.rpc = jest.fn(async () => {
    throw new Error('replaced');
  });
  f.request.assertCurrent = () => {
    throw new Error('replaced');
  };
  await expect(lease.revalidate()).resolves.toBeUndefined();
});

it('aborts and fails closed when the proof run exceeds its total deadline', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.request.rpc = (_method, _params, nextSignal) => {
      signal = nextSignal;
      return new Promise(() => undefined);
    };
    const proof = prepareSpentCompletion(f.request);
    const failure = expect(proof).rejects.toThrow(
      'privacy_spent_proof_unavailable'
    );
    await jest.advanceTimersByTimeAsync(15000);
    await failure;
    expect(signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('selects a finalized matching replacement while preserving the original hash and exact prewrite evidence', async () => {
  const f = fixture();
  f.request.withdrawal = {
    phase: 'submitted',
    mode: 'relayed',
    transactionHash: pendingHash,
    transactionHashes: [pendingHash, wHash],
  };
  f.receipts[pendingHash] = null;
  const proof = await prepareSpentCompletion(f.request);
  expect(f.request.withdrawal.transactionHash).toBe(pendingHash);
  f.rpc.mockClear();
  await proof.revalidate();
  expect(
    f.rpc.mock.calls
      .filter(([method]) => method === 'eth_getTransactionReceipt')
      .map(([, params]) => params[0])
  ).toEqual([wHash]);
  f.receipts[wHash].logs[0].data = abi.encodeEventLog(
    abi.getEvent('Withdrawal')!,
    [account, nullifier, relayer, BigInt(1)]
  ).data;
  await expect(proof.revalidate()).rejects.toThrow(
    'privacy_spent_proof_unavailable'
  );
});

it.each(['direct', 'relayed'] as const)(
  'verifies a retained %s withdrawal when the latest submitted attempt reverts',
  async (mode) => {
    const f = fixture();
    const previous = f.request.withdrawal;
    const oldRelayHash = '0x' + 'ab'.repeat(32);
    f.request.withdrawal = {
      phase: 'submitted',
      mode: 'direct',
      transactionHash: pendingHash,
      from: relayer,
      nonce: '3',
    };
    f.request.retainedWithdrawals = [
      mode === 'direct'
        ? previous
        : {
            phase: 'submitted',
            mode,
            transactionHash: oldRelayHash,
            transactionHashes: [oldRelayHash, wHash],
          },
    ];
    f.receipts[pendingHash] = {
      ...f.receipts[wHash],
      transactionHash: pendingHash,
      status: '0x0',
    };
    f.receipts[oldRelayHash] = null;
    const proof = await prepareSpentCompletion(f.request);
    const receipts = () =>
      f.rpc.mock.calls
        .filter(([method]) => method === 'eth_getTransactionReceipt')
        .map(([, params]) => params[0]);
    expect(receipts()).toEqual(
      mode === 'direct'
        ? [pendingHash, wHash]
        : [pendingHash, oldRelayHash, wHash]
    );
    f.rpc.mockClear();
    await proof.revalidate();
    expect(receipts()).toEqual([wHash]);
    if (mode === 'direct') f.txs[wHash].nonce = '0x3';
    else f.receipts[wHash].logs[0].address = recipient;
    await expect(proof.revalidate()).rejects.toThrow(
      'privacy_spent_proof_unavailable'
    );
  }
);

it.each([
  'unmined',
  'failed',
  'wrong-event',
  'wrong-chain',
  'reorg',
  'over-capacity',
  'duplicate',
])('does not treat candidate/status hints as completion: %s', async (kind) => {
  const f = fixture();
  f.request.withdrawal = {
    phase: 'submitted',
    mode: 'relayed',
    transactionHash: pendingHash,
    transactionHashes: [pendingHash, wHash],
  };
  f.receipts[pendingHash] = null;
  if (kind === 'unmined') f.receipts[wHash] = null;
  if (kind === 'failed') f.receipts[wHash].status = '0x0';
  if (kind === 'wrong-event') f.receipts[wHash].logs[0].address = account;
  if (kind === 'reorg') f.blocks['0x70'].hash = alternateBlock;
  if (kind === 'wrong-chain') {
    const rpc = f.request.rpc;
    f.request.rpc = async (...args) =>
      args[0] === 'eth_chainId' ? '0x2' : rpc(...args);
  }
  if (kind === 'over-capacity')
    (f.request.withdrawal as any).transactionHashes = Array.from(
      { length: 17 },
      (_, i) => '0x' + (i + 1).toString(16).padStart(64, '0')
    );
  if (kind === 'duplicate')
    (f.request.withdrawal as any).transactionHashes = [
      pendingHash,
      pendingHash,
    ];
  await expect(prepareSpentCompletion(f.request)).rejects.toThrow(
    'privacy_spent_proof_unavailable'
  );
});

it('checks sixteen healthy candidates within one bounded operation using four workers and shared blocks', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    const hashes = Array.from(
      { length: 16 },
      (_, i) => '0x' + (i + 1).toString(16).padStart(64, '0')
    );
    hashes[15] = wHash;
    f.request.withdrawal = {
      phase: 'submitted',
      mode: 'relayed',
      transactionHash: hashes[0],
      transactionHashes: hashes,
    };
    const rpc = f.request.rpc;
    let active = 0,
      max = 0;
    f.request.rpc = async (...args) => {
      active++;
      max = Math.max(max, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (args[0] === 'eth_getTransactionReceipt' && args[1][0] !== wHash)
          return null;
        return rpc(...args);
      } finally {
        active--;
      }
    };
    const start = Date.now();
    const promise = prepareSpentCompletion(f.request);
    await jest.advanceTimersByTimeAsync(10500);
    await expect(promise).resolves.toBeDefined();
    expect(max).toBe(4);
    expect(Date.now() - start).toBeLessThan(15000);
    expect(
      f.rpc.mock.calls.filter(
        ([method, params]) =>
          method === 'eth_getBlockByNumber' && params[0] === '0x70'
      )
    ).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

it.each(['rejects', 'stalls'] as const)(
  'an unrelated candidate that %s cannot veto a finalized matching replacement',
  async (failure) => {
    const f = fixture();
    f.request.withdrawal = {
      phase: 'submitted',
      mode: 'relayed',
      transactionHash: pendingHash,
      transactionHashes: [pendingHash, wHash],
    };
    const rpc = f.request.rpc;
    let held: AbortSignal | undefined;
    f.request.rpc = async (...args) => {
      if (
        args[0] === 'eth_getTransactionReceipt' &&
        args[1][0] === pendingHash
      ) {
        held = args[2];
        if (failure === 'rejects') {
          await new Promise((resolve) => setTimeout(resolve, 20));
          throw Error('Unavailable unrelated candidate');
        }
        return new Promise(() => undefined);
      }
      return rpc(...args);
    };
    const proof = await prepareSpentCompletion(f.request);
    expect(held?.aborted).toBe(true);
    await proof.revalidate();
    expect(
      f.rpc.mock.calls
        .filter(([method]) => method === 'eth_getTransactionReceipt')
        .every(([, params]) => params[0] === wHash)
    ).toBe(true);
  }
);

it('owner retirement during candidate exploration remains fatal even when a matching event is available', async () => {
  const f = fixture();
  f.request.withdrawal = {
    phase: 'submitted',
    mode: 'relayed',
    transactionHash: pendingHash,
    transactionHashes: [pendingHash, wHash],
  };
  const rpc = f.request.rpc;
  f.request.rpc = async (...args) => {
    if (args[0] === 'eth_getTransactionReceipt' && args[1][0] === pendingHash) {
      f.invalidate();
      throw Error('retired');
    }
    return rpc(...args);
  };
  await expect(prepareSpentCompletion(f.request)).rejects.toThrow(
    'privacy_spent_proof_unavailable'
  );
});
