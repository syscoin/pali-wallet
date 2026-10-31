/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { AddToken } from '../../../../Tokens/AddToken';
import { DetailsView } from '../Details';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import MainController from 'scripts/Background/controllers/MainController';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { restoreVaultSnapshot, setAccountAssets } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setIsSwitchingAccount,
  setNetworkStatus,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';

import { EvmNftsList } from './EvmNftsList';
import { NftsDetails } from './NftsDetails';

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('@sidhujag/sysweb3-utils', () => ({
  contractChecker: jest.fn(),
  getErc21Abi: jest.fn(),
  getTokenStandardMetadata: jest.fn(),
  getNftStandardMetadata: jest.fn(),
  getERC721StandardBalance: jest.fn(),
  cleanTokenSymbol: (value: string) => value,
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({
    patchFetchWithPaliHeaders: jest.fn(),
  })
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (
        ((key: string, values?: { symbol?: string }) =>
          key === 'tokens.importNamedToken'
            ? `Import ${values?.symbol} token`
            : key) as any
      )(copyKey, copyValues),
    i18n: { language: 'en' },
  }),
}));
const mockEmitter = jest.fn();
const mockAlerts = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlerts,
  }),
  useAdjustedExplorer: () => 'https://explorer.synthetic.invalid/',
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlerts,
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.synthetic.invalid/',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  HiTrash: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  ExternalLinkSvg: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  Icon: () => null,
}));
jest.mock('components/index', () => ({
  TokenIcon: () => null,
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('../TransactionDetails', () => ({ TransactionDetails: () => null }));

const CONTRACT = `0x${'33'.repeat(20)}`;
const ADDRESS = `0x${'11'.repeat(20)}`;
const TYPE = KeyringAccountType.HDAccount;
const originalChrome = global.chrome;
const originalFetch = global.fetch;
let wallet: any;
let records: Record<string, any>;
let rawBalance: string | string[] = '0';
let discoveredStandard = 'ERC-1155';
let testCase = 0;
let routeState: any;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const NavigationObserver = () => {
  routeState = useLocation().state;
  return null;
};

const NavigationBackControl = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return <button onClick={() => navigateBack(navigate, location)}>Back</button>;
};

const renderPage = (page: React.ReactNode, state?: any) =>
  render(
    <Provider store={store}>
      <MemoryRouter
        initialEntries={[
          { pathname: state ? '/home/details' : '/tokens/add', state },
        ]}
      >
        <NavigationObserver />
        {page}
      </MemoryRouter>
    </Provider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  routeState = undefined;
  discoveredStandard = 'ERC-1155';
  global.chrome = {
    runtime: { id: 'nft-quantity-synthetic' },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  global.fetch = jest.fn(async (url: string) => {
    if (!url.startsWith('https://owned-quantity.synthetic.invalid/api'))
      throw new Error(`Unexpected network read: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        status: '1',
        result: (Array.isArray(rawBalance) ? rawBalance : [rawBalance]).map(
          (balance, index) => ({
            contractAddress: CONTRACT,
            type: discoveredStandard,
            id: String(index + 7),
            name: 'Exact collection',
            symbol: Array.isArray(rawBalance) ? `EXACT${index}` : 'EXACT',
            decimals: '0',
            balance,
          })
        ),
      }),
    } as unknown as Response;
  }) as typeof fetch;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeAccount: { id: 0, type: TYPE },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 5700,
        slip44: 60,
        url: 'https://rpc.synthetic.invalid',
        apiUrl: `https://owned-quantity.synthetic.invalid/api?case=${++testCase}`,
        currency: 'sys',
        label: 'Synthetic',
      },
      isBitcoinBased: false,
      accounts: {
        [TYPE]: {
          0: {
            id: 0,
            address: ADDRESS,
            xpub: 'public-quantity-account',
            label: 'Synthetic',
          },
        },
      },
      accountAssets: { [TYPE]: { 0: { ethereum: [], syscoin: [] } } },
      accountTransactions: { [TYPE]: { 0: { ethereum: {}, syscoin: {} } } },
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(setIsSwitchingAccount(false));
  store.dispatch(setNetworkStatus('idle'));
  const assets = EvmAssetsController();
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.isUnlocked = () => true;
  const keyring = {};
  wallet.getActiveKeyring = () => keyring;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.account = { eth: EthAccountController() };
  mockEmitter.mockImplementation(async ([, method], args = []) => {
    if (method === 'getUserOwnedTokens')
      return assets.getUserOwnedTokens(args[0]);
    if (method === 'saveTokenInfo') return wallet.saveTokenInfo(...args);
    if (method === 'getOnlyMarketData') return null;
    if (method === 'fetchNftTokenIds')
      return { tokens: [], hasMore: false, requiresManualEntry: true };
    throw new Error(`Unexpected controller call: ${method}`);
  });
});

afterEach(() => {
  vaultCache.clearCache();
  global.fetch = originalFetch;
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

const openImportedNftRow = async (
  standard: 'ERC-721' | 'ERC-1155',
  quantity: string
) => {
  discoveredStandard = standard;
  rawBalance = quantity;
  const imported = renderPage(<AddToken />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import EXACT token' })
  );
  await waitFor(() => expect(mockAlerts.success).toHaveBeenCalledTimes(1));
  const saved = store.getState().vault.accountAssets[TYPE][0].ethereum[0];
  expect(saved.balance).toBe(Number(quantity));
  expect(saved.tokenStandard).toBe(standard);
  imported.unmount();

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/home?tab=assets']}>
        <NavigationObserver />
        <NavigationBackControl />
        <Routes>
          <Route
            path="/home"
            element={
              <EvmNftsList
                scope="owned-quantity-navigation"
                state={{
                  isCoinSelected: false,
                  searchValue: '',
                  sortByValue: '',
                }}
              />
            }
          />
          <Route path="/home/details" element={<DetailsView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  const details = await screen.findByRole('button', {
    name: 'View details for EXACT collection',
  });
  const rowQuantity = details
    .closest('li')!
    .querySelector('span.text-brand-white');
  expect(rowQuantity).toHaveTextContent(
    new RegExp(`nftDetails\\.${quantity === '1' ? 'item' : 'items'}$`)
  );
  if (standard === 'ERC-1155')
    expect(rowQuantity).toHaveAttribute('title', quantity);
  fireEvent.click(details);
  await screen.findByRole('button', { name: 'send.viewCollectionItems' });
  expect(routeState.id).toBe(saved.id);
  expect(screen.getByText('NFT Information')).toBeInTheDocument();
};

it.each(['0', '1', '42'])(
  'retains the imported ERC721 quantity %s on asset details',
  async (quantity) => {
    await openImportedNftRow('ERC-721', quantity);
    expect(screen.getByText('Owned').nextElementSibling).toHaveTextContent(
      `${quantity} ${quantity === '1' ? 'NFT' : 'NFTs'}`
    );
  }
);

it.each([
  '0',
  '1',
  '42',
  '9007199254740993',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
])(
  'retains the exact ERC1155 quantity %s through list, asset, collection and Back',
  async (quantity) => {
    await openImportedNftRow('ERC-1155', quantity);
    const checkOwned = () => {
      const owned = screen.getByText('Owned').nextElementSibling!;
      expect(owned).toHaveAttribute('title', quantity);
      expect(owned).toHaveTextContent(
        new RegExp(` ${quantity === '1' ? 'NFT' : 'NFTs'}$`)
      );
      if (quantity.length > 15) {
        expect(owned.textContent).not.toContain(quantity);
        expect(owned.textContent!.length).toBeLessThan(30);
      } else {
        expect(owned).toHaveTextContent(quantity);
      }
    };
    checkOwned();
    fireEvent.click(
      screen.getByRole('button', { name: 'send.viewCollectionItems' })
    );
    expect(screen.getByText(/• ERC-1155/)).toHaveAttribute('title', quantity);
    expect(
      screen.getByText('Amount', { exact: true }).parentElement
    ).toHaveAttribute('title', quantity);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: 'send.viewCollectionItems' });
    checkOwned();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.close' }));
    const details = await screen.findByRole('button', {
      name: 'View details for EXACT collection',
    });
    expect(
      details.closest('li')!.querySelector('span.text-brand-white')
    ).toHaveAttribute('title', quantity);
    fireEvent.click(details);
    await screen.findByRole('button', { name: 'send.viewCollectionItems' });
    checkOwned();
  }
);

it.each([
  { isNft: true, tokenStandard: undefined },
  { isNft: true, tokenStandard: 'ERC-404' },
  { isNft: false, tokenStandard: 'ERC-1155' },
])(
  'does not label unsupported NFT metadata $isNft / $tokenStandard as Owned',
  (asset) => {
    const id = `${CONTRACT}-5700`;
    store.dispatch(
      setAccountAssets({
        accountType: TYPE,
        accountId: 0,
        property: 'ethereum',
        value: [
          {
            id,
            contractAddress: CONTRACT,
            chainId: 5700,
            name: 'Unsupported standard',
            tokenSymbol: 'UNKNOWN',
            balance: 42,
            ...asset,
          },
        ] as any,
      })
    );
    renderPage(<DetailsView />, {
      id,
      walletScope: getWalletNavigationScope(),
    });
    expect(screen.queryByText('Owned')).not.toBeInTheDocument();
  }
);

it.each([
  '0',
  '1',
  '42',
  '9007199254740993',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
  '0'.repeat(100),
  `${'0'.repeat(100)}1`,
  `${'0'.repeat(100)}9007199254740993`,
  `${'0'.repeat(
    20
  )}115792089237316195423570985008687907853269984665640564039457584007913129639935`,
])(
  'retains the exact owned quantity %s through the saved list and collection navigation',
  async (explorerBalance) => {
    const quantity = explorerBalance.replace(/^0+(?=\d)/, '');
    rawBalance = explorerBalance;
    const imported = renderPage(<AddToken />);
    const importButton = await screen.findByRole('button', {
      name: 'Import EXACT token',
    });
    await act(async () => fireEvent.click(importButton));
    await waitFor(() => expect(mockAlerts.success).toHaveBeenCalledTimes(1));
    const saved = store.getState().vault.accountAssets[TYPE][0].ethereum[0];
    expect(saved).toMatchObject({
      balance: Number(quantity),
      rawBalance: explorerBalance,
      chainId: 5700,
      tokenId: '7',
    });
    expect(
      (await loadSlip44State(60)).accountAssets[TYPE][0].ethereum[0]
    ).toEqual(saved);
    imported.unmount();

    const list = renderPage(
      <EvmNftsList
        scope="owned-quantity-list"
        state={{ isCoinSelected: false, searchValue: '', sortByValue: '' }}
      />
    );
    const row = (
      await screen.findByRole('button', {
        name: 'View details for EXACT collection',
      })
    ).closest('li')!;
    const listQuantity = row.querySelector('span.text-brand-white')!;
    expect(
      `${listQuantity.textContent} ${listQuantity.getAttribute('title')}`
    ).toContain(quantity);
    expect(listQuantity).toHaveTextContent(
      quantity === '1' ? 'nftDetails.item' : 'nftDetails.items'
    );
    expect(listQuantity).toHaveAttribute('title', quantity);
    if (quantity.length > 15) {
      expect(listQuantity.textContent!.length).toBeLessThan(40);
      expect(listQuantity.textContent).not.toContain(quantity);
    }
    list.unmount();

    renderPage(<DetailsView />, {
      id: saved.id,
      walletScope: getWalletNavigationScope(),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'send.viewCollectionItems' })
    );
    await waitFor(() => expect(routeState?.nftCollection).toBe(true));
    expect(routeState.nftData.rawBalance).toBe(explorerBalance);
    const header = screen.getByText(/• ERC-1155/);
    const amount = screen.getByText('Amount', { exact: true }).parentElement!;
    const exactValue = (element: HTMLElement) =>
      [
        element.textContent,
        element.title,
        ...Array.from(element.querySelectorAll('[title]')).map((child) =>
          child.getAttribute('title')
        ),
      ].join(' ');
    // Compact visible values are fine if their accessible title retains the
    // exact quantity. A rounded JavaScript integer must not stand in for it.
    expect({ header: exactValue(header), amount: exactValue(amount) }).toEqual({
      header: expect.stringContaining(quantity),
      amount: expect.stringContaining(quantity),
    });
    expect(header).toHaveTextContent(
      quantity === '1' ? 'nftDetails.item •' : 'nftDetails.items •'
    );
    expect(header.title).toBe(quantity);
    expect(amount.title).toBe(quantity);
    if (quantity.length > 15) {
      expect(header.title).toBe(quantity);
      expect(amount.title).toBe(quantity);
      expect(header.textContent).not.toContain(quantity);
      expect(header.textContent!.length).toBeLessThan(50);
      expect(amount.textContent!.length).toBeLessThan(25);
    }
  }
);

it.each([
  ['1', '42'],
  ['9007199254740992', '9007199254740993'],
])(
  'sorts saved NFT quantities %s and %s by their actual balance',
  async (low, high) => {
    rawBalance = [low, high];
    const imported = renderPage(<AddToken />);
    for (const index of [0, 1]) {
      const button = await screen.findByRole('button', {
        name: `Import EXACT${index} token`,
      });
      await act(async () => fireEvent.click(button));
      await waitFor(() =>
        expect(mockAlerts.success).toHaveBeenCalledTimes(index + 1)
      );
    }
    expect(
      store
        .getState()
        .vault.accountAssets[TYPE][0].ethereum.map((asset) => asset.rawBalance)
    ).toEqual([low, high]);
    imported.unmount();
    renderPage(
      <EvmNftsList
        scope="owned-quantity-sorted-list"
        state={{
          isCoinSelected: false,
          searchValue: '',
          sortByValue: 'Balance',
        }}
      />
    );
    expect(
      screen
        .getAllByRole('button', {
          name: /^View details for EXACT\d collection$/,
        })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'View details for EXACT1 collection',
      'View details for EXACT0 collection',
    ]);
  }
);

it.each(['', '-1', '4.2', '1e3', 'NaN', undefined])(
  'does not invent an exact quantity from invalid raw balance %s',
  (raw) => {
    renderPage(
      <NftsDetails
        nftData={{
          name: 'Safe quantity',
          contractAddress: CONTRACT,
          tokenStandard: 'ERC-1155',
          chainId: 5700,
          tokenId: '7',
          balance: 42,
          rawBalance: raw,
        }}
      />
    );
    const header = screen.getByText(/• ERC-1155/);
    const amount = screen.getByText('Amount', { exact: true }).parentElement!;
    expect(header).toHaveTextContent('42 nftDetails.items');
    expect(amount).toHaveTextContent('42Amount');
    expect(header).not.toHaveAttribute('title');
    expect(amount).not.toHaveAttribute('title');
  }
);

it.each([undefined, '', '-1', '4.2', '1e3', 'NaN'])(
  'marks an unsafe quantity unknown when raw balance %s is unusable',
  (raw) => {
    const unsafeBalance = Number('9007199254740993');
    renderPage(
      <NftsDetails
        nftData={{
          name: 'Unknown quantity',
          contractAddress: CONTRACT,
          tokenStandard: 'ERC-1155',
          chainId: 5700,
          tokenId: '7',
          balance: unsafeBalance,
          rawBalance: raw,
        }}
      />
    );
    const header = screen.getByText(/• ERC-1155/);
    const amount = screen.getByText('Amount', { exact: true }).parentElement!;
    expect(header).toHaveTextContent('— nftDetails.items');
    expect(amount).toHaveTextContent('—Amount');
    expect(header).not.toHaveTextContent(String(unsafeBalance));
    expect(header).not.toHaveAttribute('title');
    expect(amount).not.toHaveAttribute('title');
  }
);

it.each([
  '115792089237316195423570985008687907853269984665640564039457584007913129639936',
  '9'.repeat(79),
  '1'.repeat(2049),
  `${'0'.repeat(
    100
  )}115792089237316195423570985008687907853269984665640564039457584007913129639936`,
])('does not accept an out-of-range uint256 quantity', (raw) => {
  const view = renderPage(
    <NftsDetails
      nftData={{
        contractAddress: CONTRACT,
        tokenStandard: 'ERC-1155',
        chainId: 5700,
        balance: 42,
        rawBalance: raw,
      }}
    />
  );
  expect(screen.getByText(/• ERC-1155/)).toHaveTextContent(
    '42 nftDetails.items'
  );
  expect(screen.getByText(/• ERC-1155/)).not.toHaveAttribute('title');
  view.unmount();
  renderPage(
    <NftsDetails
      nftData={{
        contractAddress: CONTRACT,
        tokenStandard: 'ERC-1155',
        chainId: 5700,
        balance: Number(raw),
        rawBalance: raw,
      }}
    />
  );
  expect(screen.getByText(/• ERC-1155/)).toHaveTextContent(
    '— nftDetails.items'
  );
  expect(screen.getByText(/• ERC-1155/)).not.toHaveAttribute('title');
});

it.each([
  ['1e3', 42, 'ERC-1155', '42'],
  [undefined, Number('9007199254740993'), 'ERC-1155', '—'],
  ['9'.repeat(79), 42, 'ERC-1155', '42'],
  ['9'.repeat(79), Number('9'.repeat(79)), 'ERC-1155', '—'],
  ['9007199254740993', 2, 'ERC-721', '2'],
])(
  'keeps list fallback %s / %s / %s without claiming an exact raw quantity',
  (raw, balance, standard, expected) => {
    store.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: TYPE,
        property: 'ethereum',
        value: [
          {
            id: 'fallback-nft',
            contractAddress: CONTRACT,
            chainId: 5700,
            tokenStandard: standard,
            tokenSymbol: 'FALLBACK',
            isNft: true,
            balance,
            rawBalance: raw,
          },
        ] as any,
      })
    );
    renderPage(
      <EvmNftsList
        scope="fallback-quantity-list"
        state={{ isCoinSelected: false, searchValue: '', sortByValue: '' }}
      />
    );
    const quantity = screen
      .getByRole('button', { name: 'View details for FALLBACK collection' })
      .closest('li')!
      .querySelector('span.text-brand-white')!;
    expect(quantity).toHaveTextContent(`${expected} nftDetails.items`);
    expect(quantity).not.toHaveAttribute('title');
  }
);

it('does not reinterpret an ERC721 collection count as an ERC1155 raw quantity', async () => {
  mockEmitter.mockResolvedValue([]);
  renderPage(
    <NftsDetails
      nftData={{
        name: 'ERC721 collection',
        contractAddress: CONTRACT,
        tokenStandard: 'ERC-721',
        chainId: 5700,
        balance: 2,
        rawBalance: '9007199254740993',
      }}
    />
  );
  await act(async () => undefined);
  expect(screen.getByText(/• ERC-721/)).toHaveTextContent('2 nftDetails.items');
  expect(screen.getByText(/• ERC-721/)).not.toHaveAttribute('title');
});
