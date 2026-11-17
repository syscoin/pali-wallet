/** @jest-environment node */
import { retryableFetch } from '@sidhujag/sysweb3-network';

import { parseEvmChainCatalogue } from '../../../../shared/chainCatalogueData';
import { chromeStorage } from 'utils/storageAPI';

import ChainListService from './index';

jest.mock('@sidhujag/sysweb3-network', () => ({
  INetworkType: { Ethereum: 'ethereum', Syscoin: 'syscoin' },
  coins: [],
  retryableFetch: jest.fn(),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

beforeEach(() => {
  (ChainListService as unknown as { instance: unknown }).instance = undefined;
  jest.clearAllMocks();
});

it('retains all bundled suggestions when the remote catalogue is unavailable', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
  (retryableFetch as jest.Mock).mockRejectedValue(new Error('offline'));
  const rows = await ChainListService.getInstance().getChainData(
    'ethereum' as never
  );
  expect(rows.map(({ chainId }) => chainId)).toEqual([
    57, 1, 8453, 42161, 570, 5757, 5700, 57057, 57570,
  ]);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        chainId: 57570,
        name: 'Syscoin Gateway',
        rpc: [{ url: 'https://rpc-gw.syscoin.org' }],
      }),
    ])
  );
  expect(retryableFetch).toHaveBeenCalledTimes(1);
  expect(retryableFetch).toHaveBeenCalledWith(
    'https://chainlist.org/rpcs.json',
    expect.any(Object)
  );
});

it('uses the pinned Gateway metadata ahead of a cached conflicting catalogue row', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue({
    timestamp: Date.now(),
    data: [
      {
        chainId: 57570,
        name: 'Wrong',
        rpc: [{ url: 'https://wrong.invalid' }],
      },
    ],
  });
  const rows = await ChainListService.getInstance().getChainData(
    'ethereum' as never
  );
  const gatewayRows = rows.filter(({ chainId }) => chainId === 57570);
  expect(gatewayRows).toHaveLength(1);
  expect(gatewayRows[0].rpc).toEqual([{ url: 'https://rpc-gw.syscoin.org' }]);
  expect(retryableFetch).not.toHaveBeenCalled();
});

const remoteChain = {
  name: 'Public Polygon Catalogue',
  chainId: 137,
  nativeCurrency: { name: 'Polygon', symbol: 'POL', decimals: 18 },
  rpc: ['https://public-polygon.invalid'],
};

it('returns a healthy cold catalogue on its first visit when only optional cache persistence fails', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
  (chromeStorage.setItem as jest.Mock).mockRejectedValue(
    new Error('Optional public cache unavailable')
  );
  (retryableFetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => [
      remoteChain,
      { ...remoteChain, chainId: 57570, name: 'Untrusted duplicate' },
    ],
  });
  const service = ChainListService.getInstance();
  const first = await service.getChainData('ethereum' as never);
  expect(first.find((row) => row.chainId === 137)?.name).toBe(remoteChain.name);
  expect(first.filter((row) => row.chainId === 57570)).toEqual([
    expect.objectContaining({
      name: 'Syscoin Gateway',
      rpc: [{ url: 'https://rpc-gw.syscoin.org' }],
    }),
  ]);
  expect(await service.getChainData('ethereum' as never)).toEqual(first);
  expect(retryableFetch).toHaveBeenCalledTimes(1);
  expect(chromeStorage.getItem).toHaveBeenCalledTimes(1);
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
});

it('concurrent cold catalogue readers share one healthy HTTP result despite optional write refusal', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
  (chromeStorage.setItem as jest.Mock).mockRejectedValue(
    new Error('Optional public cache unavailable')
  );
  let release!: (response: unknown) => void;
  (retryableFetch as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const service = ChainListService.getInstance(),
    first = service.getChainData('ethereum' as never),
    second = service.getChainData('ethereum' as never);
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  expect(retryableFetch).toHaveBeenCalledTimes(1);
  release({ ok: true, json: async () => [remoteChain] });
  const rows = await Promise.all([first, second]);
  expect(rows[0]).toEqual(rows[1]);
  expect(rows[0].some((row) => row.chainId === 137)).toBe(true);
  expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
  expect(retryableFetch).toHaveBeenCalledTimes(1);
});

it.each(['HTTP', 'parse', 'bounds'] as const)(
  'retains bundled fallback for a real %s failure without writing or retrying',
  async (failure) => {
    (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
    (chromeStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (retryableFetch as jest.Mock).mockResolvedValue(
      failure === 'HTTP'
        ? { ok: false, status: 503 }
        : {
            ok: true,
            json: async () =>
              failure === 'parse' ? {} : Array(8193).fill(remoteChain),
          }
    );
    const rows = await ChainListService.getInstance().getChainData(
      'ethereum' as never
    );
    expect(rows).toHaveLength(9);
    expect(rows.some((row) => row.chainId === 137)).toBe(false);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(retryableFetch).toHaveBeenCalledTimes(1);
  }
);

it('returns a fresh cached remote catalogue without any optional write or HTTP request', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue({
    timestamp: Date.now(),
    data: parseEvmChainCatalogue([remoteChain]),
  });
  (chromeStorage.setItem as jest.Mock).mockRejectedValue(
    new Error('Optional public cache unavailable')
  );
  const rows = await ChainListService.getInstance().getChainData(
    'ethereum' as never
  );
  expect(rows.some((row) => row.chainId === 137)).toBe(true);
  expect(chromeStorage.getItem).toHaveBeenCalledTimes(1);
  expect(chromeStorage.setItem).not.toHaveBeenCalled();
  expect(retryableFetch).not.toHaveBeenCalled();
});
