/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import type SysAccountController from 'scripts/Background/controllers/account/syscoin';
import type SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import vault, { createAccount, setNetworkChange } from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import type { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';
import { getWalletNavigationScope } from 'utils/navigationState';

import { AddToken } from './AddToken';

jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');

type InventoryMode = 'held' | 'empty' | 'unavailable';
const locales = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh'];
let mockLocale = 'en';
let inventoryMode: InventoryMode;
let mockStore: any;
let mockAssets: ReturnType<typeof SysAssetsController>;
let mockAccount: ReturnType<typeof SysAccountController>;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const savedPayloads: ITokenSysProps[] = [];
const reads: Array<{ path: string; query: string; status: number }> = [];
const originalFetch = globalThis.fetch;
const originalUint8Array = globalThis.Uint8Array;
const originalSetImmediate = globalThis.setImmediate;
const originalClearImmediate = globalThis.clearImmediate;
let clearFetchBackendAccountCache: typeof import('scripts/Background/controllers/utils/fetchBackendAccountWrapper').clearFetchBackendAccountCache;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const dictionary = jest.requireActual(
        `assets/locales/${mockLocale}.json`
      );
      const value = key
        .split('.')
        .reduce((current: any, part) => current?.[part], dictionary);
      return typeof value === 'string'
        ? value.replace(/{{(\w+)}}/g, (_match, name) => values[name] ?? '')
        : key;
    },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
}));

const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const PUBLIC_ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'Public balance availability fixture',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const GUID = '123';
const SYMBOL = 'BALANCE';
const holding = {
  assetGuid: GUID,
  symbol: SYMBOL,
  decimals: 2,
  balance: '2500',
  unconfirmedBalance: '0',
  totalReceived: '2500',
  totalSent: '0',
  transfers: 1,
  type: 'SPTAllocated',
};

// Replace only HTTP responses. In particular, the installed SDK decides what
// an HTTP 500 means; no validation result or controller account DTO is mocked.
const httpReply = (input: string) => {
  const url = new URL(input);
  expect(url.origin).toBe(new URL(NETWORK.url).origin);
  if (url.pathname === `/api/v2/asset/${GUID}`) {
    expect(url.searchParams.get('details')).toBe('basic');
    reads.push({ path: url.pathname, query: url.search, status: 200 });
    return {
      status: 200,
      data: {
        asset: {
          assetGuid: GUID,
          symbol: SYMBOL,
          decimals: 2,
          maxSupply: '1000000',
          totalSupply: '1000000',
          metaData: '',
          transactions: 1,
        },
      },
    };
  }
  expect(url.pathname).toBe(
    `/api/v2/xpub/${encodeURIComponent(PUBLIC_ACCOUNT.xpub)}`
  );
  expect(url.searchParams.get('details')).toBe('tokenBalances');
  expect(['nonzero', 'used']).toContain(url.searchParams.get('tokens'));
  const status = inventoryMode === 'unavailable' ? 500 : 200;
  reads.push({ path: url.pathname, query: url.search, status });
  return {
    status,
    data:
      status === 500
        ? { error: 'Synthetic inventory HTTP failure' }
        : {
            address: PUBLIC_ACCOUNT.xpub,
            balance: '0',
            unconfirmedBalance: '0',
            totalReceived: '0',
            totalSent: '0',
            txs: 1,
            unconfirmedTxs: 0,
            tokensAsset: inventoryMode === 'held' ? [{ ...holding }] : [],
          },
  };
};

const initializeFixture = (mode: InventoryMode) => {
  cleanup();
  clearFetchBackendAccountCache();
  inventoryMode = mode;
  reads.length = 0;
  savedPayloads.length = 0;
  mockAlert.error.mockClear();
  mockAlert.success.mockClear();
  const createAssets = jest.requireActual(
    'scripts/Background/controllers/assets/syscoin'
  ).default as typeof SysAssetsController;
  const createAccountController = jest.requireActual(
    'scripts/Background/controllers/account/syscoin'
  ).default as typeof SysAccountController;
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: PUBLIC_ACCOUNT,
    })
  );
  mockAssets = createAssets();
  mockAccount = createAccountController(() => {
    throw new Error('No keyring/signing operation is allowed');
  });
};

const assets = (): ITokenSysProps[] =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin;
const copy = (key: string) =>
  key
    .split('.')
    .reduce(
      (value: any, part) => value[part],
      jest.requireActual(`assets/locales/${mockLocale}.json`)
    ) as string;
const action = () =>
  screen.getByRole('button', {
    name: copy('tokens.importNamedToken').replace('{{symbol}}', SYMBOL),
  });
const preview = () => {
  const row = action().closest('li')!;
  return {
    balance: row.querySelector('span.text-brand-white.font-medium')!
      .textContent,
    rowText: row.textContent?.replace(/\s+/g, ' ').trim(),
    titles: Array.from(row.querySelectorAll('[title]')).map((element) =>
      element.getAttribute('title')
    ),
    accessibility: Array.from(
      row.querySelectorAll('[role], [aria-label], [aria-description]')
    ).map((element) => ({
      role: element.getAttribute('role'),
      label: element.getAttribute('aria-label'),
      description: element.getAttribute('aria-description'),
    })),
    alerts: screen
      .queryAllByRole('alert')
      .map((element) => element.textContent),
  };
};
const mount = () => {
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
        <AddToken />
      </MemoryRouter>
    </Provider>
  );
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
};
const observeImport = async (mode: InventoryMode) => {
  initializeFixture(mode);
  const user = mount();
  await user.type(
    screen.getByRole('textbox', { name: copy('tokens.assetGuid') }),
    GUID
  );
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(action()).toBeEnabled();
  const before = preview();
  await user.click(action());
  await act(async () => undefined);
  expect(action()).toBeDisabled();
  expect(assets()).toHaveLength(1);
  expect(savedPayloads).toHaveLength(1);
  expect(savedPayloads[0].assetGuid).toBe(GUID);
  expect(assets()[0].assetGuid).toBe(GUID);
  await waitFor(() => {
    const success = screen.getByText(
      copy('tokens.hasBeenAddedToYourWallet').replace('{{token}}', SYMBOL),
      { exact: true }
    );
    expect(success).toBeVisible();
    expect(success.closest('[role="status"]')).not.toBeNull();
  });
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(reads.some((read) => read.path === `/api/v2/asset/${GUID}`)).toBe(
    true
  );
  expect(reads.some((read) => read.path.includes('/xpub/'))).toBe(true);
  return {
    before,
    stored: { ...assets()[0] },
    saved: { ...savedPayloads[0] },
    reads: reads.map((read) => ({ ...read })),
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLocale = 'en';
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
  globalThis.setImmediate = jest.requireActual('timers').setImmediate;
  globalThis.clearImmediate = jest.requireActual('timers').clearImmediate;
  ({ clearFetchBackendAccountCache } = jest.requireActual(
    'scripts/Background/controllers/utils/fetchBackendAccountWrapper'
  ));
  jest.spyOn(axios, 'get').mockImplementation(async (url) => {
    const reply = httpReply(String(url));
    if (reply.status !== 200)
      throw new Error('Synthetic HTTP 500 inventory unavailable');
    return { data: reply.data, status: reply.status };
  });
  globalThis.fetch = jest.fn(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET');
    const reply = httpReply(String(input));
    return {
      ok: reply.status === 200,
      status: reply.status,
      statusText: reply.status === 200 ? 'OK' : 'Synthetic server error',
      json: async () => reply.data,
    } as Response;
  });
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens')
      return mockAssets.getUserOwnedTokens(PUBLIC_ACCOUNT.xpub);
    if (method === 'validateSPTOnly')
      return mockAssets.validateSPTOnly(args[0], args[1], NETWORK.url);
    if (method === 'saveTokenInfo') {
      expect(args[1]).toEqual(getWalletNavigationScope());
      const mutation = await mockAccount.prepareTokenAddition(args[0]);
      savedPayloads.push({ ...args[0] });
      mockStore.dispatch(mutation());
      return;
    }
    throw new Error(`No other controller operation is allowed: ${method}`);
  });
});
afterEach(() => {
  cleanup();
  clearFetchBackendAccountCache();
  expect(
    mockEmitter.mock.calls.every(([[, method]]) =>
      ['getUserOwnedTokens', 'validateSPTOnly', 'saveTokenInfo'].includes(
        method
      )
    )
  ).toBe(true);
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.Uint8Array = originalUint8Array;
  globalThis.setImmediate = originalSetImmediate;
  globalThis.clearImmediate = originalClearImmediate;
  if (originalFetch) globalThis.fetch = originalFetch;
  else Reflect.deleteProperty(globalThis, 'fetch');
});

it('healthy held inventory shows and imports the exact current balance', async () => {
  const result = await observeImport('held');
  expect(result.before.balance).toBe('25');
  expect(result.saved.balance).toBe('25.0');
  expect(result.stored.balance).toBe('25.0');
  expect(result.reads.every((read) => read.status === 200)).toBe(true);
});

it('healthy complete empty inventory still permits a genuine zero-balance import', async () => {
  const result = await observeImport('empty');
  expect(result.before.balance).toBe('0');
  expect(result.saved.balance).toBe('0');
  expect(result.stored.balance).toBe('0');
  expect(result.reads.every((read) => read.status === 200)).toBe(true);
});

it('healthy manual import stays available during holdings failure and later recovers through a real refresh', async () => {
  const result = await observeImport('unavailable');
  expect(result.reads.some((read) => read.status === 500)).toBe(true);
  expect(result.saved).not.toHaveProperty('balance');
  expect(result.stored).not.toHaveProperty('balance');
  inventoryMode = 'held';
  clearFetchBackendAccountCache();
  const refreshed = await mockAssets.getSysAssetsByXpub(
    PUBLIC_ACCOUNT.xpub,
    NETWORK.url,
    NETWORK.chainId,
    assets()
  );
  expect(refreshed).toHaveLength(1);
  expect(refreshed[0]).toMatchObject({ assetGuid: GUID, balance: '25.0' });
});

it('distinguishes unavailable holdings from a confirmed empty inventory without blocking manual import', async () => {
  const empty = await observeImport('empty');
  const unavailable = await observeImport('unavailable');
  expect(empty.reads.every((read) => read.status === 200)).toBe(true);
  expect(unavailable.reads.some((read) => read.status === 500)).toBe(true);
  console.info(
    'spt_balance_availability=' +
      JSON.stringify({ empty, unavailable, durableStorageTested: false })
  );
  // This is solely a balance-availability comparison. Both genuine empty and
  // unavailable inventory have already passed the ordinary manual import.
  expect(unavailable.before).not.toEqual(empty.before);
  expect(unavailable.before.balance).toBe(copy('settings.unavailable'));
  expect(unavailable.saved).not.toHaveProperty('balance');
  expect(unavailable.stored).not.toHaveProperty('balance');
});

it.each(locales)(
  'keeps offline import available with localized unavailable balance in %s',
  async (locale) => {
    mockLocale = locale;
    const result = await observeImport('unavailable');
    expect(result.before.balance).toBe(copy('settings.unavailable'));
    expect(result.before.rowText).toContain(GUID);
    expect(result.saved).not.toHaveProperty('balance');
    expect(result.stored).not.toHaveProperty('balance');
  }
);

it.each([
  { balance: 0, expected: '—' },
  { balance: '0', expected: '0' },
  { balance: '25.0', expected: '25' },
])(
  'preserves the shared EVM list balance display for $balance',
  ({ balance, expected }) => {
    const { ImportableAssetsList } = jest.requireActual(
      'components/ImportableAssetsList'
    );
    render(
      <ImportableAssetsList
        assetType="evm"
        assets={[
          { id: 'public-evm-token', symbol: 'EVM', balance, decimals: 2 },
        ]}
        currentlyImporting={null}
        importedAssetIds={new Set()}
        isLoading={false}
        onDetailsClick={jest.fn()}
        onImport={jest.fn(async () => undefined)}
      />
    );
    expect(screen.getByText(expected, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(copy('settings.unavailable'))).toBeNull();
  }
);
