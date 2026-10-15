/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';
import { createNavigationContext, navigateWithContext } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';

import { SendConfirm } from './Confirm';
import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

let mockState: any;
let mockLocation: any;
let mockSubmitForm: () => Promise<void>;
let mockReceiverValidator: (_: unknown, value: string) => Promise<void>;
let mockAmountValidator: (_: unknown, value: string) => Promise<void>;
let mockFeeValidator: (_: unknown, value: string) => Promise<void>;
let mockUseRealFee = false;
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
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
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
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));
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
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  DeviceWaitingBanner: () => null,
  Fee: ({ form, onFeeChange, ...props }: any) =>
    mockUseRealFee ? (
      React.createElement(jest.requireActual('components/Fee/Fee').Fee, {
        form,
        onFeeChange,
        ...props,
      })
    ) : (
      <input
        aria-label="fee-rate"
        value={form.getFieldValue('fee') ?? ''}
        onChange={(event) => {
          form.setFieldValue('fee', event.target.value);
          onFeeChange(Number(event.target.value));
        }}
      />
    ),
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
  const Form = ({
    children,
    form,
    initialValues,
    onValuesChange,
    onFinish,
  }: any) => {
    const initialized = React.useRef(false);
    if (!initialized.current) {
      initialized.current = true;
      Object.assign(form.values, initialValues);
    }
    mockSubmitForm = () => onFinish(form.getFieldsValue());
    return (
      <FormContext.Provider value={{ form, onValuesChange }}>
        {children}
      </FormContext.Provider>
    );
  };
  Form.Item = function MockFormItem({ children, name, rules }: any) {
    if (name === 'receiver') {
      const factory = rules?.find((rule: any) => typeof rule === 'function');
      if (factory) mockReceiverValidator = factory().validator;
    }
    if (name === 'amount') {
      const factory = rules?.find((rule: any) => typeof rule === 'function');
      if (factory) mockAmountValidator = factory().validator;
    }
    if (name === 'fee') {
      const factory = rules?.find((rule: any) => typeof rule === 'function');
      if (factory) mockFeeValidator = factory().validator;
    }
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

describe('send forms across wallet navigation', () => {
  beforeEach(() => {
    mockUseRealFee = false;
    jest.clearAllMocks();
    Object.assign(mockStatus, {
      isUnlocked: true,
      isLoading: false,
      connectionUnavailable: false,
    });
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
            1: {
              id: 1,
              address: '0x2222222222222222222222222222222222222222',
              xpub: 'public-b',
              balances: { ethereum: '20', syscoin: '20' },
            },
          },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          kind: INetworkType.Ethereum,
          chainId: 1,
          url: 'https://rpc.example',
          apiUrl: 'https://api.example',
          explorer: 'https://explorer.example',
          currency: 'ETH',
          slip44: 60,
        },
        accountTransactions: {},
        isBitcoinBased: false,
      },
      vaultGlobal: {},
      price: { fiat: { asset: 'USD' } },
    };
    mockLocation = { pathname: '/send/eth', search: '', hash: '', state: null };
    mockSave.mockReset().mockResolvedValue(undefined);
    mockNavigate.mockReset();
    // Background probes remain pending; these tests exercise no signing/submission.
    mockEmitter
      .mockReset()
      .mockImplementation(() => new Promise(() => undefined));
  });

  const wrongNetworkSmartAddress = '0x3333333333333333333333333333333333333333';
  const currentNetworkSmartAddress =
    '0x4444444444444444444444444444444444444444';
  const addSmartRecipients = () => {
    mockState.vault.accounts.SmartAccount = {
      0: {
        id: 0,
        label: 'Smart account on another network',
        address: wrongNetworkSmartAddress,
        isSmartAccount: true,
        smartAccount: { chainId: 5700 },
      },
      1: {
        id: 1,
        label: 'Undeployed smart account on this network',
        address: currentNetworkSmartAddress,
        isSmartAccount: true,
        smartAccount: { chainId: 1, isDeployed: false },
      },
    };
    mockState.vault.accounts.HDAccount[1].label = 'Local EOA';
  };

  it('suggests only smart accounts belonging to the current network while keeping local EOAs', () => {
    addSmartRecipients();
    mockState.vault.accountTransactions = {
      HDAccount: {
        0: {
          ethereum: {
            1: [
              {
                from: mockState.vault.accounts.HDAccount[0].address,
                to: wrongNetworkSmartAddress,
                input: '0x',
                isError: '0',
              },
            ],
          },
        },
      },
    };
    render(<SendEth />);
    fireEvent.focus(screen.getByPlaceholderText('send.receiver'));
    expect(
      screen.queryByRole('button', {
        name: /Smart account on another network/,
      })
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: new RegExp(wrongNetworkSmartAddress),
      })
    ).toBeNull();
    expect(
      screen.getByRole('button', {
        name: /Undeployed smart account on this network/,
      })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Local EOA/ })).toBeTruthy();
  });

  it.each(['typed', 'restored'])(
    'rejects a %s wrong-network smart recipient before advancing or preparing a transaction',
    async (source) => {
      addSmartRecipients();
      if (source === 'restored') {
        mockLocation.state = {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: wrongNetworkSmartAddress, amount: '1' },
        };
      }
      render(<SendEth />);
      if (source === 'typed') {
        fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
          target: { value: wrongNetworkSmartAddress },
        });
        fireEvent.change(screen.getByPlaceholderText('send.amount'), {
          target: { value: '1' },
        });
      }
      mockEmitter.mockClear();
      await expect(
        mockReceiverValidator(undefined, wrongNetworkSmartAddress)
      ).rejects.toThrow('send.smartAccountWrongNetwork');
      // Exercise onFinish directly as well: a stale validation result must not
      // let a restored or manually entered recipient bypass the submit guard.
      await act(async () => {
        await mockSubmitForm();
      });
      expect(mockAlert.error).toHaveBeenCalledWith(
        'send.smartAccountWrongNetwork'
      );
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(navigateWithContext).not.toHaveBeenCalled();
    }
  );

  it('rejects an ENS recipient resolving to a smart account on another network without advancing', async () => {
    addSmartRecipients();
    mockEmitter.mockImplementation(([, method]: string[]) =>
      method === 'resolveEns'
        ? Promise.resolve(wrongNetworkSmartAddress)
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
      target: { value: 'wrong-network.eth' },
    });
    fireEvent.change(screen.getByPlaceholderText('send.amount'), {
      target: { value: '1' },
    });
    mockEmitter.mockClear();
    await act(async () => {
      await expect(
        mockReceiverValidator(undefined, 'wrong-network.eth')
      ).rejects.toThrow('send.smartAccountWrongNetwork');
    });
    await act(async () => {
      await mockSubmitForm();
    });
    expect(navigateWithContext).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'send.smartAccountWrongNetwork'
    );
    expect(
      mockEmitter.mock.calls.filter(([[, method]]) => method !== 'resolveEns')
    ).toHaveLength(0);
  });

  it.each(['undeployed smart account', 'EOA'])(
    'keeps a compatible %s valid for sending without a deployment lookup',
    async (kind) => {
      addSmartRecipients();
      const receiver =
        kind === 'EOA'
          ? mockState.vault.accounts.HDAccount[1].address
          : currentNetworkSmartAddress;
      mockLocation.state = {
        walletScope: getWalletNavigationScope(),
        formValues: { receiver, amount: '1' },
      };
      render(<SendEth />);
      mockEmitter.mockClear();
      await expect(
        mockReceiverValidator(undefined, receiver)
      ).resolves.toBeUndefined();
      await act(async () => {
        await mockSubmitForm();
      });
      expect(navigateWithContext).toHaveBeenCalledWith(
        mockNavigate,
        '/send/confirm',
        expect.objectContaining({
          tx: expect.objectContaining({ receivingAddress: receiver }),
        }),
        expect.any(Object)
      );
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it.each(
    ['native', 'token'].flatMap((kind) =>
      ['account', 'network', 'route', 'unmount', 'lock', 'connection'].map(
        (change) => ({ kind, change })
      )
    )
  )(
    'discards a pending $kind UTXO estimate after $change changes without reopening Confirm',
    async ({ kind, change }) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
          ...(kind === 'token'
            ? {
                selectedAsset: {
                  assetGuid: '123',
                  decimals: 8,
                  balance: '10',
                  symbol: 'SYSX',
                  assetType: 'SYSX',
                },
              }
            : {}),
        },
      };
      let finishEstimate!: (value: any) => void;
      const estimate = new Promise((resolve) => {
        finishEstimate = resolve;
      });
      mockEmitter.mockImplementation(([, , method]: string[]) =>
        method === 'getEstimateSysTransactionFee'
          ? estimate
          : Promise.resolve(0.0000001)
      );
      const view = render(<SendSys />);
      let pending!: Promise<void>;
      act(() => {
        pending = mockSubmitForm();
      });
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
        expect.any(Array)
      );
      if (change === 'account') mockState.vault.activeAccount.id = 1;
      if (change === 'network') mockState.vault.activeNetwork.chainId = 57;
      if (change === 'route')
        window.history.replaceState(null, '', '/app.html#/settings/about');
      if (change === 'unmount') view.unmount();
      if (change === 'lock') mockStatus.isUnlocked = false;
      if (change === 'connection') mockStatus.connectionUnavailable = true;
      await act(async () => {
        finishEstimate({ fee: 0.001, psbt: 'synthetic-unsigned-psbt' });
        await pending;
      });
      expect(navigateWithContext).not.toHaveBeenCalled();
      if (change === 'connection')
        expect(
          screen
            .getByRole('button', { name: 'buttons.next' })
            .getAttribute('aria-busy')
        ).toBe('false');
    }
  );

  it('keeps a completed UTXO preparation navigable while its form and wallet remain current', async () => {
    mockState.vault.isBitcoinBased = true;
    mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
    mockLocation = {
      ...mockLocation,
      pathname: '/send/sys',
      state: {
        walletScope: getWalletNavigationScope(),
        formValues: { receiver: 'recipient-a', amount: '1' },
      },
    };
    mockEmitter.mockImplementation(([, , method]: string[]) =>
      method === 'getEstimateSysTransactionFee'
        ? Promise.resolve({ fee: 0.001, psbt: 'synthetic-unsigned-psbt' })
        : Promise.resolve(0.0000001)
    );
    render(<SendSys />);
    // Let the initial recommended fee populate before the user submits.
    await act(async () => undefined);
    await act(async () => {
      await mockSubmitForm();
    });
    expect(navigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/send/confirm',
      expect.objectContaining({
        tx: expect.objectContaining({ psbt: 'synthetic-unsigned-psbt' }),
      }),
      expect.any(Object)
    );
  });

  it.each(
    ['native', 'token'].flatMap((kind) =>
      ['receiver', 'amount', 'fee', 'rbf', 'asset'].map((field) => ({
        kind,
        field,
      }))
    )
  )(
    'discards a pending $kind UTXO preparation after the user edits $field',
    async ({ kind, field }) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockState.testAssets = {
        ethereum: [],
        syscoin: [
          {
            assetGuid: '456',
            symbol: 'ALT',
            decimals: 8,
            balance: '10',
            assetType: 'SYSX',
          },
        ],
      };
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
          ...(kind === 'token'
            ? {
                selectedAsset: {
                  assetGuid: '123',
                  decimals: 8,
                  balance: '10',
                  symbol: 'SYSX',
                  assetType: 'SYSX',
                },
              }
            : {}),
        },
      };
      let finishEstimate!: (value: any) => void;
      const estimate = new Promise((resolve) => {
        finishEstimate = resolve;
      });
      mockEmitter.mockImplementation(([, , method]: string[]) =>
        method === 'getEstimateSysTransactionFee'
          ? estimate
          : Promise.resolve(0.0000001)
      );
      render(<SendSys />);
      await act(async () => undefined);
      let pending!: Promise<void>;
      act(() => {
        pending = mockSubmitForm();
      });
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
        expect.any(Array)
      );
      if (field === 'asset') {
        fireEvent.click(screen.getByText('ALT').closest('button'));
      } else if (field === 'rbf') {
        fireEvent.click(screen.getByRole('button', { name: 'rbf-switch' }));
      } else if (field === 'fee') {
        fireEvent.change(screen.getByRole('textbox', { name: 'fee-rate' }), {
          target: { value: '0.0000002' },
        });
      } else {
        fireEvent.change(screen.getByPlaceholderText(`send.${field}`), {
          target: { value: field === 'amount' ? '2' : 'recipient-b' },
        });
      }
      await act(async () => {
        finishEstimate({ fee: 0.001, psbt: 'stale-unsigned-psbt' });
        await pending;
      });
      expect(navigateWithContext).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole('button', { name: 'buttons.next' })
          .getAttribute('aria-busy')
      ).toBe('false');
    }
  );

  it.each(['account', 'route', 'unmount'])(
    'ignores an EVM onFinish callback returned by validation after %s departure',
    async (change) => {
      mockLocation.state = {
        walletScope: getWalletNavigationScope(),
        formValues: { receiver: 'recipient-a', amount: '1' },
      };
      const view = render(<SendEth />);
      const oldSubmit = mockSubmitForm;
      if (change === 'account') mockState.vault.activeAccount.id = 1;
      if (change === 'route')
        window.history.replaceState(null, '', '/app.html#/settings/about');
      if (change === 'unmount') view.unmount();
      await act(async () => {
        await oldSubmit();
      });
      expect(navigateWithContext).not.toHaveBeenCalled();
    }
  );

  it('discards an ENS validation response after native route departure', async () => {
    let finishResolution!: (value: string) => void;
    mockEmitter.mockImplementation(([, method]: string[]) =>
      method === 'resolveEns'
        ? new Promise((resolve) => {
            finishResolution = resolve;
          })
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    const pending = mockReceiverValidator(undefined, 'recipient.eth');
    const result = pending.catch((error) => error);
    mockSave.mockClear();
    window.history.replaceState(null, '', '/app.html#/settings/about');
    await act(async () => {
      finishResolution('0x3333333333333333333333333333333333333333');
      await result;
    });
    expect(await result).toBeInstanceOf(Error);
    expect(mockSave).not.toHaveBeenCalled();
    expect(navigateWithContext).not.toHaveBeenCalled();
  });

  it.each(['evm', 'utxo'])(
    'restores a matching %s draft once and keeps later typing during router mirrors',
    async (kind) => {
      const Component = kind === 'evm' ? SendEth : SendSys;
      if (kind === 'utxo') {
        mockState.vault.isBitcoinBased = true;
        mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
        mockLocation.pathname = '/send/sys';
      }
      mockLocation.state = {
        walletScope: getWalletNavigationScope(),
        formValues: { receiver: 'recipient-a', amount: '1' },
        isMaxSend: false,
      };
      const view = render(<Component />);
      expect(
        (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
      ).toBe('recipient-a');
      fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
        target: { value: 'recipient-b' },
      });
      fireEvent.change(screen.getByPlaceholderText('send.amount'), {
        target: { value: '2' },
      });
      const mirrored = mockNavigate.mock.calls.at(-1)![1].state;
      mockLocation = { ...mockLocation, state: mirrored };
      view.rerender(<Component />);
      expect(
        (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
      ).toBe('recipient-b');
      expect(
        (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
      ).toBe('2');
      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
      });
      expect(mockSave.mock.calls.at(-1)![2].formValues).toEqual(
        expect.objectContaining({
          receiver: 'recipient-b',
          amount: '2',
        })
      );
    }
  );

  it.each(['account', 'chain', 'rpc', 'api', 'xpub'])(
    'remounts the whole EVM draft when %s changes',
    (part) => {
      mockLocation.state = {
        walletScope: getWalletNavigationScope(),
        formValues: { receiver: 'old-recipient', amount: '9' },
      };
      const view = render(<SendEth />);
      expect(
        (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
      ).toBe('old-recipient');
      if (part === 'account') mockState.vault.activeAccount.id = 1;
      else if (part === 'chain') mockState.vault.activeNetwork.chainId = 42161;
      else if (part === 'rpc')
        mockState.vault.activeNetwork.url = 'https://other-rpc.example';
      else if (part === 'api')
        mockState.vault.activeNetwork.apiUrl = 'https://other-api.example';
      else
        mockState.vault.accounts.HDAccount[0].xpub =
          'different-vault-public-key';
      view.rerender(<SendEth />);
      expect(
        (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
      ).toBe('');
      expect(
        (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
      ).toBe('');
    }
  );

  it('drops an unstamped legacy UTXO draft and resets again after a slip44/vault change', () => {
    mockState.vault.isBitcoinBased = true;
    mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
    mockLocation = {
      ...mockLocation,
      pathname: '/send/sys',
      state: { formValues: { receiver: 'legacy-recipient', amount: '9' } },
    };
    const view = render(<SendSys />);
    expect(
      (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
    ).toBe('');
    fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
      target: { value: 'current-recipient' },
    });
    mockState.vault.activeNetwork.slip44 = 1;
    view.rerender(<SendSys />);
    expect(
      (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
    ).toBe('');
  });

  it.each([
    {
      amount: '90071992.54740993',
      balance: '90071992.54740993',
      isMax: true,
      expected: '90071992.54740992',
    },
    {
      amount: '90071992.54740993',
      balance: '90072000',
      isMax: false,
      expected: '90071992.54740993',
    },
  ])(
    'preserves exact large native amount through SendSys and Confirm (MAX=$isMax)',
    async ({ amount, balance, isMax, expected }) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockState.vault.activeNetwork.currency = 'SYS';
      mockState.vault.accounts.HDAccount[0].balances.syscoin = balance;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount },
        },
      };
      mockEmitter.mockImplementation(([, , method]: string[]) =>
        method === 'getEstimateSysTransactionFee'
          ? Promise.resolve({ fee: 1e-8, psbt: 'exact-unsigned-psbt' })
          : Promise.resolve(0.0000001)
      );
      const navigate = navigateWithContext as jest.Mock;
      navigate.mockImplementation((...args: any[]) =>
        jest.requireActual('utils/navigationState').navigateWithContext(...args)
      );
      try {
        const form = render(<SendSys />);
        await act(async () => undefined);
        await act(async () => {
          await mockSubmitForm();
        });
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
          [expect.objectContaining({ amount, isMax })]
        );
        const [path, options] = mockNavigate.mock.calls.find(
          ([target]) => target === '/send/confirm'
        )!;
        expect(options.state.tx.amount).toBe(amount);
        expect(options.state.tx.psbt).toBe('exact-unsigned-psbt');
        form.unmount();
        mockEmitter.mockClear();
        window.history.replaceState(null, '', '/app.html#/send/confirm');
        mockLocation = {
          key: `exact-native-${isMax}`,
          pathname: path,
          state: options.state,
        };
        render(<SendConfirm />);
        const headline = screen.getByText('buttons.send').parentElement!;
        expect(headline.querySelectorAll('p')[1].textContent?.trim()).toBe(
          `${expected} SYS`
        );
        if (isMax) {
          expect(
            screen.getByText('Total (send.amountAndFee)').textContent
          ).toContain('90,071,992.54740993 SYS');
        }
        expect(options.state.tx.amount).toBe(amount);
        expect(mockEmitter).not.toHaveBeenCalled();
      } finally {
        navigate.mockReset();
      }
    }
  );

  it.each(['SPT', 'EVM'])(
    'keeps the existing %s amount handoff and Confirm headline unchanged',
    async (kind) => {
      const isToken = kind === 'SPT';
      const amount = isToken ? '90071992.54740993' : '0.123456789012345678';
      const receiver = '0x3333333333333333333333333333333333333333';
      mockState.vault.isBitcoinBased = isToken;
      mockState.vault.activeNetwork.kind = isToken
        ? INetworkType.Syscoin
        : INetworkType.Ethereum;
      const asset = {
        assetGuid: '123',
        symbol: 'SPT',
        decimals: 8,
        balance: '100000000',
      };
      mockState.testAssets = {
        ethereum: [],
        syscoin: isToken ? [asset] : [],
      };
      mockLocation = {
        ...mockLocation,
        pathname: isToken ? '/send/sys' : '/send/eth',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver, amount },
          ...(isToken ? { selectedAsset: asset } : {}),
        },
      };
      mockEmitter.mockImplementation(([, , method]: string[]) =>
        method === 'getEstimateSysTransactionFee'
          ? Promise.resolve({ fee: 1e-8, psbt: 'token-unsigned-psbt' })
          : isToken
          ? Promise.resolve(0.0000001)
          : new Promise(() => undefined)
      );
      const navigate = navigateWithContext as jest.Mock;
      navigate.mockImplementation((...args: any[]) =>
        jest.requireActual('utils/navigationState').navigateWithContext(...args)
      );
      try {
        const form = render(isToken ? <SendSys /> : <SendEth />);
        await act(async () => undefined);
        await act(async () => {
          await mockSubmitForm();
        });
        const [path, options] = mockNavigate.mock.calls.find(
          ([target]) => target === '/send/confirm'
        )!;
        expect(options.state.tx.amount).toBe(amount);
        form.unmount();
        mockEmitter
          .mockReset()
          .mockImplementation(() => new Promise(() => undefined));
        window.history.replaceState(null, '', '/app.html#/send/confirm');
        mockLocation = {
          key: `control-${kind}`,
          pathname: path,
          state: options.state,
        };
        render(<SendConfirm />);
        const headline = screen.getByText('buttons.send').parentElement!;
        expect(headline.querySelectorAll('p')[1].textContent?.trim()).toBe(
          `${amount} ${isToken ? 'SPT' : 'ETH'}`
        );
        expect(options.state.tx.amount).toBe(amount);
        expect(
          mockEmitter.mock.calls.every(
            ([method]) => method[2] === 'getRecommendedGasPrice'
          )
        ).toBe(true);
      } finally {
        navigate.mockReset();
      }
    }
  );

  it.each([false, true])(
    'preserves an edited fee through actual Confirm Back (recommendation rejects=%s)',
    async (reject) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
        },
      };
      let recommendations = 0;
      mockEmitter.mockImplementation((path: string[]) => {
        const method = path[path.length - 1];
        if (method === 'getEstimateSysTransactionFee')
          return Promise.resolve({
            fee: 0.001,
            psbt: 'unchanged-unsigned-psbt',
          });
        if (method === 'getRecommendedFee') {
          recommendations++;
          if (recommendations > 1 && reject)
            return Promise.reject(new Error('recommendation unavailable'));
          return Promise.resolve(recommendations === 1 ? 1e-7 : 3e-7);
        }
        return Promise.resolve(undefined);
      });
      const nav = navigateWithContext as jest.Mock;
      const context = createNavigationContext as jest.Mock;
      nav.mockImplementation((...args: any[]) =>
        jest.requireActual('utils/navigationState').navigateWithContext(...args)
      );
      context.mockImplementation((...args: any[]) =>
        jest
          .requireActual('utils/navigationState')
          .createNavigationContext(...args)
      );
      try {
        const form = render(<SendSys />);
        await act(async () => undefined);
        fireEvent.change(screen.getByRole('textbox', { name: 'fee-rate' }), {
          target: { value: '0.0000002' },
        });
        await act(async () => {
          await mockSubmitForm();
        });
        const [, forward] = mockNavigate.mock.calls.find(
          ([path]) => path === '/send/confirm'
        )!;
        expect(forward.state.tx.feeRate).toBe(2e-7);
        form.unmount();
        window.history.replaceState(null, '', '/app.html#/send/confirm');
        mockLocation = {
          key: `fee-confirm-${reject}`,
          pathname: '/send/confirm',
          state: forward.state,
        };
        const confirm = render(<SendConfirm />);
        fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
        const [path, back] = mockNavigate.mock.calls
          .filter(([target]) => target === '/send/sys')
          .pop()!;
        expect(back.state.formValues.fee).toBe('0.0000002');
        confirm.unmount();
        window.history.replaceState(null, '', '/app.html#/send/sys');
        mockLocation = { pathname: path, state: back.state };
        render(<SendSys />);
        await act(async () => undefined);
        expect(
          (
            screen.getByRole('textbox', {
              name: 'fee-rate',
            }) as HTMLInputElement
          ).value
        ).toBe('0.0000002');
        await act(async () => {
          await mockSubmitForm();
        });
        const estimates = mockEmitter.mock.calls.filter(
          ([path]) => path[path.length - 1] === 'getEstimateSysTransactionFee'
        );
        expect(estimates[estimates.length - 1][1][0].feeRate).toBe(2e-7);
      } finally {
        nav.mockReset();
        context.mockReset();
      }
    }
  );

  it.each([false, true])(
    'does not overwrite a fee edit with a late recommendation (rejects=%s)',
    async (reject) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
        },
      };
      let finish!: (value: number) => void;
      let fail!: (reason: Error) => void;
      const recommendation = new Promise<number>((resolve, rejection) => {
        finish = resolve;
        fail = rejection;
      });
      mockEmitter.mockImplementation((path: string[]) =>
        path[path.length - 1] === 'getRecommendedFee'
          ? recommendation
          : Promise.resolve({ fee: 0.001, psbt: 'unchanged-unsigned-psbt' })
      );
      render(<SendSys />);
      fireEvent.change(screen.getByRole('textbox', { name: 'fee-rate' }), {
        target: { value: '0.0000002' },
      });
      await act(async () => {
        if (reject) fail(new Error('late recommendation failure'));
        else finish(3e-7);
      });
      expect(
        (screen.getByRole('textbox', { name: 'fee-rate' }) as HTMLInputElement)
          .value
      ).toBe('0.0000002');
      await act(async () => {
        await mockSubmitForm();
      });
      expect(navigateWithContext).toHaveBeenCalledWith(
        mockNavigate,
        '/send/confirm',
        expect.objectContaining({
          tx: expect.objectContaining({ feeRate: 2e-7 }),
        }),
        expect.any(Object)
      );
    }
  );

  it.each([false, true])(
    'retains a default recommendation for a fresh blank fee (rejects=%s)',
    async (reject) => {
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
        },
      };
      mockEmitter.mockImplementation((path: string[]) =>
        path[path.length - 1] === 'getRecommendedFee'
          ? reject
            ? Promise.reject(new Error('no recommendation'))
            : Promise.resolve(3e-7)
          : Promise.resolve({ fee: 0.001, psbt: 'unchanged-unsigned-psbt' })
      );
      render(<SendSys />);
      await act(async () => undefined);
      expect(
        Number(
          (
            screen.getByRole('textbox', {
              name: 'fee-rate',
            }) as HTMLInputElement
          ).value
        )
      ).toBe(reject ? 1e-7 : 3e-7);
    }
  );

  it.each([1e-8, 2e-8])(
    'uses exact native atomic MAX and affordability comparisons (fee=%s)',
    async (fee) => {
      const amount = '90071992.54740993';
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockState.vault.accounts.HDAccount[0].balances.syscoin =
        '90071992.54740994';
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount },
        },
      };
      mockEmitter.mockImplementation((path: string[]) =>
        path[path.length - 1] === 'getEstimateSysTransactionFee'
          ? Promise.resolve({ fee, psbt: 'exact-unsigned-psbt' })
          : Promise.resolve(1e-7)
      );
      render(<SendSys />);
      await act(async () => undefined);
      await expect(
        mockAmountValidator(undefined, '90071992.54740995')
      ).rejects.toThrow('send.insufficientFunds');
      await expect(
        mockAmountValidator(undefined, '90071992.547409931')
      ).rejects.toThrow('send.invalidAmount');
      await expect(
        mockAmountValidator(undefined, amount)
      ).resolves.toBeUndefined();
      await act(async () => {
        await mockSubmitForm();
      });
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'syscoinTransaction', 'getEstimateSysTransactionFee'],
        [expect.objectContaining({ amount, isMax: false })]
      );
      if (fee === 1e-8) expect(navigateWithContext).toHaveBeenCalled();
      else {
        expect(navigateWithContext).not.toHaveBeenCalled();
        expect(mockAlert.error).toHaveBeenCalledWith('send.insufficientFunds');
      }
    }
  );

  it.each(
    ['', '0', '-0.1'].flatMap((value) =>
      [false, true].map((reject) => ({ value, reject }))
    )
  )(
    'real Fee keeps explicit invalid/empty edit "$value" across late recommendation (reject=$reject)',
    async ({ value, reject }) => {
      mockUseRealFee = true;
      mockState.vault.isBitcoinBased = true;
      mockState.vault.activeNetwork.kind = INetworkType.Syscoin;
      mockLocation = {
        ...mockLocation,
        pathname: '/send/sys',
        state: {
          walletScope: getWalletNavigationScope(),
          formValues: { receiver: 'recipient-a', amount: '1' },
        },
      };
      let finish!: (value: number) => void;
      let fail!: (reason: Error) => void;
      const recommendation = new Promise<number>((resolve, rejection) => {
        finish = resolve;
        fail = rejection;
      });
      mockEmitter.mockImplementation((path: string[]) =>
        path[path.length - 1] === 'getRecommendedFee'
          ? recommendation
          : Promise.resolve(undefined)
      );
      const view = render(<SendSys />);
      const input = view.container.querySelector(
        '#fee-input'
      ) as HTMLInputElement;
      // Fee uses programmatic form writes; the fixture intentionally does not
      // emit onValuesChange for this field, nor a positive-only parent callback.
      if (value === '') fireEvent.change(input, { target: { value: '0' } });
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        if (reject) fail(new Error('late recommendation failure'));
        else finish(3e-7);
      });
      expect(input.value).toBe(value);
      await expect(mockFeeValidator(undefined, value)).rejects.toThrow(
        'send.invalidFeeRate'
      );
    }
  );

  it('rechecks restored NFT ownership and drops the NFT selection on network change', () => {
    mockLocation.state = {
      walletScope: getWalletNavigationScope(),
      selectedAsset: {
        id: 'nft-asset',
        contractAddress: '0x3333333333333333333333333333333333333333',
        chainId: 1,
        tokenSymbol: 'NFTALPHA',
        tokenStandard: 'ERC-721',
        isNft: true,
        balance: 50,
        decimals: 0,
      },
      formValues: { receiver: 'recipient', amount: '1', nftTokenId: '7' },
      selectedNftTokenId: '7',
      verifiedTokenBalance: 50,
      nftTokenIds: [{ tokenId: '7', balance: 50 }],
    };
    const view = render(<SendEth />);
    expect(screen.getAllByText(/NFTALPHA/).length).toBeGreaterThan(0);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'verifyERC721Ownership'],
      [
        '0x3333333333333333333333333333333333333333',
        '0x1111111111111111111111111111111111111111',
        ['7'],
      ]
    );
    expect(screen.getByText('send.verifyingOwnership')).toBeDefined();
    expect(screen.queryByText(/send.youOwnThisToken/)).toBeNull();
    mockState.vault.activeNetwork.chainId = 42161;
    view.rerender(<SendEth />);
    expect(screen.queryByText(/NFTALPHA/)).toBeNull();
    expect(
      (screen.getByPlaceholderText('send.receiver') as HTMLInputElement).value
    ).toBe('');
    expect(
      (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
    ).toBe('');
  });
});
