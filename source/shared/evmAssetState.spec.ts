/** @jest-environment node */
import { webcrypto } from 'crypto';
import { Interface } from 'ethers/abi';

import { encodeErc20Transfer } from './erc20';
import {
  assertEvmAssetStateCanonical,
  readEvmAssetState,
  simulateEvmAssetTransfer,
  snapshotEvmTransferAsset,
} from './evmAssetState';
import type {
  EvmAssetEnvelope,
  EvmAssetRead,
  EvmTransferAsset,
} from './evmAssetState';

const from = '0x' + '11'.repeat(20),
  to = '0x' + '22'.repeat(20);
const contractAddress = '0x' + '33'.repeat(20),
  hash = '0x' + '44'.repeat(32);
const asset: EvmTransferAsset = {
  standard: 'ERC20',
  contractAddress,
  amountUnits: '60',
};
const word = (n: bigint | number) =>
  `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const abi = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function ownerOf(uint256) view returns (address)',
]);
const envelope: EvmAssetEnvelope = {
  from,
  to: contractAddress,
  chainId: '57',
  value: '0',
  data: encodeErc20Transfer(to, '60'),
  gasLimit: '50000',
  nonce: '1',
  type: 2,
  accessList: [],
  maxFeePerGas: '3',
  maxPriorityFeePerGas: '1',
};
function fixture() {
  const read = jest.fn() as jest.MockedFunction<EvmAssetRead>;
  read.mockImplementation(async (method, params) => {
    if (method === 'eth_getBlockByNumber') return { number: '0x9', hash };
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getCode') return '0x6000';
    const call = params[0] as { data: string; from?: string };
    return call.from ? word(1) : word(100);
  });
  return read;
}
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
it('pins code, balance and sender nonce to one block and checks that basis after asynchronous reads', async () => {
  const read = fixture();
  const state = await readEvmAssetState(read, from, asset);
  expect(state).toEqual({
    asset,
    from,
    number: '0x9',
    hash,
    nonce: 0,
    balanceUnits: BigInt(100),
  });
  expect(read).toHaveBeenCalledWith('eth_getCode', [contractAddress, '0x9']);
  expect(read).toHaveBeenCalledWith('eth_getTransactionCount', [from, '0x9']);
  await assertEvmAssetStateCanonical(read, state);
  read.mockResolvedValueOnce({ number: '0x9', hash: '0x' + '55'.repeat(32) });
  await expect(assertEvmAssetStateCanonical(read, state)).rejects.toMatchObject(
    { code: 'REVIEW_REQUIRED' }
  );
});
it.each(['automatic', 'manual'] as const)(
  'simulates the exact envelope with %s nonce policy',
  async (mode) => {
    const read = fixture();
    const state = await readEvmAssetState(read, from, asset);
    await simulateEvmAssetTransfer(read, state, envelope, mode);
    expect(read).toHaveBeenLastCalledWith('eth_call', [
      {
        from,
        to: contractAddress,
        value: '0x0',
        data: envelope.data,
        gas: '0xc350',
        nonce: '0x1',
        type: '0x2',
        maxFeePerGas: '0x3',
        maxPriorityFeePerGas: '0x1',
      },
      mode === 'automatic' ? 'pending' : '0x9',
    ]);
  }
);
it('simulates the unqueued nonce at the pinned canonical block', async () => {
  const read = fixture();
  const state = await readEvmAssetState(read, from, asset);
  await simulateEvmAssetTransfer(
    read,
    state,
    { ...envelope, nonce: '0' },
    'automatic'
  );
  expect(read.mock.calls.at(-1)?.[1][1]).toBe('0x9');
});
it('rejects false-returning or failed simulations, including unknown predecessor effects', async () => {
  const read = fixture();
  const state = await readEvmAssetState(read, from, asset);
  read.mockResolvedValueOnce(word(0));
  await expect(
    simulateEvmAssetTransfer(read, state, envelope, 'automatic')
  ).rejects.toMatchObject({ code: 'TRANSFER_REJECTED' });
  read.mockRejectedValueOnce({
    code: 3,
    message: 'execution reverted',
    data: '0x',
  });
  await expect(
    simulateEvmAssetTransfer(read, state, envelope, 'automatic')
  ).rejects.toMatchObject({ code: 'TRANSFER_REJECTED' });
});
it('rejects an amount, sender, or contract outside the bound asset observation', async () => {
  const read = fixture();
  const state = await readEvmAssetState(read, from, asset);
  for (const altered of [
    { ...envelope, data: encodeErc20Transfer(to, '61') },
    { ...envelope, from: to },
    { ...envelope, to },
  ])
    await expect(
      simulateEvmAssetTransfer(read, state, altered, 'automatic')
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
it('rejects malformed balance and unavailable deployed code', async () => {
  const read = fixture();
  const ordinary = read.getMockImplementation()!;
  read.mockImplementation(async (method, params) =>
    method === 'eth_getCode' ? '0x' : ordinary(method, params)
  );
  await expect(readEvmAssetState(read, from, asset)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  read.mockImplementation(async (method, params) =>
    method === 'eth_call' ? '0x01' : ordinary(method, params)
  );
  await expect(readEvmAssetState(read, from, asset)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
it('retains the shared ERC1155 negative probe and selected batch read', async () => {
  const read = fixture();
  const ordinary = read.getMockImplementation()!;
  read.mockImplementation(async (method, params) => {
    if (method !== 'eth_call') return ordinary(method, params);
    const call = params[0] as { data: string };
    const parsed = abi.parseTransaction({ data: call.data })!;
    if (parsed.name === 'balanceOf') return word(0);
    return abi.encodeFunctionResult('balanceOfBatch', [[7]]);
  });
  const state = await readEvmAssetState(read, from, {
    standard: 'ERC1155',
    contractAddress,
    amountUnits: '2',
    tokenId: '123',
  });
  expect(state.balanceUnits).toBe(BigInt(7));
  expect(
    read.mock.calls.filter(([method]) => method === 'eth_call')
  ).toHaveLength(2);
});
it('rejects a fake NFT contract which claims every probed ID is owned', async () => {
  const read = fixture();
  const ordinary = read.getMockImplementation()!;
  read.mockImplementation(async (method, params) =>
    method === 'eth_call'
      ? abi.encodeFunctionResult('ownerOf', [from])
      : ordinary(method, params)
  );
  await expect(
    readEvmAssetState(read, from, {
      standard: 'ERC721',
      contractAddress,
      amountUnits: '1',
      tokenId: '123',
    })
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it('rejects accessor-controlled asset input without executing the getter', () => {
  const getter = jest.fn(() => '60');
  const input = Object.defineProperty({ ...asset }, 'amountUnits', {
    enumerable: true,
    get: getter,
  });
  expect(() => snapshotEvmTransferAsset(input)).toThrow('INVALID_INPUT');
  expect(getter).not.toHaveBeenCalled();
});
it('preserves cancellation and unavailable-provider errors from simulation', async () => {
  const read = fixture();
  const state = await readEvmAssetState(read, from, asset);
  for (const error of [
    new Error('cancelled'),
    { code: -32601, message: 'Method not found' },
  ]) {
    read.mockRejectedValueOnce(error);
    await expect(
      simulateEvmAssetTransfer(read, state, envelope, 'automatic')
    ).rejects.toBe(error);
  }
});
