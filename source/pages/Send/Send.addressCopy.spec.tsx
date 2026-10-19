/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { SendEth } from 'pages/Send/SendEth';
import { SendSys } from 'pages/Send/SendSys';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockState: any;
let mockLocation: any;
const mockSave = jest.fn();
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn(), success: jest.fn() };
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
  Outlet: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ ...mockStatus, controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: false, forceRecheck: jest.fn() }),
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/Header/Header', () => ({ Header: () => null }));
jest.mock('components/Loading/PageLoadingOverlay', () => ({
  PageLoadingOverlay: () => null,
}));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useBrowsingNavigationScroll', () => ({
  useBrowsingNavigationScroll: jest.fn(),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  ...jest.requireActual('hooks/usePageLoadingState'),
  usePageLoadingState: () => ({
    isLoading: false,
    isContextChanging: false,
  }),
}));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('pages/Send/EditPriority', () => ({ EditPriorityModal: () => null }));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.example',
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  getAssetBalance: () => '10',
  ellipsis: (value: string) => value,
  adjustUrl: (value: string) => value,
  formatFullPrecisionBalance: (value: any) => String(value),
  createNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  getTokenTypeBadgeColor: () => '',
  truncateToDecimals: (value: string) => value,
  MINIMUM_FEE: 0.0000001,
  isNFT: () => false,
  clearNavigationState: jest.fn(),
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: string | number) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account:
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ],
    assets: state.testAssets || { ethereum: [], syscoin: [] },
  }),
  selectValidEnsCache: () => ({}),
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, variant, fullWidth, loading, icon, ...props }: any) => (
    <button
      {...props}
      data-variant={variant}
      data-full-width={fullWidth}
      aria-busy={loading}
    >
      {children}
      {icon}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
  IconButton: ({ children, onClick, ...props }: any) => (
    <button {...props} onClick={onClick}>
      {children}
    </button>
  ),
  DeviceWaitingBanner: () => null,
  Fee: () => null,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: false }) : children}</>
  );
  const Menu = Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass });
  return {
    Menu,
    Switch: ({ children, onChange, checked }: any) => (
      <button
        type="button"
        aria-label="rbf-switch"
        onClick={() => onChange(!checked)}
      >
        {children}
      </button>
    ),
  };
});
jest.mock('antd', () => {
  const FormContext = React.createContext<any>(null);
  const NameContext = React.createContext<string>('');
  const Form = ({ children, form, initialValues, onValuesChange }: any) => {
    const initialized = React.useRef(false);
    if (!initialized.current) {
      initialized.current = true;
      Object.assign(form.values, initialValues);
    }
    return (
      <FormContext.Provider value={{ form, onValuesChange }}>
        {children}
      </FormContext.Provider>
    );
  };
  Form.Item = function MockFormItem({ children, name }: any) {
    return <NameContext.Provider value={name}>{children}</NameContext.Provider>;
  };
  Form.useForm = () => {
    const [, update] = React.useState(0);
    const ref = React.useRef<any>();
    if (!ref.current) {
      const values: any = {};
      ref.current = {
        values,
        getFieldsValue: () => ({ ...values }),
        getFieldValue: (name: string) => values[name],
        setFieldsValue: (next: any) => {
          Object.assign(values, next);
          update((v) => v + 1);
        },
        setFieldValue: (name: string, value: any) => {
          values[name] = value;
          update((v) => v + 1);
        },
        validateFields: () => Promise.resolve(values),
      };
    }
    return [ref.current];
  };
  Form.useWatch = (name: string, form: any) => form.getFieldValue(name);
  const Input = ({ onChange, value, suffix, ...props }: any) => {
    const { form, onValuesChange } = React.useContext(FormContext);
    const name = React.useContext(NameContext);
    return (
      <span>
        {suffix}
        <input
          {...props}
          value={value ?? form.getFieldValue(name) ?? ''}
          onChange={(event) => {
            form.setFieldValue(name, event.target.value);
            onChange?.(event);
            if (name !== 'fee')
              onValuesChange?.(
                { [name]: event.target.value },
                form.getFieldsValue()
              );
          }}
        />
      </span>
    );
  };
  return { Form, Input };
});

const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: '0x1111111111111111111111111111111111111111',
            xpub: 'public-a',
            balances: { ethereum: '10', syscoin: '10' },
          },
        },
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 1,
        url: 'https://rpc.invalid',
        apiUrl: 'https://api.invalid',
        explorer: 'https://explorer.invalid',
        currency: 'ETH',
        slip44: 60,
      },
      accountTransactions: {},
      isBitcoinBased: false,
    },
    vaultGlobal: {},
    price: { fiat: { asset: 'USD' } },
    testAssets: { ethereum: [], syscoin: [] },
  };
  mockLocation = { pathname: '/send/eth', search: '', hash: '', state: null };
  mockSave.mockReset().mockResolvedValue(undefined);
  mockNavigate.mockReset();
  mockEmitter
    .mockReset()
    .mockImplementation(() => new Promise(() => undefined));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn() },
  });
});

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s healthy control announces successful address copy',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    (navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined);
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    await act(async () => undefined);
    expect(mockAlert.success).toHaveBeenCalledWith('home.addressCopied');
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s must wait before announcing a delayed address copy',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const write = deferred();
    (navigator.clipboard.writeText as jest.Mock).mockReturnValue(write.promise);
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    expect(mockAlert.success).not.toHaveBeenCalled();
    await act(async () => write.resolve(undefined));
    expect(mockAlert.success).toHaveBeenCalledWith('home.addressCopied');
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s must report a refused address copy without reporting success',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const refusal = Promise.reject(new Error('Synthetic clipboard refusal'));
    // Observe the injected rejection at the test boundary so the test records
    // the incorrect feedback rather than failing on an unhandled rejection.
    void refusal.catch(() => undefined);
    (navigator.clipboard.writeText as jest.Mock).mockReturnValue(refusal);
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    await act(async () => undefined);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s reports a synchronous clipboard refusal without success',
  (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    (navigator.clipboard.writeText as jest.Mock).mockImplementation(() => {
      throw new Error('Synthetic clipboard refusal');
    });
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s ignores an earlier copy failure after a newer copy succeeds',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const earlier = deferred();
    (navigator.clipboard.writeText as jest.Mock)
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(undefined);
    render(<Component />);
    const copy = screen.getByRole('button', { name: 'buttons.copy' });
    fireEvent.click(copy);
    fireEvent.click(copy);
    await act(async () => undefined);
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
    await act(async () => earlier.reject(new Error('Earlier copy refused')));
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s suppresses copy feedback after leaving the form',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const write = deferred();
    (navigator.clipboard.writeText as jest.Mock).mockReturnValue(write.promise);
    const view = render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    view.unmount();
    await act(async () => write.resolve(undefined));
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s suppresses copy feedback after a synchronous wallet context change',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const write = deferred();
    (navigator.clipboard.writeText as jest.Mock).mockReturnValue(write.promise);
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    mockState.vault.activeNetwork.url = 'https://next-rpc.invalid/';
    await act(async () => write.resolve(undefined));
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s does not copy an obsolete visible address before React updates the form',
  (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    render(<Component />);
    mockState.vault.activeNetwork.url = 'https://next-rpc.invalid/';
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it.each([
  ['EVM', SendEth, false],
  ['UTXO', SendSys, true],
] as const)(
  '%s suppresses copy feedback after native navigation before React unmounts',
  async (_name, Component, bitcoinBased) => {
    mockState.vault.isBitcoinBased = bitcoinBased;
    mockLocation.pathname = bitcoinBased ? '/send/sys' : '/send/eth';
    const write = deferred();
    (navigator.clipboard.writeText as jest.Mock).mockReturnValue(write.promise);
    render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    window.history.replaceState(null, '', '/app.html#/home');
    await act(async () => write.resolve(undefined));
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);
