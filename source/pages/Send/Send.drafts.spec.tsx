/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';
import { navigateWithContext } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';

import { SendEth } from './SendEth';
import { SendSys } from './SendSys';

let mockState: any;
let mockLocation: any;
let mockSubmitForm: () => Promise<void>;
let mockReceiverValidator: (_: unknown, value: string) => Promise<void>;
const mockSave = jest.fn();
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
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
    alert: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
    useCopyClipboard: () => [false, jest.fn()],
  }),
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
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account:
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ],
    assets: { ethereum: [], syscoin: [] },
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
  Fee: () => null,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: false }) : children}</>
  );
  const Menu = Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass });
  return { Menu, Switch: ({ children }: any) => <>{children}</> };
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
    };
    mockLocation = { pathname: '/send/eth', search: '', hash: '', state: null };
    mockSave.mockReset().mockResolvedValue(undefined);
    mockNavigate.mockReset();
    // Background probes remain pending; these tests exercise no signing/submission.
    mockEmitter
      .mockReset()
      .mockImplementation(() => new Promise(() => undefined));
  });

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
    mockEmitter.mockResolvedValue({
      fee: 0.001,
      psbt: 'synthetic-unsigned-psbt',
    });
    render(<SendSys />);
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
