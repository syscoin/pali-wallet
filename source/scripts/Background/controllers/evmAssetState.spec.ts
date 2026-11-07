import { Interface } from 'ethers/abi';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import { encodeErc20Transfer } from '../../../shared/erc20';
import {
  encodeNftTransferData,
  snapshotNftTransferIntent,
} from '../../../shared/nftTransfer';
import {
  EVM_ASSET_REVIEW_MESSAGE,
  EVM_ASSET_REVIEW_REQUIRED,
} from '../../../utils/evmTransactionContext';

import {
  assertWorkerAssetBasis,
  claimWorkerAssetBasis,
  inspectWorkerAssetState,
  signedWorkerAsset,
} from './evmAssetState';

const sender = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const hash = '0x' + 'ab'.repeat(32);
const block = { number: '0x12', hash };
const asWord = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`;
const nftAbi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
function fixture(type: 'ERC20' | 'ERC721' | 'ERC1155') {
  const basic = {
    tokenAddress: token,
    receiver: recipient,
    networkUrl: 'https://test.invalid',
    gasLimit: '100000',
    isLegacy: false as const,
    maxFeePerGas: '2',
    maxPriorityFeePerGas: '1',
  };
  const asset =
    type === 'ERC20'
      ? ({ type, transaction: { ...basic, tokenAmountUnits: '60' } } as const)
      : type === 'ERC721'
      ? ({ type, transaction: { ...basic, tokenId: '7' } } as const)
      : ({
          type,
          transaction: { ...basic, tokenId: '7', tokenAmount: '60' },
        } as const);
  let owner = type === 'ERC721' ? asWord(BigInt(sender)) : asWord(BigInt(100));
  let simulation = type === 'ERC20' ? asWord(BigInt(1)) : '0x';
  let latestNonce = '0x4',
    sampledNonce = '0x4';
  let finalHash = hash;
  const reads: Array<[string, unknown[]]> = [];
  const provider = {
    signal: new AbortController().signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(async (method: string, args: unknown[]) => {
      reads.push([method, args]);
      if (method === 'eth_getBlockByNumber')
        return { ...block, hash: args[0] === 'latest' ? hash : finalHash };
      if (method === 'eth_getCode') return '0x01';
      if (method === 'eth_getTransactionCount')
        return args[1] === 'latest' ? latestNonce : sampledNonce;
      if (method === 'eth_call') {
        const call = args[0] as { data: string; from?: string };
        if (call.from) return simulation;
        if (type !== 'ERC20') {
          const decoded = nftAbi.parseTransaction({ data: call.data })!;
          if (decoded.name === 'ownerOf' && decoded.args[0] !== BigInt(7))
            throw { code: 3, message: 'execution reverted', data: '0x' };
          if (decoded.name === 'balanceOf')
            return decoded.args[1] === BigInt(7) ? owner : asWord(BigInt(0));
          if (decoded.name === 'balanceOfBatch')
            return nftAbi.encodeFunctionResult('balanceOfBatch', [
              [BigInt(owner)],
            ]);
        }
        return owner;
      }
      throw Error(`Unexpected ${method}`);
    }),
  };
  const check = jest.fn();
  const inspect = async () => {
    const basis = await inspectWorkerAssetState(
      provider as any,
      asset,
      1,
      sender,
      check
    );
    claimWorkerAssetBasis(
      provider as any,
      sender,
      '1',
      'https://test.invalid',
      check,
      basis
    );
    await assertWorkerAssetBasis(
      provider as any,
      sender,
      basis,
      check,
      basis.nonce,
      'automatic'
    );
    return basis;
  };
  return {
    asset,
    provider,
    check,
    inspect,
    reads,
    setOwner(v: string) {
      owner = v;
    },
    setSimulation(v: string) {
      simulation = v;
    },
    setLatest(v: string) {
      latestNonce = v;
    },
    setSampled(v: string) {
      sampledNonce = v;
    },
    setFinalHash(v: string) {
      finalHash = v;
    },
  };
}

describe.each(['ERC20', 'ERC721', 'ERC1155'] as const)('%s', (type) => {
  test('owns and simulates the exact transfer at one canonical sampled block', async () => {
    const f = fixture(type);
    const basis = await f.inspect();
    expect(basis).toMatchObject({
      number: '0x12',
      hash,
      nonce: 4,
      from: sender,
    });
    expect(
      f.reads
        .filter(([method]) => method === 'eth_call')
        .every(([, args]) => args[1] === '0x12')
    ).toBe(true);
    expect(f.provider.verifyConfiguredChainId).toHaveBeenCalledTimes(2);
    expect(f.provider.verifyConfiguredChainId).toHaveBeenNthCalledWith(1, true);
    expect(f.provider.verifyConfiguredChainId).toHaveBeenNthCalledWith(2, true);
    const call = f.reads.find(
      ([method, args]) =>
        method === 'eth_call' && Boolean((args[0] as { from?: string }).from)
    )![1][0];
    expect(call).toMatchObject({
      from: sender,
      to: token,
      gas: '0x186a0',
      nonce: '0x4',
      type: '0x2',
      maxFeePerGas: '0x2',
      maxPriorityFeePerGas: '0x1',
    });
  });
  test('rejects insufficient ownership and never permits a stale value', async () => {
    const f = fixture(type);
    f.setOwner(asWord(BigInt(0)));
    await expect(f.inspect()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
  });
  test('rejects mined same-sender predecessor or sampled-block reorg', async () => {
    const a = fixture(type);
    a.setLatest('0x5');
    await expect(a.inspect()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
    const b = fixture(type);
    b.setFinalHash('0x' + 'cd'.repeat(32));
    await expect(b.inspect()).rejects.toMatchObject({
      transactionNotBroadcast: true,
    });
  });
  test('rechecks basis after planner and refuses a later sender nonce', async () => {
    const f = fixture(type);
    const basis = await inspectWorkerAssetState(
      f.provider as any,
      f.asset,
      1,
      sender,
      f.check
    );
    expect(
      claimWorkerAssetBasis(
        f.provider as any,
        sender,
        '1',
        'https://test.invalid',
        f.check,
        basis
      )
    ).toBe(basis);
    f.setLatest('0x5');
    const before = f.reads.length;
    await expect(
      assertWorkerAssetBasis(
        f.provider as any,
        sender,
        basis,
        f.check,
        basis.nonce,
        'automatic'
      )
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(f.reads.slice(before)).toEqual(
      expect.arrayContaining([
        ['eth_getBlockByNumber', [block.number, false]],
        ['eth_getTransactionCount', [sender, 'latest']],
      ])
    );
    expect(f.provider.verifyConfiguredChainId).toHaveBeenCalledTimes(1);
  });
});

test.each(['ERC20', 'ERC721', 'ERC1155'] as const)(
  'simulates the exact queued %s transfer against pending state',
  async (type) => {
    const f = fixture(type);
    const basis = await inspectWorkerAssetState(
      f.provider as any,
      f.asset,
      1,
      sender,
      f.check
    );
    claimWorkerAssetBasis(
      f.provider as any,
      sender,
      '1',
      'https://test.invalid',
      f.check,
      basis
    );
    await assertWorkerAssetBasis(
      f.provider as any,
      sender,
      basis,
      f.check,
      5,
      'automatic'
    );
    expect(f.provider.send).toHaveBeenCalledWith('eth_call', [
      expect.objectContaining({ from: sender, nonce: '0x5' }),
      'pending',
    ]);
  }
);

test('requires a claimed worker basis before final verification', async () => {
  const f = fixture('ERC20');
  const basis = await inspectWorkerAssetState(
    f.provider as any,
    f.asset,
    1,
    sender,
    f.check
  );
  f.provider.send.mockClear();
  await expect(
    assertWorkerAssetBasis(
      f.provider as any,
      sender,
      basis,
      f.check,
      basis.nonce,
      'automatic'
    )
  ).rejects.toMatchObject({
    code: EVM_ASSET_REVIEW_REQUIRED,
    transactionNotBroadcast: true,
  });
  expect(f.provider.send).not.toHaveBeenCalled();
  claimWorkerAssetBasis(
    f.provider as any,
    sender,
    '1',
    'https://test.invalid',
    f.check,
    basis
  );
  await expect(
    assertWorkerAssetBasis(
      f.provider as any,
      sender,
      basis,
      f.check,
      basis.nonce,
      'automatic'
    )
  ).resolves.toBeUndefined();
});

test('ERC20 false transfer return does not count as success', async () => {
  const f = fixture('ERC20');
  f.setSimulation(asWord(BigInt(0)));
  await expect(f.inspect()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
});
test('ERC20 supports empty success return', async () => {
  const f = fixture('ERC20');
  f.setSimulation('0x');
  await expect(f.inspect()).resolves.toMatchObject({ nonce: 4 });
});
test('NFT transfer must return empty bytes', async () => {
  const f = fixture('ERC721');
  f.setSimulation(asWord(BigInt(1)));
  await expect(f.inspect()).rejects.toMatchObject({
    transactionNotBroadcast: true,
  });
});

test('overlaps pinned code and sender nonce reads before simulating', async () => {
  const f = fixture('ERC20');
  let release!: () => void;
  let entered!: () => void;
  const codeHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nonceStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const base = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, args) => {
    if (method === 'eth_getCode') await codeHeld;
    if (method === 'eth_getTransactionCount' && args[1] === block.number)
      entered();
    return base(method, args);
  });
  const result = f.inspect();
  await nonceStarted;
  expect(f.reads.some(([method]) => method === 'eth_call')).toBe(false);
  release();
  await expect(result).resolves.toMatchObject({ nonce: 4 });
});

test('session revocation while a read is in flight aborts before an approval', async () => {
  const f = fixture('ERC20');
  let revoked = false;
  const base = f.provider.send.getMockImplementation()!;
  f.provider.send.mockImplementation(async (method, args) => {
    const value = await base(method, args);
    if (method === 'eth_getCode') revoked = true;
    return value;
  });
  f.check.mockImplementation(() => {
    if (revoked) throw new Error('revoked');
  });
  await expect(f.inspect()).rejects.toThrow('revoked');
  expect(f.reads.some(([method]) => method === 'eth_call')).toBe(false);
});

test.each(['initial-chain', 'asset-call', 'final-chain'] as const)(
  'sanitizes an %s RPC failure and never exposes the server body',
  async (where) => {
    const f = fixture('ERC20');
    const secret = 'synthetic-private-rpc-body';
    const failure = Object.assign(new Error(secret), {
      body: secret,
      data: secret,
      reason: secret,
    });
    const base = f.provider.send.getMockImplementation()!;
    if (where === 'asset-call')
      f.provider.send.mockImplementation(async (method, args) => {
        if (method === 'eth_call') throw failure;
        return base(method, args);
      });
    else {
      let checks = 0;
      f.provider.verifyConfiguredChainId.mockImplementation(async () => {
        checks++;
        if (where === 'initial-chain' || checks === 2) throw failure;
      });
    }
    try {
      await f.inspect();
      throw new Error('expected refusal');
    } catch (error) {
      expect(error).toMatchObject({
        message: EVM_ASSET_REVIEW_MESSAGE,
        code: EVM_ASSET_REVIEW_REQUIRED,
        transactionNotBroadcast: true,
      });
      expect(
        JSON.stringify(Object.getOwnPropertyDescriptors(error))
      ).not.toContain(secret);
    }
  }
);

async function signedFixture(operation: 'erc20' | 'erc721' | 'erc1155') {
  const wallet = new Wallet('0x' + '01'.repeat(32));
  const intent = snapshotNftTransferIntent({
    kind: 'nft-transfer',
    chainId: '1',
    from: wallet.address,
    contractAddress: token,
    recipient,
    tokenStandard: operation === 'erc721' ? 'ERC-721' : 'ERC-1155',
    tokenId: '7',
    amountUnits: operation === 'erc721' ? '1' : '60',
  });
  const data =
    operation === 'erc20'
      ? encodeErc20Transfer(recipient, '60')
      : encodeNftTransferData(intent);
  const rawTransaction = await wallet.signTransaction({
    type: 2,
    chainId: 1,
    nonce: 4,
    to: token,
    value: 0,
    data,
    gasLimit: 100000,
    maxFeePerGas: 2,
    maxPriorityFeePerGas: 1,
  });
  const tx = Transaction.from(rawTransaction);
  const entry = {
    chainId: '1',
    from: wallet.address,
    hash: tx.hash!,
    nonce: 4,
    operation,
    rawTransaction,
    networkUrl: 'https://test.invalid',
  };
  return { entry, tx };
}

test.each(['erc20', 'erc721', 'erc1155'] as const)(
  'derives %s only from matching authenticated signed bytes',
  async (operation) => {
    const { entry, tx } = await signedFixture(operation);
    const asset = signedWorkerAsset(entry, tx);
    expect(asset.type.toLowerCase()).toBe(operation);
    for (const changed of [
      { ...entry, chainId: '2' },
      { ...entry, from: sender },
      { ...entry, hash: '0x' + 'ab'.repeat(32) },
      { ...entry, nonce: 5 },
      { ...entry, operation: 'send' },
      { ...entry, rawTransaction: entry.rawTransaction + '00' },
    ])
      expect(() => signedWorkerAsset(changed, tx)).toThrow();
  }
);

test('rejects a signed token envelope that also sends native value', async () => {
  const wallet = new Wallet('0x' + '01'.repeat(32));
  const rawTransaction = await wallet.signTransaction({
    type: 2,
    chainId: 1,
    nonce: 4,
    to: token,
    value: 1,
    data: encodeErc20Transfer(recipient, '60'),
    gasLimit: 100000,
    maxFeePerGas: 2,
    maxPriorityFeePerGas: 1,
  });
  const tx = Transaction.from(rawTransaction);
  expect(() =>
    signedWorkerAsset(
      {
        chainId: '1',
        from: wallet.address,
        hash: tx.hash!,
        nonce: 4,
        operation: 'erc20',
        rawTransaction,
        networkUrl: 'https://test.invalid',
      },
      tx
    )
  ).toThrow();
});

test('legacy simulation keeps the exact gas and gas price without dynamic fee fields', async () => {
  const f = fixture('ERC20');
  const asset = {
    ...f.asset,
    transaction: {
      ...f.asset.transaction,
      isLegacy: true as const,
      gasPrice: '7',
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    },
  } as any;
  const basis = await inspectWorkerAssetState(
    f.provider as any,
    asset,
    1,
    sender,
    f.check
  );
  claimWorkerAssetBasis(
    f.provider as any,
    sender,
    '1',
    'https://test.invalid',
    f.check,
    basis
  );
  await assertWorkerAssetBasis(
    f.provider as any,
    sender,
    basis,
    f.check,
    basis.nonce,
    'automatic'
  );
  const call = f.reads.find(
    ([method, args]) =>
      method === 'eth_call' && Boolean((args[0] as { from?: string }).from)
  )![1][0];
  expect(call).toMatchObject({ gas: '0x186a0', gasPrice: '0x7', type: '0x0' });
  expect(call).not.toHaveProperty('maxFeePerGas');
});

test('a chain change at the final forced check invalidates the asset basis', async () => {
  const f = fixture('ERC20');
  f.provider.verifyConfiguredChainId
    .mockImplementationOnce(async () => undefined)
    .mockImplementationOnce(async () => {
      throw new Error('chain changed');
    });
  await expect(f.inspect()).rejects.toMatchObject({
    transactionNotBroadcast: true,
    message: EVM_ASSET_REVIEW_MESSAGE,
  });
  expect(f.provider.verifyConfiguredChainId).toHaveBeenNthCalledWith(2, true);
});
