/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { GeneralMenu } from 'components/Header/Menus/GeneralMenu';
import { navigateBack } from 'utils/navigationState';

import { SendSys } from './SendSys';

let mockForm: any;
let mockState: any;
const mockEmitter = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
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
  useUtils: () => ({
    alert: mockAlert,
    navigate: jest.requireActual('react-router-dom').useNavigate(),
  }),
  usePrice: () => ({ isFiatAvailable: false, getFiatAmount: () => '' }),
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
  KeySvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
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
  Fee: (props: any) => {
    const ActualFee = jest.requireActual('components/Fee/Fee').Fee;
    return <ActualFee {...props} />;
  },
  AccountMenu: () => null,
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/WalletUpdateBadge', () => ({
  WalletUpdateBadge: () => null,
}));
jest.mock('jdenticon', () => ({ toSvg: () => '<svg></svg>' }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  truncate: (value: string) => value,
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
    price: { fiat: { asset: 'USD' } },
    vaultGlobal: { activeSlip44: 57, advancedSettings: {} },
    dapp: { dapps: {} },
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
  global.chrome = {
    ...global.chrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as unknown as typeof chrome;
  mockEmitter.mockImplementation(async (path: string[]) => {
    const method = path[path.length - 1];
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    if (method === 'getEstimateSysTransactionFee')
      throw new Error('Unexpected preparation');
    throw new Error('Unexpected method ' + method);
  });
});

let currentLocation: ReturnType<typeof useLocation>;
const Layout = () => {
  const location = useLocation();
  currentLocation = location;
  const navigate = useNavigate();
  return (
    <>
      <GeneralMenu />
      <Routes>
        <Route path="/send/sys" element={<SendSys />} />
        <Route
          path="/settings/about"
          element={
            <button onClick={() => navigateBack(navigate, location)}>
              Back
            </button>
          }
        />
      </Routes>
    </>
  );
};

it.each(['0.00000025', '0.0000000125390625', '', '-1', '0'])(
  'retains raw fee-only edit %j through Info & Help and Back without preparing a transaction',
  async (fee) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/send/sys']}>
        <Layout />
      </MemoryRouter>
    );
    await waitFor(() => expect(mockForm.getFieldValue('fee')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
      target: { value: 'synthetic-recipient' },
    });
    const amount = screen.getByPlaceholderText('send.amount');
    fireEvent.change(amount, { target: { value: '0.25' } });
    await user.click(amount);
    const input = screen.getByLabelText('components.feeRateLabel');
    await user.click(input);
    fireEvent.change(input, { target: { value: fee } });
    await user.tab();
    await waitFor(() => expect(currentLocation.state.formValues.fee).toBe(fee));
    await user.click(
      screen.getByRole('button', { name: 'generalMenu.generalOptions' })
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'generalMenu.infoHelp' })
    );
    expect(currentLocation.pathname).toBe('/settings/about');
    expect(currentLocation.state.returnContext.state.formValues).toEqual(
      expect.objectContaining({ fee, amount: '0.25' })
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(currentLocation.pathname).toBe('/send/sys');
    await waitFor(() => expect(mockForm.getFieldValue('fee')).toBe(fee));
    expect(
      (screen.getByLabelText('components.feeRateLabel') as HTMLInputElement)
        .value
    ).toBe(fee);
    expect(
      mockEmitter.mock.calls.filter(
        ([path]) => path.at(-1) === 'getEstimateSysTransactionFee'
      )
    ).toHaveLength(0);
  }
);
