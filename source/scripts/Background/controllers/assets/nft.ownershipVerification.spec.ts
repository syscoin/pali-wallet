import { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';
import { Interface } from 'ethers/abi';
import { JsonRpcProvider } from 'ethers/providers';
import http from 'http';
import https from 'https';

import {
  discoverNftTokens,
  verifyERC1155OwnershipHelper,
  verifyERC721OwnershipHelper,
} from './nft-utils';
import type { JsonRpcError, TransactionRequest } from 'ethers/providers';

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
  'error ERC721NonexistentToken(uint256)',
]);
const abi1155 = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);

const rpcProvider = new JsonRpcProvider('https://rpc.invalid', 1);
const callError = (data: string, error: JsonRpcError['error']) =>
  rpcProvider.getRpcError(
    {
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: CONTRACT, data }, 'latest'],
    },
    { id: 1, error }
  );

function runner721(
  owners: Map<string, string>,
  alwaysOwner = false,
  revertData = '0x'
) {
  const calls: string[] = [];
  return {
    calls,
    call: async ({ data, to }: TransactionRequest) => {
      expect(to).toBe(CONTRACT);
      const decoded = abi721.parseTransaction({ data: data! })!;
      const tokenId = decoded.args[0].toString();
      calls.push(tokenId);
      const owner = alwaysOwner ? OWNER : owners.get(tokenId);
      if (!owner) {
        throw callError(data!, {
          code: 3,
          message: 'execution reverted',
          data: revertData,
        });
      }
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
    call: async ({ data, to }: TransactionRequest) => {
      expect(to).toBe(CONTRACT);
      const decoded = abi1155.parseTransaction({ data: data! })!;
      if (decoded.name === 'balanceOf') {
        const tokenId = decoded.args[1].toString();
        calls.push(tokenId);
        return abi1155.encodeFunctionResult('balanceOf', [
          balance(decoded.args[0], tokenId),
        ]);
      }
      const ids = Array.from<bigint, string>(decoded.args[1], (id) =>
        id.toString()
      );
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
      provider
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
      provider
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
        runner721(new Map([[tokenId, OWNER]]))
      )
    ).toEqual([{ tokenId, balance: 1, verified: true }]);
    expect(
      await verifyERC1155OwnershipHelper(
        CONTRACT,
        OWNER,
        [tokenId],
        runner1155(new Map([[tokenId, BigInt(3)]]))
      )
    ).toEqual([{ tokenId, balance: 3, rawBalance: '3', verified: true }]);
  }
);

it('distinguishes a confirmed other owner from an unverified unminted ERC721 token', async () => {
  expect(
    await verifyERC721OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7', '8'],
      runner721(new Map([['7', OTHER]]))
    )
  ).toEqual([
    { tokenId: '7', balance: 0, verified: true },
    { tokenId: '8', balance: 0, verified: false },
  ]);
});

it('does not report ERC1155 holdings for another owner or an unminted token', async () => {
  expect(
    await verifyERC1155OwnershipHelper(
      CONTRACT,
      OTHER,
      ['7', '8'],
      runner1155(new Map([['7', BigInt(3)]]))
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
      runner721(new Map(), true)
    )
  ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
});

it('rejects an ERC1155 contract that dishonestly returns a positive balance for every ID', async () => {
  expect(
    await verifyERC1155OwnershipHelper(
      CONTRACT,
      OWNER,
      ['7'],
      runner1155(new Map(), true)
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
      const result = await verify(CONTRACT, OWNER, [tokenId], provider);
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
    expect(await verify(CONTRACT, OWNER, ['7'], provider)).toEqual([
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
    await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], provider)
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
      const result = await verify(CONTRACT, OWNER, ['7'], provider);
      expect(result).toHaveLength(1);
      expect(result[0].balance).toBe(0);
      expect(result[0].tokenId).toBe('7');
    }
  }
);

it('preserves the runner receiver and explicit name resolution', async () => {
  const runner = {
    ...runner721(new Map([['7', OWNER]])),
    address: CONTRACT,
    resolveName: jest.fn(async function (name: string) {
      return name === 'nft.example' ? this.address : null;
    }),
  };
  const call = runner.call;
  runner.call = jest.fn(async function (this: typeof runner, tx) {
    expect(this).toBe(runner);
    return call(tx);
  });

  expect(
    await verifyERC721OwnershipHelper('nft.example', OWNER, ['7'], runner)
  ).toEqual([{ tokenId: '7', balance: 1, verified: true }]);
  expect(runner.resolveName).toHaveBeenCalledWith('nft.example');
  expect(runner.calls).toEqual(['42', '7']);
});

it.each([false, true])(
  'preserves the maximum raw ERC1155 quantity with batch refusal=%s',
  async (refuseBatch) => {
    const runner = runner1155(new Map([['7', BigInt(MAX_UINT256)]]));
    const call = runner.call;
    const methods: string[] = [];
    runner.call = async (tx) => {
      const { name } = abi1155.parseTransaction({ data: tx.data! })!;
      methods.push(name);
      if (refuseBatch && name === 'balanceOfBatch') {
        throw new Error('Synthetic batch refusal');
      }
      return call(tx);
    };

    expect(
      await verifyERC1155OwnershipHelper(CONTRACT, OWNER, ['7', '8'], runner)
    ).toEqual([
      {
        tokenId: '7',
        balance: Number.MAX_SAFE_INTEGER,
        rawBalance: MAX_UINT256,
        verified: true,
      },
      { tokenId: '8', balance: 0, rawBalance: '0', verified: true },
    ]);
    expect(methods).toEqual([
      'balanceOf',
      'balanceOfBatch',
      ...(refuseBatch ? ['balanceOf', 'balanceOf'] : []),
    ]);
    expect(runner.calls).toEqual(['42', '7', '8']);
  }
);

it.each([[99], [99, 99, 99]].map((balances) => ({ balances })))(
  'falls back to individual ERC1155 reads for a wrong-length batch $balances',
  async ({ balances }) => {
    const runner = runner1155(new Map([['7', BigInt(3)]]));
    const call = runner.call;
    const methods: string[] = [];
    runner.call = async (tx) => {
      const { name } = abi1155.parseTransaction({ data: tx.data! })!;
      methods.push(name);
      return name === 'balanceOfBatch'
        ? abi1155.encodeFunctionResult(name, [balances])
        : call(tx);
    };

    expect(
      await verifyERC1155OwnershipHelper(CONTRACT, OWNER, ['7', '8'], runner)
    ).toEqual([
      { tokenId: '7', balance: 3, rawBalance: '3', verified: true },
      { tokenId: '8', balance: 0, rawBalance: '0', verified: true },
    ]);
    expect(methods).toEqual([
      'balanceOf',
      'balanceOfBatch',
      'balanceOf',
      'balanceOf',
    ]);
    expect(runner.calls).toEqual(['42', '7', '8']);
  }
);

it('reads the enumerable interface and limits ERC721 discovery to ten entries', async () => {
  const abi = new Interface([
    'function supportsInterface(bytes4) view returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  ]);
  const calls: string[] = [];
  const runner = {
    async call({ data, to }: TransactionRequest) {
      expect(to).toBe(CONTRACT);
      const { name, args } = abi.parseTransaction({ data: data! })!;
      calls.push(name);
      if (name === 'supportsInterface') {
        expect(args[0]).toBe('0x780e9d63');
        return abi.encodeFunctionResult(name, [true]);
      }
      expect(args[0]).toBe(OWNER);
      return abi.encodeFunctionResult(name, [
        name === 'balanceOf' ? BigInt(11) : BigInt(MAX_UINT256) - args[1],
      ]);
    },
  };

  const result = await discoverNftTokens(CONTRACT, OWNER, 'ERC-721', runner);
  expect(result).toMatchObject({
    method: 'enumeration',
    hasMore: true,
    requiresManualEntry: true,
  });
  expect(result.tokens).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      tokenId: (BigInt(MAX_UINT256) - BigInt(index)).toString(),
      balance: 1,
      verified: true,
    }))
  );
  expect(calls).toEqual([
    'supportsInterface',
    'balanceOf',
    ...new Array(10).fill('tokenOfOwnerByIndex'),
  ]);
});

it.each([
  '0x',
  abi721.encodeErrorResult('Error', ['ERC721: invalid token ID']),
  abi721.encodeErrorResult('ERC721NonexistentToken', [42]),
])(
  'accepts an explicit ERC721 execution revert from the probe (%s)',
  async (data) => {
    const runner = runner721(new Map([['7', OWNER]]), false, data);
    expect(
      await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], runner)
    ).toEqual([{ tokenId: '7', balance: 1, verified: true }]);
    expect(runner.calls).toEqual(['42', '7']);
  }
);

it.each(['oversized', 'non-hex', 'accessor'] as const)(
  'rejects %s ethers CALL_EXCEPTION data before the Contract ABI decodes it',
  async (kind) => {
    const makeError = jest.spyOn(Interface.prototype, 'makeError');
    const oversized = `0xdeadbeef${'00'.repeat(4096)}`;
    const readData = jest
      .fn()
      .mockReturnValueOnce('0x')
      .mockReturnValue(oversized);
    const call = jest.fn(async ({ data }: TransactionRequest) => {
      if (call.mock.calls.length > 1)
        return abi721.encodeFunctionResult('ownerOf', [OWNER]);
      const error = callError(data!, {
        code: 3,
        message: 'execution reverted',
        data: kind === 'oversized' ? oversized : '0x',
      });
      // ethers rejects malformed bytes at its own RPC boundary. Model a
      // runner that passes malformed data on an already normalized error.
      if (kind === 'non-hex')
        Object.assign(error, { data: `0xdeadbeef${'zz'.repeat(32)}` });
      if (kind === 'accessor')
        Object.defineProperty(error, 'data', { get: readData });
      throw error;
    });

    expect(
      await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], { call })
    ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(makeError).not.toHaveBeenCalled();
    expect(readData).not.toHaveBeenCalled();
  }
);

function sdkRunner721(
  probe: Pick<JsonRpcError, 'error'> | { result: string } | Error,
  status = 200
) {
  const url = 'https://rpc.invalid';
  const provider = new CustomJsonRpcProvider(
    new AbortController().signal,
    url,
    1
  );
  const calls: string[] = [];
  jest.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const request = JSON.parse(String(init?.body));
    expect(input).toBe(url);
    expect(request).toMatchObject({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: CONTRACT, data: expect.any(String) }, 'latest'],
    });
    const decoded = abi721.parseTransaction(request.params[0])!;
    const tokenId = decoded.args[0].toString();
    calls.push(tokenId);
    if (tokenId === '42' && probe instanceof Error) throw probe;
    const response =
      tokenId === '42'
        ? probe
        : { result: abi721.encodeFunctionResult('ownerOf', [OWNER]) };
    return {
      ok: status === 200,
      status,
      json: async () => ({ jsonrpc: '2.0', id: request.id, ...response }),
    } as Response;
  });
  return { provider, calls };
}

it.each([
  { code: 3, message: 'execution reverted', data: '0x' },
  {
    code: -32000,
    message: 'execution reverted: ERC721: invalid token ID',
    data: abi721.encodeErrorResult('Error', ['ERC721: invalid token ID']),
  },
  {
    code: 3,
    message: 'execution reverted',
    data: abi721.encodeErrorResult('ERC721NonexistentToken', [42]),
  },
])(
  'accepts raw execution revert evidence through the installed SDK provider ($code)',
  async (error) => {
    const { provider, calls } = sdkRunner721({ error });
    expect(
      await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], provider)
    ).toEqual([{ tokenId: '7', balance: 1, verified: true }]);
    expect(calls).toEqual(['42', '7']);
  }
);

it.each([
  {
    label: 'transport rejection',
    probe: new Error('execution reverted'),
  },
  {
    label: 'HTTP failure with a revert-shaped body',
    probe: { error: { code: 3, message: 'execution reverted', data: '0x' } },
    status: 429,
  },
  {
    label: 'rate-limited JSON-RPC error with data',
    probe: { error: { code: -32000, message: 'rate limited', data: '0x' } },
  },
  {
    label: 'revert wording with an incompatible RPC code',
    probe: {
      error: { code: -32603, message: 'execution reverted', data: '0x' },
    },
  },
  {
    label: 'execution revert without data',
    probe: { error: { code: 3, message: 'execution reverted' } },
  },
  {
    label: 'execution revert with malformed Error(string)',
    probe: {
      error: { code: 3, message: 'execution reverted', data: '0x08c379a0' },
    },
  },
  {
    label: 'oversized execution revert data',
    probe: {
      error: {
        code: 3,
        message: 'execution reverted',
        data: `0xdeadbeef${'00'.repeat(4096)}`,
      },
    },
  },
  {
    label: 'execution panic',
    probe: {
      error: {
        code: 3,
        message: 'execution reverted',
        data: abi721.encodeErrorResult('Panic', [17]),
      },
    },
  },
  { label: 'malformed ABI result', probe: { result: '0x' } },
])(
  'does not admit $label through the installed SDK provider',
  async ({ probe, status }) => {
    const { provider, calls } = sdkRunner721(probe, status);
    expect(
      await verifyERC721OwnershipHelper(CONTRACT, OWNER, ['7'], provider)
    ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
    expect(calls).toEqual(['42']);
  }
);

it.each([
  [
    'transport rejection',
    () => {
      throw new Error('RPC connection reset');
    },
  ],
  ['malformed result', () => '0x'],
  [
    'RPC error without revert evidence',
    (data: string) => {
      throw callError(data, { code: -32000, message: 'request rate limited' });
    },
  ],
  [
    'revert error missing data',
    (data: string) => {
      throw callError(data, { code: 3, message: 'execution reverted' });
    },
  ],
  [
    'malformed revert data',
    (data: string) => {
      throw callError(data, {
        code: 3,
        message: 'execution reverted',
        data: '0x08c379a0',
      });
    },
  ],
  [
    'execution panic',
    (data: string) => {
      throw callError(data, {
        code: 3,
        message: 'execution reverted',
        data: abi721.encodeErrorResult('Panic', [17]),
      });
    },
  ],
] as const)(
  'blocks both standards when the negative probe has a %s',
  async (_label, failProbe) => {
    const cases = [
      {
        verify: verifyERC721OwnershipHelper,
        laterResult: abi721.encodeFunctionResult('ownerOf', [OWNER]),
      },
      {
        verify: verifyERC1155OwnershipHelper,
        laterResult: abi1155.encodeFunctionResult('balanceOfBatch', [[1]]),
      },
    ];
    for (const { verify, laterResult } of cases) {
      const call = jest.fn(async ({ data }: TransactionRequest) =>
        call.mock.calls.length === 1 ? failProbe(data!) : laterResult
      );
      expect(await verify(CONTRACT, OWNER, ['7'], { call })).toEqual([
        { tokenId: '7', balance: 0, verified: false },
      ]);
      expect(call).toHaveBeenCalledTimes(1);
    }
  }
);

it('does not use the ERC1155 batch fallback when its negative probe reverts', async () => {
  const call = jest.fn(async ({ data }: TransactionRequest) => {
    throw callError(data!, {
      code: 3,
      message: 'execution reverted',
      data: '0x',
    });
  });
  expect(
    await verifyERC1155OwnershipHelper(CONTRACT, OWNER, ['7'], { call })
  ).toEqual([{ tokenId: '7', balance: 0, verified: false }]);
  expect(call).toHaveBeenCalledTimes(1);
});
