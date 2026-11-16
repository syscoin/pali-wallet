/** @jest-environment node */
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: { activeNetwork: { chainId: 1 } } }) },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));

import { webcrypto } from 'crypto';
import { Interface } from 'ethers/abi';

import EvmAssetsController from './evm';

const abi = new Interface([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
]);
const erc721 = new Interface([
  'function balanceOf(address) view returns (uint256)',
]);
const ownerAddress = '0x' + '11'.repeat(20);
const address = (index: number) => `0x${index.toString(16).padStart(40, '0')}`;
const { CustomJsonRpcProvider } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/providers'
);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterEach(() => jest.restoreAllMocks());

it.each(['batch', 'repair', 'scalar', 'limited', 'wrong-chain', 'cancelled'])(
  'composes NFT collection waves through the published %s transport',
  async (mode) => {
    const abort = new AbortController();
    const provider = new CustomJsonRpcProvider(
      abort.signal,
      'https://nft-rpc.test',
      1
    );
    const requests: any[][] = [];
    let requestBytes = 0;
    let responseBytes = 0;
    let repaired = false;
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init!.body));
        requestBytes += Buffer.byteLength(String(init!.body));
        const batch = Array.isArray(body) ? body : [body];
        requests.push(batch);
        if (
          Array.isArray(body) &&
          (mode === 'scalar' || (mode === 'limited' && body.length > 3))
        )
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: {
                code: -32600,
                message:
                  mode === 'limited' ? 'batch limit 3' : 'batch not supported',
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        const responses = batch
          .map((request) => {
            if (request.method === 'eth_chainId') {
              if (mode === 'cancelled') abort.abort();
              return {
                jsonrpc: '2.0',
                id: request.id,
                result: mode === 'wrong-chain' ? '0x2' : '0x1',
              };
            }
            if (request.method !== 'eth_call') throw new Error(request.method);
            const call = request.params[0];
            if (call.data.startsWith(erc721.getFunction('balanceOf')!.selector))
              return {
                jsonrpc: '2.0',
                id: request.id,
                result: erc721.encodeFunctionResult('balanceOf', [3]),
              };
            const decoded = abi.parseTransaction(call)!;
            if (
              mode === 'repair' &&
              !repaired &&
              decoded.name === 'balanceOfBatch'
            ) {
              repaired = true;
              return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                  code: -32000,
                  message: 'execution reverted',
                  data: '0x',
                },
              };
            }
            const value =
              decoded.name === 'balanceOfBatch'
                ? abi.encodeFunctionResult('balanceOfBatch', [[7]])
                : abi.encodeFunctionResult('balanceOf', [
                    decoded.args[1] === BigInt(1) ? 7 : 0,
                  ]);
            return { jsonrpc: '2.0', id: request.id, result: value };
          })
          .reverse();
        const response = Array.isArray(body) ? responses : responses[0];
        responseBytes += Buffer.byteLength(JSON.stringify(response));
        return Response.json(response);
      });
    const assets = Array.from({ length: 18 }, (_, index) => ({
      chainId: 1,
      contractAddress: address(index + 100),
      tokenSymbol: 'NFT',
      decimals: 0,
      balance: 9,
      rawBalance: '9',
      isNft: true,
      tokenStandard: index < 9 ? 'ERC-1155' : 'ERC-721',
      tokenId: '1',
    }));
    const changes = jest.fn();
    const current = () => {
      if (abort.signal.aborted) throw new Error('retired');
    };
    try {
      const work = EvmAssetsController().updateAllEvmTokens(
        { address: ownerAddress } as any,
        1,
        provider,
        assets as any,
        changes,
        { signal: abort.signal, assertCurrent: current }
      );
      if (mode === 'cancelled') await expect(work).rejects.toThrow();
      else {
        const result = await work;
        if (mode === 'wrong-chain') {
          expect(changes).not.toHaveBeenCalled();
          expect(
            requests.flat().some((request) => request.method === 'eth_call')
          ).toBe(false);
          return;
        }
        expect(result.map((token) => token.rawBalance)).toEqual([
          ...Array(9).fill('7'),
          ...Array(9).fill('3'),
        ]);
        expect(changes).toHaveBeenCalledTimes(18);
        if (mode === 'batch' || mode === 'repair') {
          expect(requests).toHaveLength(mode === 'batch' ? 3 : 4);
          expect(requests.flat()).toHaveLength(mode === 'batch' ? 28 : 29);
          expect(requestBytes).toBeLessThan(mode === 'batch' ? 10_000 : 11_000);
          expect(responseBytes).toBeLessThan(mode === 'batch' ? 5_000 : 6_000);
        }
        expect(
          requests
            .flat()
            .filter((request) => request.method === 'eth_call')
            .every((request) => request.params[1] === 'latest')
        ).toBe(true);
      }
    } finally {
      abort.abort();
      provider.destroy();
      fetch.mockRestore();
    }
  }
);

it('keeps a scalar Contract runner without provider transport helpers usable', async () => {
  const call = jest.fn(async () =>
    erc721.encodeFunctionResult('balanceOf', [5])
  );
  const result = await EvmAssetsController().updateAllEvmTokens(
    { address: ownerAddress } as any,
    1,
    { call } as any,
    [
      {
        chainId: 1,
        contractAddress: address(99),
        tokenSymbol: 'NFT',
        decimals: 0,
        balance: 0,
        rawBalance: '0',
        isNft: true,
        tokenStandard: 'ERC-721',
      },
    ] as any
  );
  expect(result[0].rawBalance).toBe('5');
  expect(call).toHaveBeenCalledTimes(1);
});
