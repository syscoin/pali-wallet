import type { PaliInfrastructureContract } from './deployment.ts';
import { PALI_CREATE2_DEPLOYER_ADDRESS } from './deploymentMetadata.ts';
import {
  buildInfrastructureDeploymentCommand,
  settleInfrastructurePending,
  validInfrastructureReceipt,
} from './infrastructureActions.ts';
import type { InfrastructureJournalEntry } from '../../wallet/infrastructureJournal.ts';

const address = `0x${'aa'.repeat(20)}`;
const hash = `0x${'bb'.repeat(32)}`;
const context = { url: 'https://rpc.example' };
const entry: InfrastructureJournalEntry = {
  contractId: 'factory',
  nonce: 3,
  payerAddress: address,
  rpcUrl: context.url,
  transactionHash: hash,
};
const contract: PaliInfrastructureContract = {
  address: `0x${'cc'.repeat(20)}`,
  deployCalldata: '0x01020304',
  displayName: 'Factory',
  id: 'factory',
  salt: `0x${'00'.repeat(32)}`,
};
const ports = () => ({
  readReceipt: jest.fn<Promise<unknown>, [string]>().mockResolvedValue(null),
  readLatestNonce: jest
    .fn<Promise<unknown>, [string]>()
    .mockResolvedValue('0x3'),
});
const missing = { missing: ['factory'] as const };

it.each([undefined, 'https://other-rpc.example'])(
  'keeps an attempt pending without any probe when its RPC is %s, even with present code',
  async (rpcUrl) => {
    const reads = ports();
    await expect(
      settleInfrastructurePending({
        context,
        entry: { ...entry, rpcUrl },
        status: { missing: [] },
        ports: reads,
      })
    ).resolves.toBe('pending');
    expect(reads.readReceipt).not.toHaveBeenCalled();
    expect(reads.readLatestNonce).not.toHaveBeenCalled();
  }
);

it('settles present code before consulting receipt or nonce evidence', async () => {
  const reads = ports();
  await expect(
    settleInfrastructurePending({
      context,
      entry,
      status: { missing: [] },
      ports: reads,
    })
  ).resolves.toBe('settled');
  expect(reads.readReceipt).not.toHaveBeenCalled();
  expect(reads.readLatestNonce).not.toHaveBeenCalled();
});

it.each([0, 1, '0x0', '0x1'])(
  'settles the exact mined transaction with status %s before consulting nonce',
  async (status) => {
    const reads = ports();
    reads.readReceipt.mockResolvedValue({
      status,
      transactionHash: hash.toUpperCase(),
    });
    await expect(
      settleInfrastructurePending({
        context,
        entry,
        status: missing,
        ports: reads,
      })
    ).resolves.toBe('settled');
    expect(reads.readReceipt).toHaveBeenCalledWith(hash);
    expect(reads.readLatestNonce).not.toHaveBeenCalled();
  }
);

it.each(['0x2', '0x3', '0x4'])(
  'uses latest nonce %s only after an absent receipt',
  async (nonce) => {
    const order: string[] = [];
    const reads = ports();
    reads.readReceipt.mockImplementation(async () => {
      order.push('receipt');
      return null;
    });
    reads.readLatestNonce.mockImplementation(async () => {
      order.push('nonce');
      return nonce;
    });
    await expect(
      settleInfrastructurePending({
        context,
        entry,
        status: missing,
        ports: reads,
      })
    ).resolves.toBe(nonce === '0x4' ? 'settled' : 'pending');
    expect(order).toEqual(['receipt', 'nonce']);
    expect(reads.readLatestNonce).toHaveBeenCalledWith(address);
  }
);

it('can reconcile a no-hash reservation only from its recorded payer nonce', async () => {
  const reads = ports();
  reads.readLatestNonce.mockResolvedValue('0x4');
  await expect(
    settleInfrastructurePending({
      context,
      entry: { ...entry, transactionHash: undefined },
      status: missing,
      ports: reads,
    })
  ).resolves.toBe('settled');
  expect(reads.readReceipt).not.toHaveBeenCalled();
  expect(reads.readLatestNonce).toHaveBeenCalledTimes(1);
  await expect(
    settleInfrastructurePending({
      context,
      entry: { ...entry, transactionHash: undefined, nonce: undefined },
      status: missing,
      ports: reads,
    })
  ).resolves.toBe('pending');
  expect(reads.readLatestNonce).toHaveBeenCalledTimes(1);
});

it.each([
  { status: 1, hash: `0x${'dd'.repeat(32)}` },
  { status: '0x01', hash },
  { status: true, hash },
  { status: 1, hash: 1 },
  { status: 1 },
])(
  'rejects malformed or mismatched receipt evidence without a nonce fallback %#',
  async (receipt) => {
    const reads = ports();
    reads.readReceipt.mockResolvedValue(receipt);
    await expect(
      settleInfrastructurePending({
        context,
        entry,
        status: missing,
        ports: reads,
      })
    ).rejects.toThrow('Invalid deployment receipt');
    expect(reads.readLatestNonce).not.toHaveBeenCalled();
  }
);

it.each([null, true, '0x00', '0X4', '0x20000000000000', '4'])(
  'rejects malformed latest nonce evidence %s',
  async (nonce) => {
    const reads = ports();
    reads.readLatestNonce.mockResolvedValue(nonce);
    await expect(
      settleInfrastructurePending({
        context,
        entry,
        status: missing,
        ports: reads,
      })
    ).rejects.toThrow('Invalid deployment nonce response');
  }
);

it.each(['receipt', 'nonce'] as const)(
  'propagates %s read/guard errors without treating them as settlement',
  async (phase) => {
    const reads = ports(),
      error = new Error('Owner retired');
    if (phase === 'receipt') reads.readReceipt.mockRejectedValue(error);
    else reads.readLatestNonce.mockRejectedValue(error);
    await expect(
      settleInfrastructurePending({
        context,
        entry,
        status: missing,
        ports: reads,
      })
    ).rejects.toBe(error);
    if (phase === 'receipt')
      expect(reads.readLatestNonce).not.toHaveBeenCalled();
  }
);

it('requires both host settlement ports even for a no-probe result', async () => {
  await expect(
    Reflect.apply(settleInfrastructurePending, undefined, [
      { context, entry, status: { missing: [] }, ports: {} },
    ])
  ).rejects.toThrow('settlement ports are required');
});

it('preserves receipt hash priority and transactionHash fallback', () => {
  expect(
    validInfrastructureReceipt(
      { status: 1, hash: '', transactionHash: hash },
      hash
    )
  ).toBe(true);
  expect(
    validInfrastructureReceipt(
      { status: 1, hash: 'other', transactionHash: hash },
      hash
    )
  ).toBe(false);
  expect(validInfrastructureReceipt(null, hash)).toBe(false);
});

it('builds a frozen canonical deployment command without adding fee or signing policy', () => {
  const selected = { ...contract };
  const command = buildInfrastructureDeploymentCommand({
    contract: selected,
    chainId: 1,
    from: address,
    nonce: 0,
  });
  expect(command).toEqual({
    chainId: 1,
    from: address,
    nonce: 0,
    data: contract.deployCalldata,
    to: PALI_CREATE2_DEPLOYER_ADDRESS,
    value: '0x0',
  });
  expect(Object.isFrozen(command)).toBe(true);
  selected.deployCalldata = '0x04030201';
  expect(command.data).toBe('0x01020304');
});

it('uses automatic nonce selection only for an explicit null', () => {
  const command = buildInfrastructureDeploymentCommand({
    contract,
    chainId: 1,
    from: address,
    nonce: null,
  });
  expect(command).not.toHaveProperty('nonce');
  expect(Object.isFrozen(command)).toBe(true);
  expect(() =>
    Reflect.apply(buildInfrastructureDeploymentCommand, undefined, [
      { contract, chainId: 1, from: address },
    ])
  ).toThrow('Invalid infrastructure deployment command');
});

it.each([
  { chainId: 0 },
  { chainId: 1.5 },
  { chainId: Number.MAX_SAFE_INTEGER + 1 },
  { from: 'invalid' },
  { nonce: -1 },
  { nonce: 1.5 },
  { nonce: Number.MAX_SAFE_INTEGER + 1 },
  { contract: { ...contract, deployCalldata: '0x0' } },
  { contract: { ...contract, deployCalldata: '0x' } },
])(
  'rejects malformed command scalars before any host reservation %#',
  (input) => {
    expect(() =>
      buildInfrastructureDeploymentCommand({
        contract,
        chainId: 1,
        from: address,
        nonce: 0,
        ...input,
      })
    ).toThrow('Invalid infrastructure deployment command');
  }
);

it.each([
  { ...contract, externallyDeployed: true },
  { ...contract, deployCalldata: undefined },
])(
  'preserves the external-deployment refusal for unavailable deployment bytecode %#',
  (selected) => {
    expect(() =>
      buildInfrastructureDeploymentCommand({
        contract: selected,
        chainId: 1,
        from: address,
        nonce: 0,
      })
    ).toThrow('must be deployed externally before');
  }
);
