/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { getNftStandardMetadata } from '@sidhujag/sysweb3-utils';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import en from 'assets/locales/en.json';
import { EvmAssetDetails } from 'pages/Home/Panel/components/Assets/EvmDetails';
import { EvmNftsList } from 'pages/Home/Panel/components/Nfts/EvmNftsList';
import { NftsDetails } from 'pages/Home/Panel/components/Nfts/NftsDetails';
import { AddToken } from 'pages/Tokens/AddToken';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import vault, {
  createAccount,
  setAccountAssets,
  setNetworkChange,
} from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import {
  initialActiveHdAccountState,
  INetworkType,
  KeyringAccountType,
} from 'types/network';
import { Interface } from 'utils/ethersV6Compat';
import { getNftQuantity, isErc721BalanceAvailable } from 'utils/nftQuantity';

let mockStore: any;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('@sidhujag/sysweb3-utils', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-utils'),
  getNftStandardMetadata: jest.fn((...args: any[]) =>
    jest
      .requireActual('@sidhujag/sysweb3-utils')
      .getNftStandardMetadata(...args)
  ),
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('react-router-dom').useNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const value = key
        .split('.')
        .reduce((item: any, part) => item?.[part], en);
      return typeof value === 'string'
        ? value.replace(/{{(\w+)}}/g, (_match, name) => values[name] ?? '')
        : key;
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  HiTrash: () => null,
  Icon: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  Button: jest.requireActual('components/Button/Button').Button,
  TokenIcon: () => null,
  Icon: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
}));

const OWNER = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const SYMBOL = 'RECOVER';
const ABI = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);
let unavailable: boolean;
let owned: string;
let unexpectedFetches: number;
let reads: Array<{ failed?: boolean; name: string }>;
const actualResults: Array<{ method: string; result: any }> = [];
const originalFetch = globalThis.fetch;
let assetsController: ReturnType<typeof EvmAssetsController>;
const runner = {
  getCode: async (address: string) => {
    expect(address.toLowerCase()).toBe(CONTRACT);
    return '0x6000';
  },
  call: async (transaction: { data: string; to: string }) => {
    expect(transaction.to.toLowerCase()).toBe(CONTRACT);
    const decoded = ABI.parseTransaction(transaction)!;
    if (decoded.name === 'supportsInterface') {
      reads.push({ name: decoded.name });
      return ABI.encodeFunctionResult(decoded.name, [
        decoded.args[0] === '0x80ac58cd',
      ]);
    }
    if (decoded.name === 'name')
      return ABI.encodeFunctionResult(decoded.name, ['Recovery Collection']);
    if (decoded.name === 'symbol')
      return ABI.encodeFunctionResult(decoded.name, [SYMBOL]);
    expect(decoded.name).toBe('balanceOf');
    expect(decoded.args[0].toLowerCase()).toBe(OWNER);
    reads.push({ name: decoded.name, failed: unavailable });
    if (unavailable)
      throw new Error('Synthetic public RPC balance read failed');
    return ABI.encodeFunctionResult('balanceOf', [owned]);
  },
};
const Details = () => {
  const { state } = useLocation();
  return <EvmAssetDetails id={state.id} navigationState={state} />;
};
const importButton = () =>
  screen.getByRole('button', {
    name: en.tokens.importNamedToken.replace('{{symbol}}', SYMBOL),
  });
const holdings = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].ethereum;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  unavailable = false;
  owned = '3';
  unexpectedFetches = 0;
  reads = [];
  actualResults.length = 0;
  globalThis.fetch = jest.fn(async () => {
    unexpectedFetches += 1;
    throw new Error('Unexpected HTTP call');
  });
  mockStore = configureStore({
    reducer: {
      vault,
      vaultGlobal,
      price: (state = { fiat: { asset: 'usd', price: 0 } }) => state,
    },
  });
  mockStore.dispatch(setActiveSlip44(60));
  mockStore.dispatch(
    setNetworkChange({
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 31337,
        slip44: 60,
        label: 'Synthetic EVM',
        currency: 'ETH',
        url: 'https://rpc.synthetic.invalid',
        explorer: 'https://explorer.synthetic.invalid',
      },
    })
  );
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: { ...initialActiveHdAccountState, id: 0, address: OWNER },
    })
  );
  const controller = EvmAssetsController();
  assetsController = controller;
  const account = EthAccountController();
  mockEmitter.mockImplementation(async ([family, method], args) => {
    expect(family).toBe('wallet');
    if (method === 'saveTokenInfo') {
      const commit = await account.prepareTokenAddition(args[0]);
      mockStore.dispatch(commit());
      return;
    }
    if (
      ![
        'getTokenDetailsWithMarketData',
        'validateNftContract',
        'validateERC20Only',
        'getOnlyMarketData',
        'fetchNftTokenIds',
      ].includes(method)
    )
      throw new Error(`Unexpected controller method: ${method}`);
    const result = await (controller[method as keyof typeof controller] as any)(
      ...args,
      ...(method === 'getOnlyMarketData' ? [] : [runner])
    );
    actualResults.push({ method, result });
    return result;
  });
});
afterEach(() => {
  cleanup();
  expect(unexpectedFetches).toBe(0);
  expect(mockAlert.error).not.toHaveBeenCalled();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (originalFetch) globalThis.fetch = originalFetch;
  else Reflect.deleteProperty(globalThis, 'fetch');
});

const ordinaryImportAndPreview = async () => {
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={['/tokens/add?tab=custom']}
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
      >
        <Routes>
          <Route path="/tokens/add" element={<AddToken />} />
          <Route path="/home/details" element={<Details />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
  fireEvent.change(screen.getByLabelText(en.settings.contractAddress), {
    target: { value: CONTRACT },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(importButton()).toBeEnabled();
  expect(actualResults[0]).toMatchObject({
    method: 'getTokenDetailsWithMarketData',
    result: {
      tokenStandard: 'ERC-721',
      isNft: true,
      contractAddress: CONTRACT,
    },
  });
  // Real UI details navigation, not a supplied preview object.
  fireEvent.click(
    screen.getByRole('button', {
      name: en.tokens.viewTokenDetails.replace('{{symbol}}', SYMBOL),
    })
  );
  await act(async () => jest.advanceTimersByTimeAsync(0));
  const ownedText = screen.getByText(en.nftDetails.owned).parentElement!
    .textContent!;
  const hasUnavailable = screen.queryByText(en.settings.unavailable) !== null;
  fireEvent.click(screen.getByRole('button', { name: en.buttons.close }));
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(importButton()).toBeEnabled();
  await act(async () => fireEvent.click(importButton()));
  expect(holdings()).toHaveLength(1);
  expect(holdings()[0]).toMatchObject({
    contractAddress: CONTRACT,
    tokenStandard: 'ERC-721',
    chainId: 31337,
    isNft: true,
  });
  expect(mockAlert.success).toHaveBeenCalledTimes(1);
  return { ownedText, hasUnavailable, storedBalance: holdings()[0].balance };
};

it.each(['0', '3'])(
  'healthy ERC721 balance %s is retained through import and preview',
  async (balance) => {
    owned = balance;
    const evidence = await ordinaryImportAndPreview();
    expect(evidence.ownedText).toContain(`${balance} NFT`);
    expect(evidence.storedBalance).toBe(Number(balance));
    expect(
      reads.some((read) => read.name === 'balanceOf' && !read.failed)
    ).toBe(true);
  }
);

it('does not present an unavailable ERC721 balance read as a confirmed zero owned', async () => {
  unavailable = true;
  const evidence = await ordinaryImportAndPreview();
  expect(reads.some((read) => read.name === 'balanceOf' && read.failed)).toBe(
    true
  );
  expect(
    actualResults.find((result) => result.method === 'validateNftContract')
  ).toBeUndefined();
  console.info(
    'erc721_balance_availability=' +
      JSON.stringify({ ...evidence, reads, actualResults })
  );
  expect(holdings()[0]).not.toHaveProperty('balance');
  expect(evidence.ownedText).toContain(en.settings.unavailable);
  expect({
    claimsOwnedZero: evidence.ownedText.includes('0 NFTs'),
    hasUnavailable: evidence.hasUnavailable,
  }).not.toEqual({ claimsOwnedZero: true, hasUnavailable: false });
});

describe.each([
  'getTokenDetailsWithMarketData',
  'validateNftContract',
] as const)('%s optional ERC721 collection balance', (method) => {
  it.each(['0', '3', 'unavailable'])(
    'retains metadata and exact availability for %s',
    async (balance) => {
      owned = balance === 'unavailable' ? '3' : balance;
      unavailable = balance === 'unavailable';
      const result = await assetsController[method](
        CONTRACT,
        OWNER,
        runner as any
      );
      expect(result).toMatchObject({
        contractAddress: CONTRACT,
        symbol: SYMBOL,
        tokenStandard: 'ERC-721',
        chainId: 31337,
        isNft: true,
      });
      if (unavailable) expect(result).not.toHaveProperty('balance');
      else expect(result).toHaveProperty('balance', Number(balance));
    }
  );
});

it.each(['0', '3', 'unavailable'])(
  'keeps the manual metadata fallback balance %s honest',
  async (balance) => {
    owned = balance === 'unavailable' ? '3' : balance;
    unavailable = balance === 'unavailable';
    // Force only the optional metadata helper to reject. The fallback's name,
    // symbol and balance remain real Contract calls through the same runner.
    jest
      .mocked(getNftStandardMetadata)
      .mockRejectedValueOnce(new Error('Metadata unavailable'));
    const result = await assetsController.validateNftContract(
      CONTRACT,
      OWNER,
      runner as any
    );
    expect(result).toMatchObject({
      name: 'Recovery Collection',
      symbol: SYMBOL,
    });
    if (unavailable) expect(result).not.toHaveProperty('balance');
    else expect(result).toHaveProperty('balance', Number(balance));
  }
);

it('does not reuse a previous observed balance after the next read fails', async () => {
  const first = await assetsController.getTokenDetailsWithMarketData(
    CONTRACT,
    OWNER,
    runner as any
  );
  expect(first).toHaveProperty('balance', 3);
  unavailable = true;
  const second = await assetsController.getTokenDetailsWithMarketData(
    CONTRACT,
    OWNER,
    runner as any
  );
  expect(second).not.toHaveProperty('balance');
  expect(first).toHaveProperty('balance', 3);
});

it('reuses enhanced metadata but not its balance after a same-context failed fresh read', async () => {
  mockStore.dispatch(
    setNetworkChange({
      activeNetwork: {
        ...mockStore.getState().vault.activeNetwork,
        coingeckoPlatformId: 'ethereum',
      },
    })
  );
  globalThis.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        json: async () => ({
          id: 'public-collection',
          ['market_data']: { ['current_price']: { usd: 1 } },
        }),
      } as Response)
  );
  const first = await assetsController.getTokenDetailsWithMarketData(
    CONTRACT,
    OWNER,
    runner as any
  );
  expect(first).toHaveProperty('balance', 3);
  expect(first?.market_data?.current_price?.usd).toBe(1);
  unavailable = true;
  const second = await assetsController.getTokenDetailsWithMarketData(
    CONTRACT,
    OWNER,
    runner as any
  );
  expect(second).not.toHaveProperty('balance');
  expect(second?.market_data?.current_price?.usd).toBe(1);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  [undefined, false],
  [null, false],
  [NaN, false],
  [Infinity, false],
  [-Infinity, false],
  [-1, false],
  ['0', false],
  [0, true],
  [3, true],
])(
  'recognizes supported ERC721 count %p as available=%p',
  (balance, available) => {
    expect(isErc721BalanceAvailable(balance)).toBe(available);
  }
);

it.each(['0', '3'])(
  'preserves an imported unknown through failed refresh and then learns %s',
  async (balance) => {
    unavailable = true;
    const unknown = await assetsController.getTokenDetailsWithMarketData(
      CONTRACT,
      OWNER,
      runner as any
    );
    const add = await EthAccountController().prepareTokenAddition({
      ...unknown!,
      tokenSymbol: SYMBOL,
      decimals: 0,
      isNft: true,
      chainId: 31337,
    });
    mockStore.dispatch(add());
    expect(holdings()[0]).not.toHaveProperty('balance');
    const onBalanceRead = jest.fn();
    const refresh = () =>
      assetsController.updateAllEvmTokens(
        { address: OWNER } as any,
        31337,
        runner as any,
        holdings(),
        onBalanceRead
      );
    const failed = refresh();
    await jest.advanceTimersByTimeAsync(100);
    expect(await failed).toEqual([]);
    expect(onBalanceRead).not.toHaveBeenCalled();
    expect(holdings()[0]).not.toHaveProperty('balance');

    unavailable = false;
    owned = balance;
    const recovery = refresh();
    await jest.advanceTimersByTimeAsync(100);
    const updated = await recovery;
    expect(updated[0]).toMatchObject({
      balance: Number(balance),
      rawBalance: balance,
      contractAddress: CONTRACT,
    });
    mockStore.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        property: 'ethereum',
        value: updated,
      })
    );
    expect(holdings()[0]).toHaveProperty('balance', Number(balance));
    expect(onBalanceRead).toHaveBeenCalledTimes(1);
  }
);

it('keeps unknown collection quantity separate from known zero and ERC1155 exact quantities', () => {
  expect(getNftQuantity({ tokenStandard: 'ERC-721' }).quantity).toBeUndefined();
  expect(
    getNftQuantity({ tokenStandard: 'ERC-721', balance: 0 }).quantity
  ).toBe(0);
  const exact = getNftQuantity({
    tokenStandard: 'ERC-1155',
    rawBalance: '9007199254740993',
    balance: Number.MAX_SAFE_INTEGER,
  });
  expect(exact.exactQuantity).toBe('9007199254740993');
  expect(exact.isSingle).toBe(false);
});

it.each(['list', 'collection'] as const)(
  'renders just localized unavailable for an imported unknown in the %s view, then known zero',
  async (view) => {
    unavailable = true;
    await ordinaryImportAndPreview();
    cleanup();
    const content = () =>
      view === 'list' ? (
        <EvmNftsList
          scope="public-erc721-availability"
          state={{ isCoinSelected: false, searchValue: '', sortByValue: '' }}
        />
      ) : (
        <NftsDetails nftData={holdings()[0]} />
      );
    const tree = () => (
      <Provider store={mockStore}>
        <MemoryRouter
          future={{
            ['v7_startTransition']: true,
            ['v7_relativeSplatPath']: true,
          }}
        >
          {content()}
        </MemoryRouter>
      </Provider>
    );
    const rendered = render(tree());
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(
      screen.getAllByText(en.settings.unavailable, { exact: true }).length
    ).toBeGreaterThan(0);
    expect(rendered.container.textContent).not.toContain(
      `${en.settings.unavailable} ${en.nftDetails.items}`
    );
    expect(rendered.container.textContent).not.toContain(
      `0 ${en.nftDetails.items}`
    );
    mockStore.dispatch(
      setAccountAssets({
        accountId: 0,
        accountType: KeyringAccountType.HDAccount,
        property: 'ethereum',
        value: [{ ...holdings()[0], balance: 0 }],
      })
    );
    rendered.rerender(tree());
    expect(
      screen.getByText(`0 ${en.nftDetails.items}`, { exact: view === 'list' })
    ).toBeVisible();
  }
);
