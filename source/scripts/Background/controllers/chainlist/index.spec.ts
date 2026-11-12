/** @jest-environment node */
import { retryableFetch } from '@sidhujag/sysweb3-network';

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

it('retains the bundled Gateway suggestion when the remote catalogue is unavailable', async () => {
  (chromeStorage.getItem as jest.Mock).mockResolvedValue(null);
  (retryableFetch as jest.Mock).mockRejectedValue(new Error('offline'));
  const rows = await ChainListService.getInstance().getChainData(
    'ethereum' as never
  );
  expect(rows).toEqual([
    expect.objectContaining({
      chainId: 57570,
      name: 'Syscoin Gateway',
      rpc: [{ url: 'https://rpc-gw.syscoin.org' }],
    }),
  ]);
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
  expect(rows).toHaveLength(1);
  expect(rows[0].rpc).toEqual([{ url: 'https://rpc-gw.syscoin.org' }]);
  expect(retryableFetch).not.toHaveBeenCalled();
});
