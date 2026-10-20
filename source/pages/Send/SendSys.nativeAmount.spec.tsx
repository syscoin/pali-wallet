/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SendSys } from './SendSys';

let mockForm: any;
let mockState: any;
let mockLocation: any;
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.vault.accounts.HDAccount[0],
    assets: { syscoin: [] },
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: ({ children, loading, type, className }: any) => (
    <button type={type} className={className} aria-busy={loading}>
      {children}
    </button>
  ),
  Fee: () => null,
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('jdenticon', () => ({ toSvg: () => '<svg></svg>' }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  isNFT: () => false,
  getAssetBalance: () => '',
  ellipsis: (value: string) => value,
  MINIMUM_FEE: 0.00000001,
  adjustUrl: (value: string) => value,
  createNavigationContext: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .createNavigationContext(...args),
  navigateWithContext: (...args: any[]) =>
    jest.requireActual('utils/navigationState').navigateWithContext(...args),
  removeScientificNotation: (...args: any[]) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(...args),
}));
jest.mock('utils/validations', () => ({
  isValidSYSAddress: () => Promise.resolve(true),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  const useForm = actual.Form.useForm;
  actual.Form.useForm = function useCapturedForm(...args: any[]) {
    const forms = useForm(...args);
    mockForm = forms[0];
    return forms;
  };
  return actual;
});

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockSave.mockResolvedValue(undefined);
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: 'synthetic-sender',
            xpub: 'synthetic-public-xpub',
            balances: { syscoin: '100000000' },
          },
        },
      },
      isBitcoinBased: true,
      activeNetwork: {
        chainId: 57,
        kind: 'syscoin',
        slip44: 57,
        url: 'https://blockbook.invalid',
        currency: 'SYS',
      },
    },
  };
  mockLocation = { pathname: '/send/sys', state: null };
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path[path.length - 1];
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    if (method === 'getEstimateSysTransactionFee')
      return { psbt: 'synthetic-unsigned-psbt', fee: 0.00000001 };
    throw new Error('Unexpected method ' + method);
  });
});

const estimateCalls = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path[path.length - 1] === 'getEstimateSysTransactionFee'
  );
const confirmations = () =>
  mockNavigate.mock.calls.filter(([path]) => path === '/send/confirm');
const fillAmount = async (amount: string) => {
  await waitFor(() => expect(mockForm.getFieldValue('fee')).toBe(0.00000001));
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: 'synthetic-recipient' },
  });
  fireEvent.change(screen.getByPlaceholderText('send.amount'), {
    target: { value: amount },
  });
};
const submit = async () => {
  await act(async () => {
    await mockForm.validateFields();
    mockForm.submit();
  });
  await waitFor(() => expect(confirmations()).toHaveLength(1));
};

// Real SendSys, Ant Design Form/Input and draft/navigation helpers. The
// controller quote is inert: these tests assert the exact unsigned request,
// review amount and returned draft without signing or broadcasting.
it.each([
  ['1e-4', '0.0001'],
  ['1e0', '1'],
  ['1e-8', '0.00000001'],
  ['9.007199254740993e7', '90071992.54740993'],
  ['0.0001', '0.0001'],
  ['1', '1'],
  ['0.00000001', '0.00000001'],
  ['90071992.54740993', '90071992.54740993'],
])('prepares %s as exact plain decimal %s', async (input, expected) => {
  render(<SendSys />);
  await fillAmount(input);
  await submit();
  expect(estimateCalls()[0][1][0]).toEqual(
    expect.objectContaining({ amount: expected, isMax: false, token: null })
  );
  const confirmation = confirmations()[0][1].state;
  expect(confirmation.tx.amount).toBe(expected);
  expect(confirmation.returnContext.state.formValues.amount).toBe(input);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('preserves the typed exponent draft when returning and normalizes the next quote again', async () => {
  const view = render(<SendSys />);
  await fillAmount('1e-4');
  await submit();
  const returned = confirmations()[0][1].state.returnContext;
  view.unmount();
  mockLocation = {
    pathname: returned.returnRoute,
    state: { ...returned.state, walletScope: returned.walletScope },
  };
  mockNavigate.mockClear();
  mockEmitter.mockClear();
  render(<SendSys />);
  expect(
    (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
  ).toBe('1e-4');
  await submit();
  expect(estimateCalls()[0][1][0].amount).toBe('0.0001');
  expect(confirmations()[0][1].state.tx.amount).toBe('0.0001');
});

it('keeps typed full-balance exponent as bounded subtract-fee, not live sweep', async () => {
  mockState.vault.accounts.HDAccount[0].balances.syscoin = '1';
  render(<SendSys />);
  await fillAmount('1e0');
  await submit();
  const request = estimateCalls()[0][1][0];
  expect(request.amount).toBe('1');
  expect(request.isMax).toBe(true);
  expect(request).not.toHaveProperty('nativeSweep');
  expect(confirmations()[0][1].state.tx.amount).toBe('1');
});

it('still rejects native sub-satoshi exponents before preparing a quote', async () => {
  render(<SendSys />);
  await fillAmount('1e-9');
  await act(async () => {
    await expect(mockForm.validateFields()).rejects.toEqual(
      expect.objectContaining({
        errorFields: expect.arrayContaining([
          expect.objectContaining({ errors: ['send.invalidAmount'] }),
        ]),
      })
    );
  });
  expect(estimateCalls()).toHaveLength(0);
  expect(confirmations()).toHaveLength(0);
});

it('still retires a pending native quote after the raw amount is edited', async () => {
  let resolveQuote!: (quote: any) => void;
  const pending = new Promise((resolve) => {
    resolveQuote = resolve;
  });
  mockEmitter.mockImplementation((path: string[]) => {
    if (path[path.length - 1] === 'getEstimateSysTransactionFee')
      return pending;
    return Promise.resolve(0.00000001);
  });
  render(<SendSys />);
  await fillAmount('1e-4');
  await act(async () => {
    await mockForm.validateFields();
    mockForm.submit();
  });
  await waitFor(() => expect(estimateCalls()).toHaveLength(1));
  fireEvent.change(screen.getByPlaceholderText('send.amount'), {
    target: { value: '0.0002' },
  });
  await act(async () => {
    resolveQuote({ psbt: 'obsolete-unsigned-psbt', fee: 0.00000001 });
    await pending;
  });
  expect(confirmations()).toHaveLength(0);
});
