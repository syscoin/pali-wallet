import http from 'http';
import https from 'https';

import { Interface } from 'utils/ethersV6Compat';

import {
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from './nft-utils';

const CONTRACT = '0x0000000000000000000000000000000000000721';
const OWNER = '0x0000000000000000000000000000000000000001';
const OTHER = '0x0000000000000000000000000000000000000002';
const SENTINEL = '999999999999999999999999999999';
const MAX_UINT256 = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();

// These are raw ABI-call fixtures, not a mocked Contract or ownership helper.
// Unminted ERC721 IDs revert; unowned ERC1155 IDs return zero. Network I/O is
// denied independently so the fixture cannot reach a public RPC.
const abi721 = new Interface([
  'function ownerOf(uint256) view returns (address)',
]);
const abi1155 = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);

function runner721(owners: Map<string, string>, alwaysOwner = false) {
  const calls: string[] = [];
  return {
    calls,
    call: async (transaction: { data: string }) => {
      const decoded = abi721.parseTransaction(transaction)!;
      const tokenId = decoded.args[0].toString();
      calls.push(tokenId);
      const owner = alwaysOwner ? OWNER : owners.get(tokenId);
      if (!owner) throw new Error('ERC721: invalid token ID');
      return abi721.encodeFunctionResult('ownerOf', [owner]);
    },
  };
}

function runner1155(holdings: Map<string, bigint>, alwaysPositive = false) {
  const calls: string[] = [];
  const balance = (account: string, tokenId: string) =>
    alwaysPositive
      ? BigInt(1)
      : account.toLowerCase() === OWNER.toLowerCase()
      ? holdings.get(tokenId) ?? BigInt(0)
      : BigInt(0);
  return {
    calls,
    call: async (transaction: { data: string }) => {
      const decoded = abi1155.parseTransaction(transaction)!;
      if (decoded.name === 'balanceOf') {
        const tokenId = decoded.args[1].toString();
        calls.push(tokenId);
        return abi1155.encodeFunctionResult('balanceOf', [
          balance(decoded.args[0], tokenId),
        ]);
      }
      const ids = Array.from(decoded.args[1], (id: any) => id.toString());
      calls.push(...ids);
      return abi1155.encodeFunctionResult('balanceOfBatch', [
        ids.map((id, index) => balance(decoded.args[0][index], id)),
      ]);
    },
  };
}

const fillProbe = (bytes: Uint8Array, tokenId: string) => {
  const hex = BigInt(tokenId).toString(16).padStart(64, '0');
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

beforeEach(() => {
  jest.clearAllMocks();
  const denied = () => {
    throw new Error('Synthetic ownership proof must not access a network');
  };
  jest.spyOn(http, 'request').mockImplementation(denied);
  jest.spyOn(http, 'get').mockImplementation(denied);
  jest.spyOn(https, 'request').mockImplementation(denied);
  jest.spyOn(https, 'get').mockImplementation(denied);
  jest.spyOn(globalThis, 'fetch').mockImplementation(denied);
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
    array.fill(0);
    array[31] = 42;
    return array;
  });
});
afterEach(() => jest.restoreAllMocks());

it.each([false, true])(
  'verifies the same legitimate ERC721 ownership with sentinel minted=%s',
  async (minted) => {
    const owners = new Map([['7', OWNER]]);
    if (minted) owners.set(SENTINEL, OTHER);
    const provider = runner721(owners);
    const result = await verifyERC721OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7'],
      provider as any
    );
    expect(result).toEqual([{ tokenId: '7', balance: 1, verified: true }]);
    expect(provider.calls).toContain('7');
  }
);

it.each([false, true])(
  'verifies the same legitimate ERC1155 holding with sentinel owned=%s',
  async (owned) => {
    const holdings = new Map([['7', BigInt(42)]]);
    if (owned) holdings.set(SENTINEL, BigInt(1));
    const provider = runner1155(holdings);
    const result = await verifyERC1155OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7'],
      provider as any
    );
    expect(result).toEqual([
      { tokenId: '7', balance: 42, rawBalance: '42', verified: true },
    ]);
    expect(provider.calls).toContain('7');
  }
);

it.each(['0', MAX_UINT256])(
  'accepts valid uint256 boundary token ID %s',
  async (tokenId) => {
    expect(
      await verifyERC721OwnershipHelper(
        CONTRACT,
        OWNER,
        [tokenId],
        runner721(new Map([[tokenId, OWNER]])) as any
      )
    ).toEqual([{ tokenId, balance: 1, verified: true }]);
    expect(
      await verifyERC1155OwnershipHelper(
        CONTRACT,
        OWNER,
        [tokenId],
        runner1155(new Map([[tokenId, BigInt(3)]])) as any
      )
    ).toEqual([{ tokenId, balance: 3, rawBalance: '3', verified: true }]);
  }
);

it('does not report ERC721 ownership for another owner or an unminted token', async () => {
  expect(
    await verifyERC721OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7', '8'],
      runner721(new Map([['7', OTHER]])) as any
    )
  ).toEqual([
    { tokenId: '7', balance: 0, verified: true },
    { tokenId: '8', balance: 0, verified: true },
  ]);
});

it('does not report ERC1155 holdings for another owner or an unminted token', async () => {
  expect(
    await verifyERC1155OwnershipHelper(
      CONTRACT,
      OTHER,
      ['7', '8'],
      runner1155(new Map([['7', BigInt(3)]])) as any
    )
  ).toEqual([
    { tokenId: '7', balance: 0, rawBalance: '0', verified: true },
    { tokenId: '8', balance: 0, rawBalance: '0', verified: true },
  ]);
});

it('rejects an ERC721 contract that dishonestly returns the owner for every ID', async () => {
  expect(
    await verifyERC721OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7'],
      runner721(new Map(), true) as any
    )
  ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
});

it('rejects an ERC1155 contract that dishonestly returns a positive balance for every ID', async () => {
  expect(
    await verifyERC1155OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7'],
      runner1155(new Map(), true) as any
    )
  ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
});

it.each(['0', '0x07', MAX_UINT256])(
  'resamples a probe matching normalized requested token ID %s',
  async (tokenId) => {
    const canonicalId = BigInt(tokenId).toString();
    for (const standard of ['ERC-721', 'ERC-1155']) {
      const random = jest.mocked(crypto.getRandomValues);
      random.mockClear();
      random.mockImplementationOnce((bytes: any) => fillProbe(bytes, tokenId));
      const provider =
        standard === 'ERC-721'
          ? runner721(new Map([[canonicalId, OWNER]]))
          : runner1155(new Map([[canonicalId, BigInt(1)]]));
      const verify =
        standard === 'ERC-721'
          ? verifyERC721OwnershipHelper
          : verifyERC1155OwnershipHelper;
      const result = await verify(CONTRACT, OWNER, [tokenId], provider as any);
      expect(result[0]).toMatchObject({ tokenId, balance: 1, verified: true });
      expect(random).toHaveBeenCalledTimes(2);
      expect(provider.calls).toEqual(['42', canonicalId]);
    }
  }
);

it('does not attest ownership when independent probe entropy is unavailable', async () => {
  jest.mocked(crypto.getRandomValues).mockImplementation(() => {
    throw new Error('Synthetic entropy failure');
  });
  for (const verify of [
    verifyERC721OwnershipHelper,
    verifyERC1155OwnershipHelper,
  ]) {
    const provider = { call: jest.fn() };
    expect(await verify(CONTRACT, OWNER, ['7'], provider as any)).toEqual([
      { tokenId: '7', balance: 0, verified: false },
    ]);
    expect(provider.call).not.toHaveBeenCalled();
  }
});

it('bounds repeated requested-ID entropy collisions without querying that ID as a probe', async () => {
  jest
    .mocked(crypto.getRandomValues)
    .mockImplementation((bytes: any) => fillProbe(bytes, '7'));
  const provider = runner721(new Map([['7', OWNER]]));
  expect(
    await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], provider as any)
  ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
  expect(crypto.getRandomValues).toHaveBeenCalledTimes(16);
  expect(provider.calls).toEqual([]);
});

it.each(['unavailable', 'malformed'])(
  'does not invent a positive ownership result from an %s provider',
  async (mode) => {
    const provider = {
      call: async () => {
        if (mode === 'unavailable') throw new Error('Synthetic RPC failure');
        return '0x';
      },
    };
    for (const verify of [
      verifyERC721OwnershipHelper,
      verifyERC1155OwnershipHelper,
    ]) {
      const result = await verify(CONTRACT, OWNER, ['7'], provider as any);
      expect(result).toHaveLength(1);
      expect(result[0].balance).toBe(0);
      expect(result[0].tokenId).toBe('7');
    }
  }
);
