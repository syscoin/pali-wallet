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
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import vaultReducer, { setActiveAccount, setActiveNetwork } from 'state/vault';
import globalReducer from 'state/vaultGlobal';
import {
  initialActiveHdAccountState,
  INetworkType,
  KeyringAccountType,
} from 'types/network';

import { AddToken } from './AddToken';

// Real mounted input, deferred React work, scope remount, Redux reducers,
// locale resources and Ant validation glyphs. Only the controller transport
// and unrelated list chrome are replaced. No token import is activated.
let mockStore: any;
const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  FiDownload: () => null,
  RiShareForward2Line: () => null,
  LoadingOutlined: jest.requireActual(
    '@ant-design/icons/lib/icons/LoadingOutlined'
  ).default,
  CheckCircleOutlined: jest.requireActual(
    '@ant-design/icons/lib/icons/CheckCircleOutlined'
  ).default,
  CloseCircleOutlined: jest.requireActual(
    '@ant-design/icons/lib/icons/CloseCircleOutlined'
  ).default,
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: jest.requireActual('components/ImportableAssetsList')
    .ImportableAssetsList,
  IconButton: jest.requireActual('components/IconButton').IconButton,
}));
jest.mock('utils/index', () => jest.requireActual('utils/format'));

const OWNER = `0x${'11'.repeat(20)}`;
const A = `0x${'33'.repeat(20)}`;
const B = `0x${'44'.repeat(20)}`;
const MALFORMED = '0x123';
const DEBOUNCE_MS = 500;
const resources = { en, fr, de };
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
};
const details = (contractAddress = A) => ({
  contractAddress,
  symbol: 'CURRENT',
  name: 'Current token',
  chainId: 5700,
  tokenStandard: 'ERC-20',
  isNft: false,
  decimals: 6,
  balance: 123,
  image: 'synthetic-image',
});
let response: ReturnType<typeof deferred>;
let i18n: ReturnType<typeof createInstance>;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  response = deferred();
  const initialVault = vaultReducer(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault: vaultReducer, vaultGlobal: globalReducer },
    preloadedState: {
      vault: {
        ...initialVault,
        isBitcoinBased: false,
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 5700,
          slip44: 60,
          url: 'https://rpc.synthetic.invalid',
          currency: 'tsys',
        },
        accounts: {
          ...initialVault.accounts,
          HDAccount: {
            0: {
              ...initialActiveHdAccountState,
              id: 0,
              address: OWNER,
              label: 'Daily',
            },
            1: {
              ...initialActiveHdAccountState,
              id: 1,
              address: `0x${'22'.repeat(20)}`,
              label: 'Reserve',
            },
          },
        },
        accountAssets: {
          ...initialVault.accountAssets,
          HDAccount: {
            0: { ethereum: [], syscoin: [] },
            1: { ethereum: [], syscoin: [] },
          },
        },
      } as any,
      vaultGlobal: {
        ...globalReducer(undefined, { type: 'test/init' }),
        activeSlip44: 60,
      },
    },
  });
  mockEmitter.mockImplementation(async ([family, method]) => {
    expect(family).toBe('wallet');
    if (method === 'getUserOwnedTokens') return [];
    if (method === 'getTokenDetailsWithMarketData') return response.promise;
    if (method === 'validateNftContract' || method === 'validateERC20Only')
      return null;
    throw new Error(`Unexpected controller action: ${method}`);
  });
  i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: Object.fromEntries(
      Object.entries(resources).map(([locale, translation]) => [
        locale,
        { translation },
      ])
    ),
    initImmediate: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

afterEach(() => {
  cleanup();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'saveTokenInfo')
  ).toHaveLength(0);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mount = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <Provider store={mockStore}>
        <MemoryRouter initialEntries={['/tokens/add?tab=custom']}>
          <AddToken />
        </MemoryRouter>
      </Provider>
    </I18nextProvider>
  );
const input = () => screen.getByLabelText(i18n.t('settings.contractAddress'));
const edit = (value: string) =>
  fireEvent.change(input(), { target: { value } });
const advance = async (milliseconds = DEBOUNCE_MS) => {
  await act(async () => jest.advanceTimersByTimeAsync(milliseconds));
};
const expectNoFeedback = () => {
  expect(input()).not.toHaveAttribute('aria-invalid', 'true');
  expect(input()).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('img', { name: 'close-circle' })).toBeNull();
};
const expectFeedback = (message: string, invalid: boolean) => {
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(message);
  expect(alert).toHaveAttribute('id', 'custom-token-contract-feedback');
  expect(alert).toHaveClass('mt-2', 'px-5', 'text-sm');
  expect(input()).toHaveAttribute('aria-describedby', alert.id);
  expect(input()).toHaveAccessibleDescription(message);
  if (invalid) expect(input()).toHaveAttribute('aria-invalid', 'true');
  else expect(input()).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('img', { name: 'close-circle' })).toBeVisible();
};
const methods = () => mockEmitter.mock.calls.map(([[, method]]) => method);

it('reports a completed malformed input with associated guidance, never empty or debounce-pending input', async () => {
  const baseline = mockStore.getState();
  mount();
  expectNoFeedback();
  edit(MALFORMED);
  expectNoFeedback();
  await advance(DEBOUNCE_MS - 1);
  expectNoFeedback();
  await advance(1);
  expectFeedback(en.send.invalidEthAddress, true);
  expect(input()).toHaveValue(MALFORMED);
  expect(mockEmitter).not.toHaveBeenCalled();
  edit('');
  expectNoFeedback();
  await advance();
  expectNoFeedback();
  expect(mockStore.getState()).toBe(baseline);
});

it.each(['fr', 'de'] as const)(
  '%s associates the real localized format guidance with the native field',
  async (locale) => {
    await i18n.changeLanguage(locale);
    mount();
    edit(MALFORMED);
    await advance();
    expectFeedback(resources[locale].send.invalidEthAddress, true);
    expect(input()).toHaveAccessibleName(
      resources[locale].settings.contractAddress
    );
    expect(screen.queryByText(en.send.invalidEthAddress)).toBeNull();
  }
);

it('keeps an actual current request pending without error, then exposes the healthy current preview', async () => {
  mount();
  edit(A);
  expectNoFeedback();
  await advance();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getTokenDetailsWithMarketData'],
    [A, OWNER]
  );
  expect(screen.getByRole('img', { name: 'loading' })).toBeVisible();
  expectNoFeedback();
  await act(async () => response.resolve(details()));
  expectNoFeedback();
  expect(screen.queryByRole('img', { name: 'loading' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeEnabled();
  expect(methods()).toEqual(['getTokenDetailsWithMarketData']);
});

it('associates an honest read-failure message for a valid address without claiming it is format-invalid', async () => {
  mount();
  edit(A);
  await advance();
  expectNoFeedback();
  await act(async () =>
    response.reject(new Error('Synthetic public read refusal'))
  );
  expectFeedback(en.send.unableToLoad, false);
  expect(screen.queryByText(en.send.invalidEthAddress)).toBeNull();
  expect(screen.queryByText(en.send.tokenNotFound)).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Import CURRENT token' })
  ).toBeNull();
  expect(methods()).toEqual([
    'getTokenDetailsWithMarketData',
    'validateNftContract',
    'validateERC20Only',
  ]);
  expect(
    mockEmitter.mock.calls.every(
      ([, args]) => args[0] === A && args[1] === OWNER
    )
  ).toBe(true);
});

it('does not turn the presentation format helper into a new controller-validation policy', async () => {
  const malformedLong = '0x' + 'g'.repeat(40);
  mount();
  edit(malformedLong);
  await advance();
  await act(async () => response.resolve(null));
  expectFeedback(en.send.invalidEthAddress, true);
  expect(methods()).toEqual([
    'getTokenDetailsWithMarketData',
    'validateNftContract',
    'validateERC20Only',
  ]);
  expect(
    mockEmitter.mock.calls.every(([, args]) => args[0] === malformedLong)
  ).toBe(true);
});

it('removes completed feedback immediately on correction and does not restore it during pending healthy work', async () => {
  mount();
  edit(MALFORMED);
  await advance();
  expectFeedback(en.send.invalidEthAddress, true);
  edit(A);
  expectNoFeedback();
  await advance();
  expectNoFeedback();
  await act(async () => response.resolve(details()));
  expectNoFeedback();
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeEnabled();
});

it('requires a fresh completion when urgent A to B to A edits return to the same malformed value', async () => {
  mount();
  edit(MALFORMED);
  await advance();
  expectFeedback(en.send.invalidEthAddress, true);
  act(() => {
    edit('0x456');
    edit(MALFORMED);
  });
  expectNoFeedback();
  await advance(DEBOUNCE_MS - 1);
  expectNoFeedback();
  await advance(1);
  expectFeedback(en.send.invalidEthAddress, true);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('ignores an obsolete rejected request while a different current contract becomes healthy', async () => {
  const old = deferred(),
    current = deferred();
  mockEmitter.mockImplementation(async ([, method], args) => {
    if (method === 'getTokenDetailsWithMarketData')
      return args[0] === A ? old.promise : current.promise;
    throw new Error(`Obsolete request must not advance fallback: ${method}`);
  });
  mount();
  edit(A);
  await advance();
  edit(B);
  await act(async () => old.reject(new Error('Old public read refusal')));
  expectNoFeedback();
  await advance();
  expectNoFeedback();
  await act(async () => current.resolve(details(B)));
  expectNoFeedback();
  expect(
    screen.getByRole('button', { name: 'Import CURRENT token' })
  ).toBeEnabled();
  expect(methods()).toEqual([
    'getTokenDetailsWithMarketData',
    'getTokenDetailsWithMarketData',
  ]);
});

it('does not resurrect an obsolete A failure when deferred input returns through B to A', async () => {
  const old = deferred(),
    current = deferred();
  let calls = 0;
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getTokenDetailsWithMarketData')
      return calls++ === 0 ? old.promise : current.promise;
    if (method === 'validateNftContract' || method === 'validateERC20Only')
      return null;
    throw new Error(`Unexpected controller action: ${method}`);
  });
  mount();
  edit(A);
  await advance();
  act(() => {
    edit(B);
    edit(A);
  });
  await act(async () => old.resolve(null));
  expectNoFeedback();
  await advance();
  expectNoFeedback();
  expect(methods()).toEqual([
    'getTokenDetailsWithMarketData',
    'getTokenDetailsWithMarketData',
  ]);
  await act(async () => current.resolve(null));
  expectFeedback(en.send.unableToLoad, false);
  expect(methods()).toEqual([
    'getTokenDetailsWithMarketData',
    'getTokenDetailsWithMarketData',
    'validateNftContract',
    'validateERC20Only',
  ]);
});

it.each(['account', 'same-chain RPC'] as const)(
  'does not carry a completed failure or pending response into another %s scope',
  async (change) => {
    mount();
    edit(MALFORMED);
    await advance();
    expectFeedback(en.send.invalidEthAddress, true);
    edit(A);
    await advance();
    expectNoFeedback();
    act(() => {
      if (change === 'account')
        mockStore.dispatch(
          setActiveAccount({ type: KeyringAccountType.HDAccount, id: 1 })
        );
      else
        mockStore.dispatch(
          setActiveNetwork({
            ...mockStore.getState().vault.activeNetwork,
            url: 'https://other.synthetic.invalid',
          })
        );
    });
    expect(input()).toHaveValue('');
    expectNoFeedback();
    await act(async () => response.reject(new Error('Old scope read refusal')));
    expectNoFeedback();
    expect(methods()).toEqual(['getTokenDetailsWithMarketData']);
  }
);
