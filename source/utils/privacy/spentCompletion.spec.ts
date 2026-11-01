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
  dHash = '0x' + '77'.repeat(32);
const wBlock = '0x' + '88'.repeat(32),
  dBlock = '0x' + '99'.repeat(32),
  finalHash = '0x' + 'aa'.repeat(32);

function fixture() {
  const encoded = abi.encodeEventLog(abi.getEvent('Withdrawal')!, [
    recipient,
    nullifier,
    relayer,
    1n,
  ]);
  const blocks: Record<string, any> = {
    finalized: { number: '0x80', hash: finalHash },
    '0x80': { number: '0x80', hash: finalHash },
    '0x70': { number: '0x70', hash: wBlock },
    '0x60': { number: '0x60', hash: dBlock },
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
    [dHash]: {
      transactionHash: dHash,
      blockHash: dBlock,
      blockNumber: '0x60',
      status: '0x1',
      logs: [],
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
    [dHash]: {
      hash: dHash,
      from: account,
      nonce: '0x1',
      blockHash: dBlock,
      blockNumber: '0x60',
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
    deposit: {
      phase: 'submitted',
      transactionHash: dHash,
      from: account,
      nonce: '1',
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

it('checks exact finalized event and both settled journal nonces without sending the nullifier', async () => {
  const f = fixture();
  const lease = await prepareSpentCompletion(f.request);
  await lease.revalidate();
  expect(
    f.rpc.mock.calls.some(([, params]) =>
      JSON.stringify(params).includes(nullifier)
    )
  ).toBe(false);
  expect(new Set(f.rpc.mock.calls.map(([method]) => method))).toEqual(
    new Set([
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_getTransactionReceipt',
      'eth_getTransactionByHash',
    ])
  );
});

it.each([
  'wrong-pool',
  'wrong-nullifier',
  'failed-withdrawal',
  'unfinalized',
  'changed-canonical',
  'wrong-withdrawal-nonce',
  'wrong-deposit-nonce',
  'unknown-deposit',
  'duplicate-event',
])('fails closed for %s', async (kind) => {
  const f = fixture();
  if (kind === 'wrong-pool') f.receipts[wHash].logs[0].address = recipient;
  if (kind === 'wrong-nullifier')
    f.request.nullifierHash = '0x' + 'ab'.repeat(32);
  if (kind === 'failed-withdrawal') f.receipts[wHash].status = '0x0';
  if (kind === 'unfinalized') f.blocks.finalized.number = '0x60';
  if (kind === 'changed-canonical') f.blocks['0x70'].hash = dBlock;
  if (kind === 'wrong-withdrawal-nonce') f.txs[wHash].nonce = '0x3';
  if (kind === 'wrong-deposit-nonce') f.txs[dHash].nonce = '0x2';
  if (kind === 'unknown-deposit') (f.request.deposit as any).phase = 'unknown';
  if (kind === 'duplicate-event')
    f.receipts[wHash].logs.push(f.receipts[wHash].logs[0]);
  await expect(prepareSpentCompletion(f.request)).rejects.toThrow();
});

it('allows a finalized reverted deposit receipt because its matching nonce was consumed', async () => {
  const f = fixture();
  f.receipts[dHash].status = '0x0';
  await expect(prepareSpentCompletion(f.request)).resolves.toBeDefined();
});

it('refuses a reorg or changed session between preparation and commit revalidation', async () => {
  const f = fixture();
  const lease = await prepareSpentCompletion(f.request);
  f.blocks['0x70'].hash = dBlock;
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
  delete f.request.deposit;
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
