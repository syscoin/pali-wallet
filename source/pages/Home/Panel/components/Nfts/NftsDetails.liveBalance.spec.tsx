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
import { MemoryRouter, useLocation } from 'react-router-dom';

import { DetailsView } from 'pages/Home/Panel/components/Details';
import { AddToken } from 'pages/Tokens/AddToken';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import MainController from 'scripts/Background/controllers/MainController';
import { walletPersistenceGate } from 'state/paliStorage';
import store from 'state/store';
import { restoreVaultSnapshot, setAccountAssets } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setIsSwitchingAccount,
  setNetworkStatus,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import {
  getWalletNavigationScope,
  loadNavigationState,
  saveNavigationState,
} from 'utils/navigationState';

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
jest.mock('pages/Home/Panel/components/TransactionDetails', () => ({
  TransactionDetails: () => null,
}));

const CONTRACT = `0x${'33'.repeat(20)}`;
const ADDRESS = `0x${'11'.repeat(20)}`;
const TYPE = KeyringAccountType.HDAccount;
const originalChrome = global.chrome;
const originalFetch = global.fetch;
let wallet: any;
let records: Record<string, any>;
let rawBalance: string | string[] = '0';
let testCase = 0;
let routeState: any;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const NavigationObserver = () => {
  routeState = useLocation().state;
  return null;
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
            type: 'ERC-1155',
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
    throw new Error(`Unexpected controller call: ${method}`);
  });
});

afterEach(() => {
  vaultCache.clearCache();
  global.fetch = originalFetch;
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

it.each(
  (['before opening', 'while open', 'import preview'] as const).flatMap(
    (when) =>
      [
        '7',
        '0',
        '9007199254740993',
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      ].map((quantity) => ({ when, quantity }))
  )
)(
  'reflects a real refreshed NFT balance $quantity $when',
  async ({ when, quantity }) => {
    rawBalance = '42';
    const imported = renderPage(<AddToken />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Import EXACT token' })
    );
    await waitFor(() => expect(mockAlerts.success).toHaveBeenCalledTimes(1));
    const saved = store.getState().vault.accountAssets[TYPE][0].ethereum[0];
    imported.unmount();
    const collectionView = renderPage(
      <DetailsView />,
      when === 'import preview'
        ? {
            ...saved,
            isImportPreview: true,
            walletScope: getWalletNavigationScope(),
          }
        : { id: saved.id, walletScope: getWalletNavigationScope() }
    );
    const open = () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'send.viewCollectionItems' })
      );
    if (when !== 'before opening') {
      open();
      expect(screen.getByText(/• ERC-1155/)).toHaveAttribute('title', '42');
      expect(routeState.nftCollection).toBe(true);
    }
    if (when === 'import preview') {
      let restored: Awaited<ReturnType<typeof loadNavigationState>>;
      await act(async () => {
        await saveNavigationState('/home/details', undefined, routeState);
        restored = await loadNavigationState();
      });
      expect(restored!.state.nftData.isImportPreview).toBe(true);
      collectionView.unmount();
      renderPage(<DetailsView />, {
        ...restored!.state,
        walletScope: restored!.walletScope,
      });
    }
    const { Interface } = jest.requireActual('utils/ethersV6Compat');
    const abi = new Interface([
      'function balanceOf(address,uint256) view returns (uint256)',
      'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
    ]);
    const runner = {
      call: async (tx: { data: string }) => {
        const decoded = abi.parseTransaction(tx)!;
        if (decoded.name === 'balanceOf')
          return abi.encodeFunctionResult('balanceOf', [
            decoded.args[1].toString() === '7' ? quantity : '0',
          ]);
        return abi.encodeFunctionResult('balanceOfBatch', [
          Array.from(decoded.args[1], (id: any) =>
            id.toString() === '7' ? quantity : '0'
          ),
        ]);
      },
    };
    const updated = await EvmAssetsController().updateAllEvmTokens(
      store.getState().vault.accounts[TYPE][0],
      5700,
      runner as any,
      [saved]
    );
    expect(updated[0]).toMatchObject({
      rawBalance: quantity,
      tokenId: '7',
    });
    act(() =>
      store.dispatch(
        setAccountAssets({
          accountType: TYPE,
          accountId: 0,
          property: 'ethereum',
          value: updated,
        })
      )
    );
    if (when === 'before opening') open();
    expect(
      store.getState().vault.accountAssets[TYPE][0].ethereum[0].rawBalance
    ).toBe(quantity);
    const expected = when === 'import preview' ? '42' : quantity;
    expect({
      header: screen.getByText(/• ERC-1155/).title,
      amount: screen.getByText('Amount', { exact: true }).parentElement!.title,
    }).toEqual({ header: expected, amount: expected });
  }
);

it.each([
  'removed',
  'different ID',
  'different contract',
  'different chain',
  'non-NFT',
  'different standard',
])(
  'does not retain an owned snapshot after its record is %s',
  async (change) => {
    rawBalance = '42';
    const imported = renderPage(<AddToken />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Import EXACT token' })
    );
    await waitFor(() => expect(mockAlerts.success).toHaveBeenCalledTimes(1));
    const saved = store.getState().vault.accountAssets[TYPE][0].ethereum[0];
    imported.unmount();
    renderPage(<DetailsView />, {
      id: saved.id,
      walletScope: getWalletNavigationScope(),
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'send.viewCollectionItems' })
    );
    expect(screen.getByText(/• ERC-1155/)).toHaveAttribute('title', '42');
    const replacement = { ...saved };
    if (change === 'different ID') replacement.id += '-other';
    if (change === 'different contract')
      replacement.contractAddress = `0x${'44'.repeat(20)}`;
    if (change === 'different chain') replacement.chainId += 1;
    if (change === 'non-NFT') replacement.isNft = false;
    if (change === 'different standard') replacement.tokenStandard = 'ERC-721';
    act(() =>
      store.dispatch(
        setAccountAssets({
          accountId: 0,
          accountType: TYPE,
          property: 'ethereum',
          value: change === 'removed' ? [] : [replacement],
        })
      )
    );
    expect(screen.getByText('Asset not found')).toBeInTheDocument();
    expect(screen.queryByText(/• ERC-1155/)).toBeNull();
    expect(screen.queryByText('Amount', { exact: true })).toBeNull();
  }
);
