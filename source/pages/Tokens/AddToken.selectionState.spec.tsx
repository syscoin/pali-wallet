/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import english from 'assets/locales/en.json';
import { AddToken } from 'pages/Tokens/AddToken';
import vaultReducer, {
  setAccountAssets,
  setActiveAccount,
  setActiveNetwork,
} from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import type { ITokenEthProps, ITokenSearchResult } from 'types/tokens';

// Native AddToken/SyscoinImport/ImportToken, Redux selectors/reducers, router,
// localization, and actual tab button elements are the subject of this probe.
// Only unrelated network and decorative rendering dependencies are substituted.
let mockStore: any;
const mockEmitter = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    alert: { success: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: () => null,
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: () => null,
  CheckCircleOutlined: () => null,
  CloseCircleOutlined: () => null,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
  truncate: (value: unknown) => String(value),
  ellipsis: (value: unknown) => String(value),
}));

const Location = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route">{location.search}</output>
      <button onClick={() => navigate('/home')}>Leave discovery</button>
      <button onClick={() => navigate('/tokens/add?tab=owned')}>
        Reopen discovery
      </button>
    </>
  );
};
const locale = i18next.createInstance();
beforeAll(async () => {
  await locale.init({
    lng: 'en',
    resources: { en: { translation: english } },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(([, method]) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    throw new Error(`Unexpected controller call: ${method}`);
  });
});
afterEach(cleanup);

const show = async (utxo: boolean, saved: ITokenEthProps[] = []) => {
  const initial = vaultReducer(undefined, { type: 'probe/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: vaultGlobalReducer },
    preloadedState: {
      vault: {
        ...initial,
        isBitcoinBased: utxo,
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              address: `0x${'11'.repeat(20)}`,
              xpub: 'synthetic-public-xpub',
            },
            1: { address: `0x${'22'.repeat(20)}`, xpub: 'other-public-xpub' },
          },
        },
        activeNetwork: {
          kind: utxo ? INetworkType.Syscoin : INetworkType.Ethereum,
          chainId: utxo ? 5700 : 1,
          url: 'https://rpc.synthetic.invalid',
          apiUrl: 'https://explorer.synthetic.invalid/api',
        },
        accountAssets: { HDAccount: { 0: { ethereum: saved, syscoin: [] } } },
      } as any,
    },
  });
  await act(async () => {
    render(
      <Provider store={mockStore}>
        <I18nextProvider i18n={locale}>
          <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
            <Routes>
              <Route path="/tokens/add" element={<AddToken />} />
              <Route path="/home" element={null} />
            </Routes>
            <Location />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
  });
  const tab = (key: string) =>
    screen
      .getAllByRole('button', { name: String(locale.t(key)) })
      .find(
        (button) => !button.closest('[data-navigation-scroll="token-import"]')
      )!;
  return {
    owned: tab('tokens.yourTokens'),
    custom: tab('tokens.addCustomTab'),
  };
};

it.each([false, true])(
  'healthy control: actual tabs switch the URL and input on click (UTXO %s)',
  async (utxo) => {
    const { owned, custom } = await show(utxo);
    expect(screen.getByTestId('route')).toHaveTextContent('?tab=owned');
    await act(async () => fireEvent.click(custom));
    expect(screen.getByTestId('route')).toHaveTextContent('?tab=custom');
    expect(
      screen.getByLabelText(
        String(locale.t(utxo ? 'tokens.assetGuid' : 'settings.contractAddress'))
      )
    ).toBeVisible();
    await act(async () => fireEvent.click(owned));
    expect(screen.getByTestId('route')).toHaveTextContent('?tab=owned');
  }
);

const CONTRACT = `0x${'33'.repeat(20)}`;
const OTHER_CONTRACT = `0x${'44'.repeat(20)}`;
const discoveryCalls = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'getUserOwnedTokens'
  );
const importRow = (symbol: string) =>
  screen.queryByRole('button', {
    name: String(locale.t('tokens.importNamedToken', { symbol })),
  });
const discovered = (
  standard: 'ERC-20' | 'ERC-721' | 'ERC-1155'
): ITokenSearchResult[] =>
  ['A', 'B'].map((symbol, index) => ({
    id: `${standard === 'ERC-1155' || !index ? CONTRACT : OTHER_CONTRACT}-1${
      standard === 'ERC-1155' ? `-${index + 1}` : ''
    }`,
    contractAddress:
      standard === 'ERC-1155' || !index ? CONTRACT : OTHER_CONTRACT,
    name: `Synthetic ${symbol}`,
    symbol,
    tokenStandard: standard,
    decimals: 0,
    balance: 3,
    image: 'https://assets.synthetic.invalid/public-token.png',
    ...(standard === 'ERC-1155'
      ? { tokenId: index ? '2' : '0x01', rawBalance: '3' }
      : {}),
  }));
const savedAsset = (row: ITokenSearchResult, chainId = 1): ITokenEthProps => ({
  chainId,
  contractAddress: row.contractAddress!,
  decimals: 0,
  tokenSymbol: row.symbol,
  isNft: row.tokenStandard !== 'ERC-20',
  tokenStandard: row.tokenStandard as ITokenEthProps['tokenStandard'],
  ...(row.tokenId ? { tokenId: '0001' } : {}),
});
const inventory = async (rows: ITokenEthProps[], accountId = 0) => {
  await act(async () =>
    mockStore.dispatch(
      setAccountAssets({
        accountType: KeyringAccountType.HDAccount,
        accountId,
        property: 'ethereum',
        value: rows,
      })
    )
  );
};

it.each(['ERC-20', 'ERC-721', 'ERC-1155'] as const)(
  'updates retained %s discovery eligibility after another document removes or adds a saved row',
  async (standard) => {
    const rows = discovered(standard),
      saved = savedAsset(rows[0]);
    if (standard === 'ERC-1155')
      rows.push({
        ...rows[0],
        symbol: 'INVALID',
        tokenId: (BigInt(1) << BigInt(256)).toString(),
      });
    mockEmitter.mockResolvedValue(rows);
    const { owned, custom } = await show(false, [saved]);
    expect(importRow('A')).toBeNull();
    expect(importRow('B')).toBeEnabled();
    expect(importRow('INVALID')).toBeNull();
    expect(discoveryCalls()).toHaveLength(1);
    await inventory([]);
    expect(importRow('A')).toBeEnabled();
    expect(importRow('B')).toBeEnabled();
    expect(importRow('INVALID')).toBeNull();
    await inventory([saved]);
    expect(importRow('A')).toBeNull();
    await act(async () => fireEvent.click(custom));
    await inventory([]);
    await act(async () => fireEvent.click(owned));
    expect(importRow('A')).toBeEnabled();
    expect(discoveryCalls()).toHaveLength(1);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Leave discovery' }))
    );
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Reopen discovery' }))
    );
    expect(importRow('A')).toBeEnabled();
    expect(discoveryCalls()).toHaveLength(2);
  }
);

it('uses only the current account and chain inventory to hide discovery rows', async () => {
  const rows = discovered('ERC-20');
  mockEmitter.mockResolvedValue(rows);
  await show(false, [savedAsset(rows[0], 2)]);
  await inventory([savedAsset(rows[0])], 1);
  expect(importRow('A')).toBeEnabled();
  await inventory([savedAsset(rows[0])]);
  expect(importRow('A')).toBeNull();
  expect(importRow('B')).toBeEnabled();
  await inventory([savedAsset(rows[0], 2)]);
  expect(importRow('A')).toBeEnabled();
  expect(discoveryCalls()).toHaveLength(1);
});

it.each(['owner', 'endpoint'] as const)(
  'ignores an old %s discovery response after the new scope is ready',
  async (change) => {
    const rows = discovered('ERC-20');
    let release!: (responseRows: ITokenSearchResult[]) => void;
    mockEmitter
      .mockReturnValueOnce(
        new Promise<ITokenSearchResult[]>((resolve) => {
          release = resolve;
        })
      )
      .mockResolvedValue([rows[1]]);
    await show(false);
    await act(async () =>
      mockStore.dispatch(
        change === 'owner'
          ? setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
          : setActiveNetwork({
              ...mockStore.getState().vault.activeNetwork,
              apiUrl: 'https://new-explorer.synthetic.invalid/api',
            })
      )
    );
    expect(importRow('B')).toBeEnabled();
    await act(async () => release(rows));
    await inventory([], change === 'owner' ? 1 : 0);
    expect(importRow('A')).toBeNull();
    expect(importRow('B')).toBeEnabled();
    expect(discoveryCalls()).toHaveLength(2);
  }
);

it.each([false, true])(
  'tab selection is exposed as pressed state before and after click (UTXO %s)',
  async (utxo) => {
    const { owned, custom } = await show(utxo);
    expect(owned).toHaveAttribute('aria-pressed', 'true');
    expect(custom).toHaveAttribute('aria-pressed', 'false');
    await act(async () => fireEvent.click(custom));
    expect(owned).toHaveAttribute('aria-pressed', 'false');
    expect(custom).toHaveAttribute('aria-pressed', 'true');
  }
);
