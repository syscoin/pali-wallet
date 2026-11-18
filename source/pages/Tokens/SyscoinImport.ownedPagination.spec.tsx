/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { AddToken } from 'pages/Tokens/AddToken';
import SysAccountController from 'scripts/Background/controllers/account/syscoin';
import SysAssetsController from 'scripts/Background/controllers/assets/syscoin';
import MainController from 'scripts/Background/controllers/MainController';
import vaultReducer, {
  setAccountAssets,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { KeyringAccountType } from 'types/network';
import type { ITokenSysProps } from 'types/tokens';

let mockStore: any;
let mockAssets: ReturnType<typeof SysAssetsController>;
let mockAccount: ReturnType<typeof SysAccountController>;
const mockFetch = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({
    fetchBackendAccountCached: (...args: any[]) => mockFetch(...args),
  })
);
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      key === 'tokens.importNamedToken'
        ? `Import ${values?.symbol} token`
        : key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  getCurrentTab: jest.requireActual('utils/navigationState').getCurrentTab,
  createBrowsingNavigationContext: jest.requireActual('utils/navigationState')
    .createBrowsingNavigationContext,
  navigateWithContext: jest.requireActual('utils/navigationState')
    .navigateWithContext,
}));
jest.mock('utils/tokens', () => ({
  getTokenLogo: () => '',
  getTokenTypeBadgeColor: () => '',
}));

const token = (index: number) => ({
  assetGuid: String(1000 + index),
  symbol: `SPT${index}`,
  name: `SPT token ${index}`,
  decimals: 8,
  balance: '100000000',
  unconfirmedBalance: '0',
  totalReceived: '100000000',
  totalSent: '0',
  transfers: 1,
  type: 'SPTAllocated',
});

const importedTokens = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].syscoin;
const importButtons = () =>
  screen.getAllByRole('button', { name: /^Import SPT\d+ token$/ });
const importButton = (index: number) =>
  screen.queryByRole('button', { name: `Import SPT${index} token` });
const discoveryCalls = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'getUserOwnedTokens'
  );
const publicDiscovery = (address = 'public-address') =>
  MainController.prototype.getUserOwnedTokens.call(
    { assetsManager: { sys: mockAssets } } as any,
    address
  );
const publish = async (tokens: ITokenSysProps[], accountId = 0) => {
  await act(async () =>
    mockStore.dispatch(
      setAccountAssets({
        accountType: KeyringAccountType.HDAccount,
        accountId,
        property: 'syscoin',
        value: tokens,
      })
    )
  );
};
const saved = (index: number) => ({ ...token(index), chainId: 5700 });
const Navigation = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/home')}>Leave discovery</button>
      <button onClick={() => navigate('/tokens/add?tab=owned')}>
        Reopen discovery
      </button>
    </>
  );
};
const tree = () => (
  <Provider store={mockStore}>
    <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
      <Routes>
        <Route path="/tokens/add" element={<AddToken />} />
        <Route path="/home" element={null} />
      </Routes>
      <Navigation />
    </MemoryRouter>
  </Provider>
);
const mount = async (count: number, duplicateLast = false) => {
  const tokens = Array.from({ length: count }, (_, index) => token(index + 1));
  if (duplicateLast) tokens[tokens.length - 1] = token(count - 1);
  mockFetch.mockResolvedValue({ address: 'public-xpub', tokensAsset: tokens });
  const view = render(tree());
  await act(async () => undefined);
  expect(mockFetch).toHaveBeenCalledWith(
    'https://blockbook.synthetic.invalid/',
    'public-xpub',
    'details=tokenBalances&tokens=nonzero',
    true
  );
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  const initial = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: true,
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 5700,
          slip44: 1,
          url: 'https://blockbook.synthetic.invalid/',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: { id: 0, address: 'public-address', xpub: 'public-xpub' },
            1: { id: 1, address: 'other-address', xpub: 'other-xpub' },
          },
        },
        accountAssets: {
          ...initial.accountAssets,
          HDAccount: { 0: { syscoin: [], ethereum: [] } },
        },
      } as any,
      vaultGlobal: {
        ...vaultGlobalReducer(undefined, { type: 'test/init' }),
        activeSlip44: 1,
      },
    },
  });
  mockAssets = SysAssetsController();
  mockAccount = SysAccountController(() => {
    throw Error('No keyring operation is permitted');
  });
  mockEmitter.mockImplementation(async ([, method]: string[], args: any[]) => {
    if (method === 'getUserOwnedTokens') return publicDiscovery(args[0]);
    if (method === 'saveTokenInfo') {
      const addition = await mockAccount.prepareTokenAddition(args[0]);
      mockStore.dispatch(addition());
      return;
    }
    throw Error(`Unexpected controller method ${method}`);
  });
});
afterEach(() => jest.restoreAllMocks());

it('initial discovery keeps the saved GUID hidden and the other healthy producer row eligible', async () => {
  await publish([saved(1)]);
  await mount(2);
  expect(importButton(1)).toBeNull();
  expect(importButton(2)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
  const raw = await publicDiscovery('ignored-when-UTXO');
  expect(raw.map((row) => row.assetGuid)).toEqual(['1001', '1002']);
  expect(raw.map((row) => row.balance)).toEqual(['1.0', '1.0']);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('projects a live saved-B publication without losing the retained A producer row or refetching', async () => {
  await mount(2);
  await publish([saved(2)]);
  expect(importButton(1)).toBeEnabled();
  expect(importButton(2)).toBeNull();
  expect(discoveryCalls()).toHaveLength(1);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('restores an initially saved GUID after another document removes it, through tabs and route reentry', async () => {
  await publish([saved(1)]);
  await mount(2);
  await publish([]);
  expect(importButton(1)).toBeEnabled();
  expect(importButton(2)).toBeEnabled();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'tokens.addCustomTab' }))
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'tokens.yourTokens' }))
  );
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Leave discovery' }))
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Reopen discovery' }))
  );
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(2);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('restores an initially unsaved GUID after external save then removal without remounting', async () => {
  await mount(2);
  await publish([saved(1)]);
  expect(importButton(1)).toBeNull();
  await publish([]);
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it('preserves the producer cache through saved-list changes and refreshes at its exact five-minute boundary', async () => {
  let clock = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  await publish([saved(1)]);
  await mount(2);
  await publish([]);
  clock = 299999;
  expect((await publicDiscovery()).map((row) => row.assetGuid)).toEqual([
    '1001',
    '1002',
  ]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  clock = 300000;
  expect((await publicDiscovery()).map((row) => row.assetGuid)).toEqual([
    '1001',
    '1002',
  ]);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

it('keeps unsupported non-SPT discovery empty without backend work', async () => {
  mockStore.dispatch(
    setActiveNetwork({
      ...mockStore.getState().vault.activeNetwork,
      chainId: 0,
    })
  );
  expect(await publicDiscovery()).toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('retires the local Added mask after its actual save is published and another document removes it', async () => {
  await mount(2);
  await act(async () => fireEvent.click(importButton(1)!));
  expect(importButton(1)).toBeDisabled();
  await publish([]);
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it('keeps a delayed-publication success disabled across tabs and unrelated inventory updates', async () => {
  await mount(2);
  const get = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'saveTokenInfo' ? Promise.resolve() : get(path, args)
  );
  await act(async () => fireEvent.click(importButton(1)!));
  expect(importButton(1)).toBeDisabled();
  await publish([saved(2)]);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'tokens.addCustomTab' }))
  );
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'tokens.yourTokens' }))
  );
  expect(importButton(1)).toBeDisabled();
  await act(async () => fireEvent.click(importButton(1)!));
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'saveTokenInfo')
  ).toHaveLength(1);
  await publish([saved(1), saved(2)]);
  await publish([saved(2)]);
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it('does not resurrect a stale optimistic mark when save acknowledgement follows observed publication and removal', async () => {
  await mount(2);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const get = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'saveTokenInfo' ? pending : get(path, args)
  );
  await act(async () => fireEvent.click(importButton(1)!));
  await publish([saved(1)]);
  await publish([]);
  await act(async () => finish());
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it('does not revive an earlier Added mark after a new attempt fails before public publication', async () => {
  await mount(2);
  await act(async () => fireEvent.click(importButton(1)!));
  await publish([]);
  const get = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementationOnce(() =>
    Promise.reject(new Error('Synthetic save refusal'))
  );
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  await act(async () => fireEvent.click(importButton(1)!));
  expect(importButton(1)).toBeEnabled();
  await publish([saved(2)]);
  expect(importButton(1)).toBeEnabled();
  mockEmitter.mockImplementation(get);
  await act(async () => fireEvent.click(importButton(1)!));
  expect(importButton(1)).toBeDisabled();
  expect(discoveryCalls()).toHaveLength(1);
  error.mockRestore();
});

it('compares canonical GUID strings only within the selected account and chain', async () => {
  await publish([
    { ...saved(1), assetGuid: '0001001' },
    { ...saved(2), chainId: 57 },
  ]);
  await mount(2);
  expect(importButton(1)).toBeNull();
  expect(importButton(2)).toBeEnabled();
  await publish([{ ...saved(2), chainId: 57 }]);
  await publish([saved(1)], 1);
  expect(importButton(1)).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it('filters current membership before the fifty-row window without another backend read', async () => {
  await publish(Array.from({ length: 60 }, (_, index) => saved(index + 1)));
  await mount(75);
  expect(importButtons()).toHaveLength(15);
  expect(importButton(61)).toBeEnabled();
  expect(screen.queryByRole('button', { name: /buttons.loadMore/ })).toBeNull();
  await publish([]);
  expect(importButtons()).toHaveLength(50);
  expect(
    screen.getByRole('button', { name: 'buttons.loadMore (50/75)' })
  ).toBeEnabled();
  await act(async () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'buttons.loadMore (50/75)' })
    )
  );
  expect(importButtons()).toHaveLength(75);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('retains uint64 GUIDs and display amounts above the safe-number range exactly', async () => {
  const row = {
    ...token(1),
    assetGuid: '18446744073709551615',
    decimals: 0,
    balance: '9007199254740993',
    totalReceived: '9007199254740993',
  };
  await publish([{ ...row, chainId: 5700 }]);
  mockFetch.mockResolvedValue({ address: 'public-xpub', tokensAsset: [row] });
  render(tree());
  await act(async () => undefined);
  expect(importButton(1)).toBeNull();
  await publish([]);
  expect(importButton(1)).toBeEnabled();
  const raw = await publicDiscovery();
  expect(raw[0]).toMatchObject({
    assetGuid: row.assetGuid,
    balance: row.balance,
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it.each(['owner', 'endpoint'] as const)(
  'does not publish a late old-%s discovery after the new scope has loaded',
  async (change) => {
    let finish!: (value: unknown) => void;
    mockFetch
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockImplementation(async (_url, xpub) => ({
        address: xpub,
        tokensAsset: [token(2)],
      }));
    render(tree());
    await act(async () => undefined);
    await act(async () =>
      mockStore.dispatch(
        change === 'owner'
          ? setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
          : setActiveNetwork({
              ...mockStore.getState().vault.activeNetwork,
              url: 'https://new-blockbook.synthetic.invalid/',
            })
      )
    );
    expect(importButton(2)).toBeEnabled();
    await act(async () =>
      finish({ address: 'public-xpub', tokensAsset: [token(1)] })
    );
    expect(importButton(1)).toBeNull();
    expect(importButton(2)).toBeEnabled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }
);

it('shows and imports the thirty-first distinct owned SPT', async () => {
  await mount(31);
  expect(importButtons()).toHaveLength(31);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Import SPT31 token' }))
  );
  expect(importedTokens()).toEqual([
    expect.objectContaining({
      assetGuid: '1031',
      chainId: 5700,
      balance: '1.0',
      decimals: 8,
    }),
  ]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('keeps the remaining owned SPT discoverable after the first thirty are imported and the page reopens', async () => {
  const view = await mount(31);
  for (let index = 1; index <= 30; index += 1) {
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', { name: `Import SPT${index} token` })
      )
    );
  }
  expect(importedTokens()).toHaveLength(30);
  view.unmount();
  render(tree());
  await act(async () => undefined);
  expect(importButtons()).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: 'Import SPT31 token' })
  ).toBeEnabled();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('aggregates duplicate UTXO rows and reuses the complete cached discovery result', async () => {
  await mount(31, true);
  expect(importButtons()).toHaveLength(30);
  const values = await mockAssets.getUserOwnedTokens('public-xpub');
  expect(values).toHaveLength(30);
  expect(values.find((value) => value.assetGuid === '1030')?.balance).toBe(
    '2.0'
  );
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('reveals all seventy-five owned SPTs with local Load More and no additional Blockbook request', async () => {
  await mount(75);
  expect(importButtons()).toHaveLength(50);
  expect(
    screen.getByRole('button', { name: 'Import SPT50 token' })
  ).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Import SPT51 token' })
  ).toBeNull();
  const more = screen.getByRole('button', {
    name: 'buttons.loadMore (50/75)',
  });
  expect(more).toHaveAttribute('type', 'button');
  await act(async () => fireEvent.click(more));
  expect(importButtons()).toHaveLength(75);
  expect(
    screen.getByRole('button', { name: 'Import SPT75 token' })
  ).toBeEnabled();
  expect(screen.queryByRole('button', { name: /buttons.loadMore/ })).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
