import { Interface } from 'ethers/abi';

import { discoverNftTokens, MAX_ENUMERATED_NFTS } from './nftReads';
import type { NftReadRunner } from './nftReads';

const CONTRACT = '0x0000000000000000000000000000000000000721';
const OWNER = '0x0000000000000000000000000000000000000001';
const MAX_UINT256 = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
const abi = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
]);

function enumerableRunner(
  count: number | string,
  enumerable = true,
  failMethod?: string
) {
  const calls: string[] = [];
  const indices: number[] = [];
  const runner: NftReadRunner = {
    async call({ to, data }) {
      expect(to).toBe(CONTRACT);
      const { name, args } = abi.parseTransaction({ data: String(data) })!;
      calls.push(name);
      if (
        name === failMethod &&
        (name !== 'tokenOfOwnerByIndex' || args[1] === BigInt(3))
      )
        throw new Error('Synthetic NFT read failure');
      if (name === 'supportsInterface') {
        expect(args[0]).toBe('0x780e9d63');
        return abi.encodeFunctionResult(name, [enumerable]);
      }
      expect(args[0]).toBe(OWNER);
      if (name === 'balanceOf') return abi.encodeFunctionResult(name, [count]);
      expect(name).toBe('tokenOfOwnerByIndex');
      indices.push(Number(args[1]));
      return abi.encodeFunctionResult(name, [args[1]]);
    },
  };
  return { runner, calls, indices };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

it('keeps manual entry available for a non-enumerable ERC721 collection', async () => {
  const { runner, calls } = enumerableRunner(5, false);
  expect(await discoverNftTokens(CONTRACT, OWNER, 'ERC-721', runner)).toEqual({
    method: 'manual',
    tokens: [],
    requiresManualEntry: true,
    totalOwned: '5',
  });
  expect(calls).toEqual(['supportsInterface', 'balanceOf']);
});

it('does not query an owner index when an enumerable collection has no holdings', async () => {
  const { runner, calls } = enumerableRunner(0);
  expect(await discoverNftTokens(CONTRACT, OWNER, 'ERC-721', runner)).toEqual({
    method: 'enumeration',
    tokens: [],
    requiresManualEntry: true,
    totalOwned: '0',
  });
  expect(calls).toEqual(['supportsInterface', 'balanceOf']);
});

it.each([1, MAX_ENUMERATED_NFTS, 12, MAX_UINT256])(
  'preserves token ID zero and the exact capped indices for %s holdings',
  async (count) => {
    const { runner, indices } = enumerableRunner(count);
    const limit = Math.min(Number(count), MAX_ENUMERATED_NFTS);
    expect(await discoverNftTokens(CONTRACT, OWNER, 'ERC-721', runner)).toEqual(
      {
        method: 'enumeration',
        tokens: Array.from({ length: limit }, (_, index) => ({
          tokenId: String(index),
          balance: 1,
          verified: true,
        })),
        requiresManualEntry: true,
        hasMore: BigInt(count) > BigInt(MAX_ENUMERATED_NFTS),
        totalOwned: String(count),
      }
    );
    expect(indices).toEqual(Array.from({ length: limit }, (_, index) => index));
  }
);

it.each(['supportsInterface', 'balanceOf', 'tokenOfOwnerByIndex'])(
  'returns manual entry without partial IDs after %s fails',
  async (method) => {
    const { runner } = enumerableRunner(MAX_ENUMERATED_NFTS, true, method);
    expect(await discoverNftTokens(CONTRACT, OWNER, 'ERC-721', runner)).toEqual(
      {
        method: 'manual',
        tokens: [],
        requiresManualEntry: true,
        ...(method === 'balanceOf'
          ? {}
          : { totalOwned: String(MAX_ENUMERATED_NFTS) }),
      }
    );
  }
);

it('does not make enumeration calls for ERC1155', async () => {
  const call = jest.fn();
  expect(
    await discoverNftTokens(CONTRACT, OWNER, 'ERC-1155', { call })
  ).toEqual({ method: 'manual', tokens: [], requiresManualEntry: true });
  expect(call).not.toHaveBeenCalled();
});
