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
import { MemoryRouter, useLocation } from 'react-router-dom';

import english from 'assets/locales/en.json';
import { AddToken } from 'pages/Tokens/AddToken';
import vaultReducer from 'state/vault';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType } from 'types/network';

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
  return <output data-testid="route">{location.search}</output>;
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

const show = async (utxo: boolean) => {
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
          },
        },
        activeNetwork: {
          kind: utxo ? INetworkType.Syscoin : INetworkType.Ethereum,
          chainId: utxo ? 5700 : 1,
          url: 'https://rpc.synthetic.invalid',
          apiUrl: 'https://explorer.synthetic.invalid/api',
        },
        accountAssets: {},
      } as any,
    },
  });
  await act(async () => {
    render(
      <Provider store={mockStore}>
        <I18nextProvider i18n={locale}>
          <MemoryRouter initialEntries={['/tokens/add?tab=owned']}>
            <AddToken />
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
