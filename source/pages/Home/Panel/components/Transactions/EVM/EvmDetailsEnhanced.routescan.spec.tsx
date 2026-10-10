import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';

import { EvmTransactionDetailsEnhanced } from './EvmDetailsEnhanced';

jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: 'transaction-header',
  TransactionDetailsList: 'transaction-details',
  TransactionEventLogs: 'transaction-logs',
  DecodedTransactionParams: 'decoded-params',
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ useCopyClipboard: () => [false, jest.fn()], alert: {} }),
  useTransactionsListConfig: () => ({
    getTxStatusIcons: jest.fn(),
    getTxStatus: jest.fn(),
    getTxType: jest.fn(),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: `0x${'11'.repeat(20)}` }),
  selectActiveAccountTransactions: () => ({ ethereum: {} }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/index', () => ({ camelCaseToText: (value: string) => value }));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: jest.fn(),
}));

const ROUTESCAN_API =
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api';

describe('transaction detail API compatibility', () => {
  let effects: (() => void)[];
  let emitter: jest.Mock;

  beforeEach(() => {
    effects = [];
    emitter = jest.fn();
    jest
      .spyOn(React, 'useState')
      .mockImplementation((initial?: any) => [initial, jest.fn()] as any);
    jest
      .spyOn(React, 'useRef')
      .mockImplementation((value) => ({ current: value }));
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      effects.push(effect as () => void);
    });
    jest
      .mocked(useController)
      .mockReturnValue({ controllerEmitter: emitter } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const loadDetails = async (apiUrl: string | undefined, hash: string) => {
    jest.mocked(useSelector).mockImplementation((selector: any) =>
      selector({
        vault: { activeNetwork: { chainId: 1, currency: 'eth', apiUrl } },
      })
    );
    EvmTransactionDetailsEnhanced({
      hash,
      tx: {
        hash,
        from: `0x${'11'.repeat(20)}`,
        input: '0x',
        value: '0',
      } as any,
    });
    // Mount all effects; the detail request need not be the first effect.
    effects.forEach((effect) => effect());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it('uses RPC directly for Routescan instead of requesting unsupported gettxinfo', async () => {
    emitter.mockResolvedValue({
      hash: 'routescan-details-hash',
      gasUsed: '21000',
      logs: [],
    });

    await loadDetails(ROUTESCAN_API, 'routescan-details-hash');

    expect(emitter).toHaveBeenCalledTimes(1);
    expect(emitter).toHaveBeenCalledWith(
      ['wallet', 'getEvmTransactionFromProvider'],
      ['routescan-details-hash']
    );
  });

  it('falls back to RPC when a custom explorer returns no enhanced details', async () => {
    emitter.mockResolvedValueOnce(null).mockResolvedValueOnce({
      hash: 'fallback-details-hash',
      gasUsed: '21000',
    });

    await loadDetails(
      'https://custom-explorer.example/api',
      'fallback-details-hash'
    );

    expect(emitter.mock.calls).toEqual([
      [
        ['wallet', 'getEvmTransactionFromAPI'],
        ['fallback-details-hash', 'https://custom-explorer.example/api'],
      ],
      [['wallet', 'getEvmTransactionFromProvider'], ['fallback-details-hash']],
    ]);
  });

  it('keeps valid enhanced explorer details without an extra RPC request', async () => {
    emitter.mockResolvedValue({
      hash: 'supported-details-hash',
      gasUsed: '21000',
    });

    await loadDetails(
      'https://custom-explorer.example/api',
      'supported-details-hash'
    );

    expect(emitter).toHaveBeenCalledTimes(1);
    expect(emitter).toHaveBeenCalledWith(
      ['wallet', 'getEvmTransactionFromAPI'],
      ['supported-details-hash', 'https://custom-explorer.example/api']
    );
  });
});
