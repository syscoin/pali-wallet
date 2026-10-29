/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  clearRpcCaches,
  getEthRpc,
  getSysRpc,
} from '@sidhujag/sysweb3-network';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { AccountHeader } from 'components/Header/AccountHeader';
import { SendEth } from 'pages/Send/SendEth';
import { SendSys } from 'pages/Send/SendSys';
import { KeyringAccountType } from 'types/network';

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
  selectActiveAccount: (state: any) =>
    state.vault.accounts[state.vault.activeAccount.type][
      state.vault.activeAccount.id
    ],
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
  ConfirmationModal: () => null,
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

const originalFetch = globalThis.fetch;
const RPC = 'https://rpc.synthetic.invalid';
const BLOCKBOOK = 'https://blockbook.synthetic.invalid';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const SYS_ADDRESS = 'tsys1qsyntheticpublicaddress';
const XPUB = 'tpubSyntheticPublicAccountIdentifier';
const CASES = [
  ['Home EVM', AccountHeader, false, false, false],
  ['Send EVM', SendEth, false, false, false],
  ['Home UTXO HD', AccountHeader, true, false, false],
  ['Send UTXO HD', SendSys, true, false, false],
  ['Home UTXO single-address import', AccountHeader, true, true, false],
  ['Send UTXO single-address import', SendSys, true, true, false],
  ['Home UTXO missing xpub', AccountHeader, true, false, true],
  ['Send UTXO missing xpub', SendSys, true, false, true],
] as const;
const EXPLORERS = [
  ['root', 'https://explorer.synthetic.invalid/'],
  ['path', 'https://explorer.synthetic.invalid/public/'],
  ['query', 'https://explorer.synthetic.invalid/public/?view=compact'],
] as const;
beforeEach(() => {
  jest.clearAllMocks();
  clearRpcCaches();
  window.history.replaceState(null, '', '/app.html');
  mockSave.mockReset().mockResolvedValue(undefined);
  mockNavigate.mockReset();
  mockEmitter
    .mockReset()
    .mockImplementation(() => new Promise(() => undefined));
  Object.values(mockAlert).forEach((fn) => fn.mockReset());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn() },
  });
  globalThis.fetch = jest.fn(async (url, options) => {
    if (String(url) === RPC) {
      expect(options?.method).toBe('POST');
      expect(JSON.parse(String(options?.body))).toEqual({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1644' }),
      } as Response;
    }
    expect(String(url)).toBe(BLOCKBOOK + '/api/v2');
    expect(options?.method).toBeUndefined();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        blockbook: { coin: 'Syscoin Testnet' },
        backend: { chain: 'test' },
      }),
    } as Response;
  });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});
describe.each(CASES)(
  '%s public explorer avatar',
  (_name, Component, bitcoinBased, singleAddress, missingXpub) => {
    it.each(EXPLORERS)(
      'preserves accepted %s explorer path and query',
      async (_variant, explorer) => {
        const data = {
          url: bitcoinBased ? BLOCKBOOK : RPC,
          explorer,
          label: 'Public synthetic network',
          symbol: 'SYS',
        };
        const result = bitcoinBased
          ? await getSysRpc(data)
          : await getEthRpc(data, false);
        const network = bitcoinBased
          ? (result as any).rpc.formattedNetwork
          : (result as any).formattedNetwork;
        expect(network.explorer).toBe(explorer);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const address = bitcoinBased ? SYS_ADDRESS : ADDRESS;
        const xpub = missingXpub ? undefined : singleAddress ? address : XPUB;
        const account = {
          id: 0,
          label: 'Public synthetic account',
          address,
          xpub,
          isImported: singleAddress,
          balances: { ethereum: '10', syscoin: '10' },
        };
        mockState = {
          vault: {
            accounts: { HDAccount: { 0: account } },
            activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
            activeNetwork: network,
            isBitcoinBased: bitcoinBased,
            accountTransactions: {},
          },
          vaultGlobal: {
            networkStatus: 'connected',
            isSwitchingAccount: false,
          },
          price: { fiat: { asset: 'USD' } },
          testAssets: { ethereum: [], syscoin: [] },
        };
        mockLocation = {
          pathname:
            Component === AccountHeader
              ? '/home'
              : bitcoinBased
              ? '/send/sys'
              : '/send/eth',
          search: '',
          hash: '',
          state: null,
          key: 'public-avatar',
        };
        const open = jest.spyOn(window, 'open').mockReturnValue(null);
        render(<Component />);
        fireEvent.click(
          Component === AccountHeader
            ? screen.getByTitle('home.viewAccountOnExplorer')
            : screen.getByRole('button', { name: 'home.viewAccountOnExplorer' })
        );
        const resource =
          bitcoinBased && !singleAddress && !missingXpub ? 'xpub' : 'address';
        const identifier = resource === 'xpub' ? XPUB : address;
        const expected = new URL(explorer);
        expected.pathname += resource + '/' + encodeURIComponent(identifier);
        expect(open).toHaveBeenCalledTimes(1);
        expect(open).toHaveBeenCalledWith(expected.href, '_blank');
        expect(mockState.vault.activeNetwork).toEqual(network);
        expect(network.url).toBe(data.url);
      }
    );
  }
);

it.each([
  ['Home', AccountHeader],
  ['Send', SendEth],
])(
  '%s keeps the account avatar noninteractive for an explicitly absent explorer',
  async (_name, Component) => {
    const { formattedNetwork } = await getEthRpc(
      { url: RPC, explorer: RPC, label: 'Synthetic', symbol: 'SYS' } as any,
      false
    );
    const network = { ...formattedNetwork, explorerExplicitlyAbsent: true };
    const account = {
      id: 0,
      label: 'Synthetic account',
      address: ADDRESS,
      balances: { ethereum: '10', syscoin: '10' },
    };
    mockState = {
      vault: {
        accounts: { HDAccount: { 0: account } },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: network,
        isBitcoinBased: false,
        accountTransactions: {},
      },
      vaultGlobal: { networkStatus: 'connected', isSwitchingAccount: false },
      price: { fiat: { asset: 'USD' } },
      testAssets: { ethereum: [], syscoin: [] },
    };
    mockLocation = {
      pathname: Component === AccountHeader ? '/home' : '/send/eth',
      search: '',
      hash: '',
      state: null,
      key: 'public-avatar',
    };
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    render(<Component />);
    const avatar = screen.getByRole('button', {
      name: 'home.viewAccountOnExplorer - settings.unavailable',
    });
    expect(avatar).toBeDisabled();
    fireEvent.click(avatar);
    expect(open).not.toHaveBeenCalled();
  }
);
