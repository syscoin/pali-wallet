import { AbiCoder, Interface, keccak256 } from 'ethers';

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
