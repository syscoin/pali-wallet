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

import en from 'assets/locales/en.json';
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

let mockStore: any;
let mockAssets: ReturnType<typeof SysAssetsController>;
let mockAccount: ReturnType<typeof SysAccountController>;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const originalFetch = globalThis.fetch;
const originalUint8Array = globalThis.Uint8Array;
const originalSetImmediate = globalThis.setImmediate;
const originalClearImmediate = globalThis.clearImmediate;
let clearFetchBackendAccountCache: typeof import('scripts/Background/controllers/utils/fetchBackendAccountWrapper').clearFetchBackendAccountCache;
const reads: Array<{
  guid?: string;
  path: string;
  query: string;
  returnedGuid?: string;
}> = [];
const savedPayloads: ITokenSysProps[] = [];

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
      const dictionary = jest.requireActual('assets/locales/en.json');
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
  label: 'Public GUID identity fixture',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const GUID = '123';
const PADDED_GUID = '000123';
const ZERO_GUID = '456';
const UINT64_MAX_GUID = '18446744073709551615';
const balanceRow = {
  assetGuid: GUID,
  symbol: 'ALIAS',
  decimals: 2,
  balance: '2500',
  unconfirmedBalance: '0',
  totalReceived: '2500',
  totalSent: '0',
  transfers: 1,
  type: 'SPTAllocated',
};
let fixtureHoldings: (typeof balanceRow)[];
let metadataGuidOverride: string | undefined;
const metadataByGuid: Record<string, { decimals: number; symbol: string }> = {
  [GUID]: { symbol: 'ALIAS', decimals: 2 },
  [ZERO_GUID]: { symbol: 'ZERO', decimals: 2 },
  '0': { symbol: 'ZERO', decimals: 2 },
  [UINT64_MAX_GUID]: { symbol: 'MAX', decimals: 0 },
};

// Actual installed SDK calls reach this public HTTP response boundary. The
// metadata route matches Blockbook GetAsset: base-10 uint64 lookup accepts a
// padded path and echoes that path spelling in AssetGuid. Account inventory
// emits canonical decimal GUIDs from uint64 keys. No account/SDK result is
// replaced, and no private key or signing operation is available.
const backendReply = (input: string) => {
  const url = new URL(input);
  expect(url.origin).toBe(new URL(NETWORK.url).origin);
  const asset = url.pathname.match(/^\/api\/v2\/asset\/(\d+)$/);
  if (asset) {
    const guid = asset[1];
    const numeric = BigInt(guid).toString();
    expect(Object.keys(metadataByGuid)).toContain(numeric);
    expect(url.searchParams.get('details')).toBe('basic');
    const returnedGuid = metadataGuidOverride ?? guid;
    reads.push({ path: url.pathname, query: url.search, guid, returnedGuid });
    return {
      asset: {
        assetGuid: returnedGuid,
        ...metadataByGuid[numeric],
        maxSupply: '1000000',
        totalSupply: '1000000',
        metaData: '',
        transactions: 1,
      },
    };
  }
  expect(url.pathname).toBe(
    `/api/v2/xpub/${encodeURIComponent(PUBLIC_ACCOUNT.xpub)}`
  );
  expect(url.searchParams.get('details')).toBe('tokenBalances');
  expect(['nonzero', 'used']).toContain(url.searchParams.get('tokens'));
  reads.push({ path: url.pathname, query: url.search });
  return {
    address: PUBLIC_ACCOUNT.xpub,
    balance: '0',
    unconfirmedBalance: '0',
    totalReceived: '0',
    totalSent: '0',
    txs: 1,
    unconfirmedTxs: 0,
    tokensAsset: fixtureHoldings.map((holding) => ({ ...holding })),
  };
};

const assets = (): ITokenSysProps[] =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin;
const expectSuccess = async (symbol: string) => {
  const message = en.tokens.hasBeenAddedToYourWallet.replace(
    '{{token}}',
    symbol
  );
  await waitFor(() => {
    const feedback = screen.getByText(message, { exact: true });
    expect(feedback).toBeVisible();
    expect(feedback.closest('[role="status"]')).not.toBeNull();
  });
};

const button = (symbol = 'ALIAS') =>
  screen.getByRole('button', {
    name: en.tokens.importNamedToken.replace('{{symbol}}', symbol),
  }) as HTMLButtonElement;
const previewBalance = (symbol = 'ALIAS') =>
  button(symbol)
    .closest('li')!
    .querySelector('span.text-brand-white.font-medium')!.textContent;
const mount = () => {
  render(
    <Provider store={mockStore}>
      <MemoryRouter
        initialEntries={['/tokens/add?tab=custom']}
        future={{
          ['v7_startTransition']: true,
          ['v7_relativeSplatPath']: true,
        }}
      >
        <AddToken />
      </MemoryRouter>
    </Provider>
  );
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
};
const enter = async (
  user: ReturnType<typeof userEvent.setup>,
  value: string
) => {
  const input = screen.getByRole('textbox', { name: en.tokens.assetGuid });
  await user.clear(input);
  await user.type(input, value);
  await act(async () => jest.advanceTimersByTimeAsync(500));
};
const refresh = () =>
  mockAssets.getSysAssetsByXpub(
    PUBLIC_ACCOUNT.xpub,
    NETWORK.url,
    NETWORK.chainId,
    assets()
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // Load the real SDK only after aligning jsdom's byte-array realm with Node.
  // Its ECC self-test must see Node Buffers as Uint8Arrays; no SDK validation,
  // controller implementation, or result is substituted.
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
  globalThis.setImmediate = jest.requireActual('timers').setImmediate;
  globalThis.clearImmediate = jest.requireActual('timers').clearImmediate;
  const SysAssetsController = jest.requireActual(
    'scripts/Background/controllers/assets/syscoin'
  )
    .default as typeof import('scripts/Background/controllers/assets/syscoin').default;
  const SysAccountController = jest.requireActual(
    'scripts/Background/controllers/account/syscoin'
  )
    .default as typeof import('scripts/Background/controllers/account/syscoin').default;
  ({ clearFetchBackendAccountCache } = jest.requireActual(
    'scripts/Background/controllers/utils/fetchBackendAccountWrapper'
  ));
  clearFetchBackendAccountCache();
  reads.length = 0;
  savedPayloads.length = 0;
  fixtureHoldings = [{ ...balanceRow }];
  metadataGuidOverride = undefined;
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: PUBLIC_ACCOUNT,
    })
  );
  jest.spyOn(axios, 'get').mockImplementation(async (url) => ({
    data: backendReply(String(url)),
    status: 200,
  }));
  globalThis.fetch = jest.fn(async (input, init) => {
    expect(init?.method ?? 'GET').toBe('GET');
    const data = backendReply(String(input));
    return { ok: true, status: 200, json: async () => data } as Response;
  });
  mockAssets = SysAssetsController();
  mockAccount = SysAccountController(() => {
    throw new Error('No keyring/signing operation is allowed');
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

it('healthy canonical GUID keeps its exact held balance through the real form, SDK and account updater', async () => {
  const user = mount();
  await enter(user, GUID);
  expect(previewBalance()).toBe('25');
  await user.click(button());
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  expect(assets()[0]).toMatchObject({
    assetGuid: GUID,
    balance: '25.0',
    chainId: NETWORK.chainId,
  });
  expect(button()).toBeDisabled();
  expect((await refresh())[0]).toMatchObject({
    assetGuid: GUID,
    balance: '25.0',
  });
  expect(reads.some((read) => read.guid === GUID)).toBe(true);
  await expectSuccess('ALIAS');
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('healthy valid unowned GUID remains a zero-balance watch import', async () => {
  const user = mount();
  await enter(user, ZERO_GUID);
  expect(previewBalance('ZERO')).toBe('0');
  await user.click(button('ZERO'));
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  expect(assets()[0]).toMatchObject({ assetGuid: ZERO_GUID, balance: '0' });
  expect((await refresh())[0]).toMatchObject({
    assetGuid: ZERO_GUID,
    balance: '0',
  });
  await expectSuccess('ZERO');
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('uses numeric GUID identity for a padded input instead of importing a false zero-balance alias', async () => {
  const user = mount();
  await enter(user, PADDED_GUID);
  const preview = previewBalance();
  await user.click(button());
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  const refreshed = await refresh();
  const observation = {
    requestedGuids: reads.filter((read) => read.guid).map((read) => read.guid),
    preview,
    saved: savedPayloads[0],
    stored: assets()[0],
    refreshed: refreshed[0],
  };
  console.info('spt_guid_alias_balance=' + JSON.stringify(observation));
  await expectSuccess('ALIAS');
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect({
    preview,
    storedGuid: assets()[0].assetGuid,
    storedBalance: assets()[0].balance,
    refreshedBalance: refreshed[0].balance,
  }).toEqual({
    preview: '25',
    storedGuid: GUID,
    storedBalance: '25.0',
    refreshedBalance: '25.0',
  });
});

it('does not add the same numeric asset twice when its padded spelling follows a canonical import', async () => {
  const user = mount();
  await enter(user, GUID);
  await user.click(button());
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  expect(button()).toBeDisabled();
  await enter(user, PADDED_GUID);
  const aliasWasDisabled = button().disabled;
  if (!aliasWasDisabled) {
    await user.click(button());
    await act(async () => undefined);
  }
  console.info(
    'spt_guid_alias_duplicate=' +
      JSON.stringify({ aliasWasDisabled, savedPayloads, assets: assets() })
  );
  expect(
    assets().filter((asset) => BigInt(asset.assetGuid!).toString() === GUID)
  ).toHaveLength(1);
  expect(assets().map((asset) => asset.assetGuid)).toEqual([GUID]);
});

it.each(['0', '0000'])(
  'keeps the all-zero GUID %s as canonical zero through actual import and refresh',
  async (inputGuid) => {
    const user = mount();
    await enter(user, inputGuid);
    expect(previewBalance('ZERO')).toBe('0');
    await user.click(button('ZERO'));
    await act(async () => undefined);
    expect(assets()).toHaveLength(1);
    expect(savedPayloads[0].assetGuid).toBe('0');
    expect(assets()[0]).toMatchObject({ assetGuid: '0', balance: '0' });
    expect((await refresh())[0]).toMatchObject({
      assetGuid: '0',
      balance: '0',
    });
    expect(reads.filter((read) => read.guid).map((read) => read.guid)).toEqual([
      '0',
    ]);
    expect(button('ZERO')).toBeDisabled();
    await expectSuccess('ZERO');
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('preserves a padded uint64 maximum as an exact decimal string without numeric rounding', async () => {
  fixtureHoldings.push({
    ...balanceRow,
    assetGuid: UINT64_MAX_GUID,
    symbol: 'MAX',
    decimals: 0,
    balance: '7',
    totalReceived: '7',
  });
  const user = mount();
  await enter(user, `000${UINT64_MAX_GUID}`);
  expect(previewBalance('MAX')).toBe('7');
  await user.click(button('MAX'));
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  expect(savedPayloads[0].assetGuid).toBe('18446744073709551615');
  expect(assets()[0]).toMatchObject({
    assetGuid: '18446744073709551615',
    balance: '7',
  });
  expect((await refresh())[0]).toMatchObject({
    assetGuid: '18446744073709551615',
    balance: '7',
  });
  expect(reads.filter((read) => read.guid).map((read) => read.guid)).toEqual([
    '18446744073709551615',
  ]);
  expect(button('MAX')).toBeDisabled();
  await expectSuccess('MAX');
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('rejects malformed direct-controller GUIDs before any metadata or account HTTP read', async () => {
  const malformed = [
    '',
    ' ',
    ' 123 ',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x7b',
    '12 3',
    'abc',
  ];
  const errors = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  for (const guid of malformed) {
    await expect(
      mockAssets.validateSPTOnly(guid, PUBLIC_ACCOUNT.xpub, NETWORK.url)
    ).resolves.toBeNull();
  }
  expect(errors).toHaveBeenCalledTimes(malformed.length);
  expect(reads).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(axios.get).not.toHaveBeenCalled();
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(savedPayloads).toEqual([]);
  expect(assets()).toEqual([]);
});

it('does not let a different GUID in HTTP metadata replace the canonical requested identity', async () => {
  metadataGuidOverride = ZERO_GUID;
  const user = mount();
  await enter(user, PADDED_GUID);
  expect(previewBalance()).toBe('25');
  expect(reads.filter((read) => read.guid)).toEqual([
    {
      path: `/api/v2/asset/${GUID}`,
      query: '?details=basic',
      guid: GUID,
      returnedGuid: ZERO_GUID,
    },
  ]);
  await user.click(button());
  await act(async () => undefined);
  expect(assets()).toHaveLength(1);
  expect(savedPayloads[0].assetGuid).toBe(GUID);
  expect(assets()[0]).toMatchObject({ assetGuid: GUID, balance: '25.0' });
  expect((await refresh())[0]).toMatchObject({
    assetGuid: GUID,
    balance: '25.0',
  });
  await expectSuccess('ALIAS');
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it.each([
  [GUID, PADDED_GUID],
  [PADDED_GUID, GUID],
])(
  'shares one canonical metadata cache path for %s followed by %s',
  async (first, second) => {
    const user = mount();
    await enter(user, first);
    expect(previewBalance()).toBe('25');
    await enter(user, second);
    expect(previewBalance()).toBe('25');
    expect(button()).toBeEnabled();
    expect(reads.filter((read) => read.guid).map((read) => read.guid)).toEqual([
      GUID,
    ]);
    expect(assets()).toEqual([]);
    expect(savedPayloads).toEqual([]);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        en.tokens.hasBeenAddedToYourWallet.replace('{{token}}', 'ALIAS'),
        { exact: true }
      )
    ).not.toBeInTheDocument();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);
