/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { clearRpcCaches, getEthRpc } from '@sidhujag/sysweb3-network';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { SyscoinAssetDetails } from 'pages/Home/Panel/components/Assets/SyscoinDetails';
import { EvmTransactionsList } from 'pages/Home/Panel/components/Transactions/EVM/EvmList';

const ACCOUNT = '0x' + '11'.repeat(20);
const HASH = '0x' + '22'.repeat(32);
const GUID = '998877';
const RPC = 'https://rpc.synthetic.invalid';
const API = 'https://api.synthetic.invalid/api?key=retained';
let mockState: any;
let mockRows: any[];
let mockRpcReads: string[];
const mockNavigate = jest.fn();
const mockAlert = {
  error: jest.fn(),
  warning: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
};
const mockForbiddenHttp = jest.fn<never, any[]>(() => {
  throw new Error('Public HTTP forbidden');
});
const mockForbiddenController = jest.fn<never, any[]>(() => {
  throw new Error('Unexpected controller operation');
});
const mockForbiddenUpdate = jest.fn<never, any[]>(() => {
  throw new Error('No transaction mutations permitted');
});
const mockFiat = () => '0 USD';
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { explorer?: string }) =>
      key === 'home.viewOnNamedExplorer'
        ? jest
            .requireActual('../../assets/locales/en.json')
            .home.viewOnNamedExplorer.replace(
              '{{explorer}}',
              String(values?.explorer)
            )
        : key,
  }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => mockState.vault.accounts.HDAccount[0],
  selectActiveAccountRef: () => mockState.vault.activeAccount,
  selectActiveAccountAssets: () => mockState.vault.accountAssets.HDAccount[0],
  selectActiveAccountTransactions: () => ({ ethereum: { 5700: mockRows } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn(), () => true],
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ getFiatAmount: mockFiat }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-account',
    network: 'public-network',
  }),
  navigateBack: jest.fn(),
}));
jest.mock(
  'pages/Home/Panel/components/Transactions/useHistoryBrowsingState',
  () => ({
    useHistoryBrowsingState: () => ({
      extraTransactions: [],
      visibleCount: 50,
      nextPage: 2,
      hasMoreServer: false,
      isRestoringPages: false,
      setExtraTransactions: jest.fn(),
      setVisibleCount: jest.fn(),
      setNextPage: jest.fn(),
      setHasMoreServer: jest.fn(),
    }),
  })
);
jest.mock(
  'pages/Home/Panel/components/Transactions/useTransactionConfirmationToast',
  () => ({ useTransactionConfirmationToast: () => undefined })
);
jest.mock(
  'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos',
  () => ({
    useTransactionsListConfig: () => ({
      filteredTransactions: mockRows,
      formatTimeStamp: () => 'Public date',
      getTxStatusIcons: () => null,
      getTxType: () => 'Sent',
      txId: 'hash',
    }),
  })
);
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
  getTransactionDisplayInfo: async (tx: any) => ({
    displayValue: '1',
    formattedValue: '1',
    displaySymbol: 'SYS',
    isErc20Transfer: false,
    actualRecipient: tx.to,
    isNft: false,
  }),
  isERC1155Transfer: () => false,
  getERC1155TransferValue: () => null,
  handleUpdateTransaction: (...args: any[]) => mockForbiddenUpdate(...args),
  previewSpeedUpTransaction: (...args: any[]) => mockForbiddenUpdate(...args),
  UpdateTxAction: { SpeedUp: 'SpeedUp', Cancel: 'Cancel' },
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockForbiddenController(...args),
}));
jest.mock('utils/retryableFetch', () => ({
  retryableFetch: (...args: any[]) => mockForbiddenHttp(...args),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Icon: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  DetailArrowSvg: () => <button type="button">Details</button>,
  ExternalLinkSvg: () => null,
  TrashIconSvg: () => null,
  FiExternalLink: () => null,
  FiCopy: () => null,
}));
jest.mock('utils/index', () => ({
  // Keep the real URL utility for adjacent callers that use this barrel.
  adjustUrl: jest.requireActual('utils/strings').adjustUrl,
  formatCurrency: (value: string) => value,
  truncate: (value: string) => value,
  camelCaseToText: (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1),
  syscoinKeysOfInterest: ['symbol', 'decimals', 'balance'],
  getKnownSyscoinAsset: () => null,
  getTokenLogo: () => undefined,
  getKnownTokenLogo: () => undefined,
}));

const ORIGINAL_FETCH = globalThis.fetch;
const cases = [
  [
    'root',
    'https://explorer.synthetic.invalid/',
    'https://explorer.synthetic.invalid/',
  ],
  [
    'path',
    'https://explorer.synthetic.invalid/public/',
    'https://explorer.synthetic.invalid/public/',
  ],
  [
    'query',
    'https://explorer.synthetic.invalid/public/?view=compact',
    'https://explorer.synthetic.invalid/public/',
  ],
] as const;
beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
  mockRpcReads = [];
  globalThis.fetch = jest.fn(async (url, options) => {
    expect(String(url)).toBe(RPC);
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    });
    mockRpcReads.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1644' }),
    } as Response;
  });
  mockRows = [
    {
      hash: HASH,
      from: ACCOUNT,
      to: '0x' + '33'.repeat(20),
      value: '1',
      input: '0x',
      nonce: 1,
      chainId: 5700,
      type: 2,
      timestamp: 1700000000,
      blockNumber: null,
      confirmations: 0,
    },
  ];
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: { 0: { id: 0, address: ACCOUNT, xpub: 'public-xpub' } },
      },
      activeNetwork: {
        chainId: 5700,
        kind: 'ethereum',
        currency: 'sys',
        label: 'Synthetic',
        url: RPC,
        apiUrl: API,
      },
      accountAssets: {
        HDAccount: {
          0: {
            ethereum: [],
            syscoin: [
              {
                assetGuid: GUID,
                chainId: 5700,
                symbol: 'SPT',
                decimals: 8,
                balance: '1',
                totalSent: '0',
                totalReceived: '1',
              },
            ],
          },
        },
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60, ensCache: {} },
    price: { fiat: { asset: 'usd' } },
  };
});
const acceptExplorer = async (explorer: string) => {
  const { formattedNetwork } = await getEthRpc(
    { url: RPC, explorer, symbol: 'SYS', label: 'Synthetic' } as any,
    false
  );
  expect(formattedNetwork.explorer).toBe(explorer);
  expect(formattedNetwork.url).toBe(RPC);
  expect(mockRpcReads).toEqual([RPC]);
  return formattedNetwork.explorer;
};
afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
  expect(mockForbiddenHttp).not.toHaveBeenCalled();
  expect(mockForbiddenController).not.toHaveBeenCalled();
  expect(mockForbiddenUpdate).not.toHaveBeenCalled();
  expect(mockState.vault.activeNetwork.url).toBe(RPC);
  expect(mockState.vault.activeNetwork.apiUrl).toBe(API);
  jest.restoreAllMocks();
});

it.each(cases)(
  'actual pending Activity menu preserves the %s explorer route',
  async (name, explorer, path) => {
    mockState.vault.activeNetwork.explorer = await acceptExplorer(explorer);
    const opened = jest.spyOn(window, 'open').mockImplementation(() => null);
    const view = render(
      <MemoryRouter>
        <EvmTransactionsList userTransactions={mockRows} />
      </MemoryRouter>
    );
    expect(screen.getByText('send.pending')).toBeVisible();
    const trigger = view.container.querySelector<HTMLButtonElement>(
      '#transaction-options button'
    );
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger!);
    await userEvent.click(
      await screen.findByRole('menuitem', {
        name: 'transactions.seeOnBlockExplorer',
      })
    );
    expect(opened).toHaveBeenCalledWith(
      path + 'tx/' + HASH + (name === 'query' ? '?view=compact' : ''),
      '_blank'
    );
  }
);

it('does not show pending transaction actions for a mined Activity row', () => {
  mockRows[0].blockNumber = 1;
  const view = render(
    <MemoryRouter>
      <EvmTransactionsList userTransactions={mockRows} />
    </MemoryRouter>
  );
  expect(view.container.querySelector('#transaction-options')).toBeNull();
});

it.each(cases)(
  'actual SPT details footer preserves the %s explorer route',
  async (name, explorer, path) => {
    mockState.vault.activeNetwork = {
      ...mockState.vault.activeNetwork,
      explorer: await acceptExplorer(explorer),
      kind: 'syscoin',
    };
    mockState.vault.isBitcoinBased = true;
    render(
      <MemoryRouter>
        <SyscoinAssetDetails id={GUID} />
      </MemoryRouter>
    );
    expect(screen.getByText('SPT (Synthetic)')).toBeVisible();
    const link = screen.getByRole('link', { name: 'View on Syscoin Explorer' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute(
      'href',
      path + 'asset/' + GUID + (name === 'query' ? '?view=compact' : '')
    );
  }
);
