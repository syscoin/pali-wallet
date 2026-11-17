import { AbiCoder, Interface, keccak256, Wallet, Transaction } from 'ethers';

import { prepareWithdrawalRecovery } from './withdrawalRecovery';

const POOL = '0x' + '11'.repeat(20),
  FROM = '0x' + '22'.repeat(20),
  RECIPIENT = '0x' + '33'.repeat(20);
const HASH = '0x' + '44'.repeat(32),
  BLOCK = '0x' + '55'.repeat(32),
  ROOT = '0x' + '06'.repeat(32),
  NULLIFIER = '0x' + '77'.repeat(32);
const ZERO = '0x' + '00'.repeat(20),
  PROOF = '0x' + '88'.repeat(256);
const ABI = new Interface([
  'function withdraw(bytes proof,bytes32 root,bytes32 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifierHash) view returns (bool)',
]);
function fixture() {
  const values = [PROOF, ROOT, NULLIFIER, RECIPIENT, ZERO, 0, 0];
  const tx: any = {
    hash: HASH,
    from: FROM,
    to: POOL,
    nonce: '0x1',
    value: '0x0',
    blockHash: BLOCK,
    blockNumber: '0x10',
    chainId: '0x1',
    input: ABI.encodeFunctionData('withdraw', values),
  };
  const receipt: any = {
    transactionHash: HASH,
    blockHash: BLOCK,
    blockNumber: '0x10',
    status: '0x0',
  };
  const block: any = { number: '0x10', hash: BLOCK };
  let known = false,
    spent = false;
  const current = jest.fn();
  const rpc = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return { ...block };
    if (method === 'eth_getTransactionReceipt') return { ...receipt };
    if (method === 'eth_getTransactionByHash') return { ...tx };
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      return ABI.encodeFunctionResult(
        call.data.startsWith(ABI.getFunction('isKnownRoot')!.selector)
          ? 'isKnownRoot'
          : 'isSpent',
        [
          call.data.startsWith(ABI.getFunction('isKnownRoot')!.selector)
            ? known
            : spent,
        ]
      );
    }
    throw new Error('unexpected');
  });
  const request = {
    poolAddress: POOL,
    nullifierHash: NULLIFIER,
    withdrawal: {
      mode: 'direct' as const,
      phase: 'submitted' as const,
      transactionHash: HASH,
      from: FROM,
      nonce: '1',
      intentId: '00000000-0000-4000-8000-000000000001',
      createdAt: 1,
      attemptHash: HASH,
      inputHash: keccak256(
        AbiCoder.defaultAbiCoder().encode(
          Array(6).fill('uint256'),
          values.slice(1).map((v) => BigInt(v).toString())
        )
      ),
      proofHash: keccak256(PROOF),
    },
    rpc,
    assertCurrent: current,
  };
  return {
    request,
    tx,
    receipt,
    block,
    rpc,
    current,
    setKnown: (value: boolean) => (known = value),
    setSpent: (value: boolean) => (spent = value),
  };
}

it('binds the original reverted transaction and repeats proof against the same finalized anchor', async () => {
  const f = fixture();
  const result = await prepareWithdrawalRecovery(f.request);
  expect(result.receipt).toEqual({
    root: ROOT,
    blockNumber: '16',
    blockHash: BLOCK,
  });
  await result.revalidate();
  expect(
    f.rpc.mock.calls.filter(([method]) => method === 'eth_call')
  ).toHaveLength(4);
  expect(
    f.rpc.mock.calls
      .filter(([method]) => method === 'eth_call')
      .every(([, params]) => params[1] === '0x10')
  ).toBe(true);
  expect(JSON.stringify(f.rpc.mock.calls)).not.toContain(PROOF);
});

it.each([
  'known',
  'spent',
  'successful',
  'unfinalized',
  'wrong-chain',
  'wrong-sender',
  'wrong-nonce',
  'wrong-pool',
  'value',
  'other-proof',
  'other-input',
  'trailing-data',
  'noncanonical-block',
  'noncanonical-calldata',
])('rejects %s without granting recovery', async (mode) => {
  const f = fixture();
  if (mode === 'known') f.setKnown(true);
  if (mode === 'spent') f.setSpent(true);
  if (mode === 'successful') f.receipt.status = '0x1';
  if (mode === 'unfinalized') f.receipt.blockNumber = '0x11';
  if (mode === 'wrong-chain') f.tx.chainId = '0x2';
  if (mode === 'wrong-sender') f.tx.from = RECIPIENT;
  if (mode === 'wrong-nonce') f.tx.nonce = '0x2';
  if (mode === 'wrong-pool') f.tx.to = RECIPIENT;
  if (mode === 'value') f.tx.value = '0x1';
  if (mode === 'other-proof') f.request.withdrawal.proofHash = BLOCK;
  if (mode === 'other-input') f.request.withdrawal.inputHash = BLOCK;
  if (mode === 'trailing-data') f.tx.input += '00';
  if (mode === 'noncanonical-block') f.block.number = '0x010';
  if (mode === 'noncanonical-calldata')
    f.tx.input =
      f.tx.input.slice(0, 10) + '0'.repeat(63) + 'e' + f.tx.input.slice(74);
  await expect(prepareWithdrawalRecovery(f.request)).rejects.toThrow(
    'privacy_withdrawal_recovery_unavailable'
  );
});

it('rejects a changed anchor, changed proof status, and revoked session during prewrite revalidation', async () => {
  for (const change of ['anchor', 'known', 'session']) {
    const f = fixture();
    const proof = await prepareWithdrawalRecovery(f.request);
    if (change === 'anchor') f.block.hash = HASH;
    if (change === 'known') f.setKnown(true);
    if (change === 'session')
      f.current.mockImplementation(() => {
        throw new Error('changed');
      });
    await expect(proof.revalidate()).rejects.toThrow(
      'privacy_withdrawal_recovery_unavailable'
    );
  }
});

it('refuses unknown, relayed, and already-recovered attempts without an RPC', async () => {
  for (const patch of [
    { phase: 'unknown' },
    { mode: 'relayed' },
    {
      recovery: {
        root: ROOT,
        blockNumber: '16',
        blockHash: BLOCK,
        recoveredAt: 2,
      },
    },
  ]) {
    const f = fixture();
    Object.assign(f.request.withdrawal, patch);
    await expect(prepareWithdrawalRecovery(f.request)).rejects.toThrow(
      'privacy_withdrawal_recovery_unavailable'
    );
    expect(f.rpc).not.toHaveBeenCalled();
  }
});

async function displacedFixture() {
  const f = fixture();
  const wallet = new Wallet('0x' + '01'.repeat(32)); // Public disposable test key.
  const raw = await wallet.signTransaction({
    type: 2,
    chainId: 1,
    nonce: 1,
    to: POOL,
    value: 0,
    data: f.tx.input,
    gasLimit: 300000,
    maxFeePerGas: 20,
    maxPriorityFeePerGas: 2,
  });
  const signed = Transaction.from(raw);
  Object.assign(f.request.withdrawal, {
    from: wallet.address.toLowerCase(),
    transactionHash: signed.hash!,
  });
  let consumedNonce = '0x2';
  const base = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (method: string, params: unknown[]) => {
    if (method === 'eth_getTransactionReceipt') return null;
    if (method === 'eth_getTransactionByHash')
      throw Error('The displaced original is no longer in the RPC mempool');
    if (method === 'eth_getTransactionCount') {
      expect(params).toEqual([wallet.address.toLowerCase(), '0x10']);
      return consumedNonce;
    }
    return base(method, params);
  });
  const readOriginalRawTransaction = jest.fn<Promise<string | null>, []>(
    async () => raw
  );
  return {
    ...f,
    raw,
    wallet,
    request: { ...f.request, readOriginalRawTransaction },
    setNonce: (value: string) => {
      consumedNonce = value;
    },
  };
}

it('recovers a displaced never-mined original only from its authenticated bytes and finalized consumed nonce', async () => {
  const f = await displacedFixture();
  const proof = await prepareWithdrawalRecovery(f.request);
  expect(proof.receipt).toEqual({
    root: ROOT,
    blockNumber: '16',
    blockHash: BLOCK,
  });
  await proof.revalidate();
  expect(f.request.readOriginalRawTransaction).toHaveBeenCalledTimes(1);
  expect(
    f.rpc.mock.calls.filter(([method]) => method === 'eth_getTransactionCount')
  ).toHaveLength(2);
  expect(
    f.rpc.mock.calls.filter(([method]) => method === 'eth_getTransactionByHash')
  ).toHaveLength(0);
});

it.each([
  'live root',
  'spent',
  'unconsumed',
  'wrong hash',
  'wrong payer',
  'wrong nonce',
  'wrong pool',
  'wrong proof',
  'wrong input',
  'unsigned',
  'oversized',
  'raw unavailable',
] as const)('does not recover a displaced original with %s', async (mode) => {
  const f = await displacedFixture();
  if (mode === 'live root') f.setKnown(true);
  if (mode === 'spent') f.setSpent(true);
  if (mode === 'unconsumed') f.setNonce('0x1');
  if (mode === 'wrong hash') f.request.withdrawal.transactionHash = BLOCK;
  if (mode === 'wrong payer') f.request.withdrawal.from = RECIPIENT;
  if (mode === 'wrong nonce') f.request.withdrawal.nonce = '2';
  if (mode === 'wrong pool') f.request.poolAddress = RECIPIENT;
  if (mode === 'wrong proof') f.request.withdrawal.proofHash = BLOCK;
  if (mode === 'wrong input') f.request.withdrawal.inputHash = BLOCK;
  if (mode === 'unsigned')
    f.request.readOriginalRawTransaction.mockResolvedValue(
      Transaction.from(f.raw).unsignedSerialized
    );
  if (mode === 'oversized')
    f.request.readOriginalRawTransaction.mockResolvedValue(
      '0x' + '00'.repeat(8192)
    );
  if (mode === 'raw unavailable')
    f.request.readOriginalRawTransaction.mockResolvedValue(null);
  await expect(prepareWithdrawalRecovery(f.request)).rejects.toThrow(
    'privacy_withdrawal_recovery_unavailable'
  );
});

it.each(['anchor', 'root', 'spent', 'nonce', 'session'] as const)(
  'revalidates displaced-withdrawal %s immediately before the vault mutation',
  async (mode) => {
    const f = await displacedFixture(),
      proof = await prepareWithdrawalRecovery(f.request);
    if (mode === 'anchor') f.block.hash = HASH;
    if (mode === 'root') f.setKnown(true);
    if (mode === 'spent') f.setSpent(true);
    if (mode === 'nonce') f.setNonce('0x1');
    if (mode === 'session')
      f.current.mockImplementation(() => {
        throw Error('retired');
      });
    await expect(proof.revalidate()).rejects.toThrow(
      'privacy_withdrawal_recovery_unavailable'
    );
  }
);

it.each([undefined, {}, { status: '0x1' }])(
  'does not substitute nonce evidence for a malformed or successful original receipt (%j)',
  async (receipt) => {
    const f = await displacedFixture(),
      read = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation((method, params) =>
      method === 'eth_getTransactionReceipt'
        ? Promise.resolve(receipt)
        : read(method, params)
    );
    await expect(prepareWithdrawalRecovery(f.request)).rejects.toThrow(
      'privacy_withdrawal_recovery_unavailable'
    );
    expect(f.request.readOriginalRawTransaction).not.toHaveBeenCalled();
  }
);

it('rejects another-chain signed evidence even when its reported hash and payer match the journal', async () => {
  const f = await displacedFixture(),
    transaction = Transaction.from(f.raw);
  const raw = await f.wallet.signTransaction({
    type: 2,
    chainId: 2,
    nonce: transaction.nonce,
    to: transaction.to,
    data: transaction.data,
    value: 0,
    gasLimit: transaction.gasLimit,
    maxFeePerGas: 20,
    maxPriorityFeePerGas: 2,
  });
  f.request.withdrawal.transactionHash = Transaction.from(raw).hash!;
  f.request.readOriginalRawTransaction.mockResolvedValue(raw);
  await expect(prepareWithdrawalRecovery(f.request)).rejects.toThrow(
    'privacy_withdrawal_recovery_unavailable'
  );
});

it('bounds a held authenticated original read and ignores its late result', async () => {
  const f = await displacedFixture();
  jest.useFakeTimers();
  let enter!: () => void, release!: (raw: string) => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  f.request.readOriginalRawTransaction.mockImplementation(() => {
    enter();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  try {
    const prepared = prepareWithdrawalRecovery(f.request),
      rejected = expect(prepared).rejects.toThrow(
        'privacy_withdrawal_recovery_unavailable'
      );
    await entered;
    jest.advanceTimersByTime(15000);
    await rejected;
    release(f.raw);
    await Promise.resolve();
    expect(
      f.rpc.mock.calls.some(([method]) => method === 'eth_getTransactionCount')
    ).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
