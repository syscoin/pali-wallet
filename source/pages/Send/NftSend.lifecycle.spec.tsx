/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';
import { navigateWithContext } from 'utils/index';
import { getWalletNavigationScope } from 'utils/navigationState';

import { SendEth } from './SendEth';

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
  useTranslation: () => ({
    t: (key: string, values?: { balance?: string | number }) =>
      key === 'send.nftAmountRange'
        ? jest
            .requireActual('../../assets/locales/en.json')
            .send.nftAmountRange.replace('{{balance}}', String(values?.balance))
        : key,
  }),
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

const firstNft = {
  id: 'collection-a',
  contractAddress: '0x3333333333333333333333333333333333333333',
  chainId: 1,
  tokenSymbol: 'COLLA',
  tokenStandard: 'ERC-721',
  isNft: true,
  balance: 1,
  decimals: 0,
};
const secondNft = {
  ...firstNft,
  id: 'collection-b',
  contractAddress: '0x4444444444444444444444444444444444444444',
  tokenSymbol: 'COLLB',
};
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const selectCollection = (symbol: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(symbol + '.*ERC-721') })
  );
const tokenInput = () =>
  screen.getByPlaceholderText('send.enterTokenId') as HTMLInputElement;
const ownedReply = (tokenId: string, balance = 1) => [
  { tokenId, balance, verified: true },
];

describe('NFT send lookup lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
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
      testAssets: { ethereum: [firstNft, secondNft], syscoin: [] },
    };
    mockLocation = { pathname: '/send/eth', search: '', hash: '', state: null };
    mockSave.mockReset().mockResolvedValue(undefined);
    mockNavigate.mockReset();
    // Only lookup replies are released. No transaction preparation, signing, or submission.
    mockEmitter
      .mockReset()
      .mockImplementation(() => new Promise(() => undefined));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps an unknown collection caption unavailable while verifying the exact token normally', async () => {
    const unknown = { ...firstNft, balance: undefined };
    mockState.testAssets.ethereum = [unknown];
    mockLocation.state = {
      walletScope: getWalletNavigationScope(),
      selectedAsset: unknown,
      selectedNftTokenId: '11',
      formValues: { receiver: 'recipient', amount: '1', nftTokenId: '11' },
    };
    const ownership = deferred();
    mockEmitter.mockImplementation(([, method]) =>
      method === 'verifyERC721Ownership'
        ? ownership.promise
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    expect(screen.getByText('settings.unavailable')).toBeTruthy();
    await act(async () => ownership.resolve(ownedReply('11')));
    expect(screen.getByText(/send.youOwnThisToken/)).toBeTruthy();
    expect(screen.getByText('settings.unavailable')).toBeTruthy();
    expect(navigateWithContext).not.toHaveBeenCalled();
  });

  it('keeps the selected collection token ID when an older collection enumeration resolves', async () => {
    const first = deferred();
    const second = deferred();
    mockEmitter.mockImplementation(([, method], args) =>
      method === 'fetchNftTokenIds'
        ? args[0] === firstNft.contractAddress
          ? first.promise
          : second.promise
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    selectCollection('COLLA');
    selectCollection('COLLB');
    await act(async () =>
      second.resolve({
        tokens: ownedReply('22'),
        hasMore: false,
        requiresManualEntry: false,
      })
    );
    expect(tokenInput().value).toBe('22');
    expect(screen.getByRole('button', { name: '#22' })).toBeTruthy();
    await act(async () =>
      first.resolve({
        tokens: ownedReply('11'),
        hasMore: false,
        requiresManualEntry: false,
      })
    );
    expect(tokenInput().value).toBe('22');
    expect(screen.queryByRole('button', { name: '#11' })).toBeNull();
    expect(screen.getByRole('button', { name: '#22' })).toBeTruthy();
  });

  it('does not release the newer collection loading state when an older enumeration settles', async () => {
    const first = deferred();
    const second = deferred();
    mockEmitter.mockImplementation(([, method], args) =>
      method === 'fetchNftTokenIds'
        ? args[0] === firstNft.contractAddress
          ? first.promise
          : second.promise
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    selectCollection('COLLA');
    selectCollection('COLLB');
    await act(async () =>
      first.resolve({
        tokens: ownedReply('11'),
        hasMore: false,
        requiresManualEntry: false,
      })
    );
    const loadingInput = screen.getByPlaceholderText(
      'networkConnection.loadingNfts'
    ) as HTMLInputElement;
    expect(loadingInput.disabled).toBe(true);
    expect(loadingInput.value).toBe('');
    await act(async () =>
      second.resolve({
        tokens: ownedReply('22'),
        hasMore: false,
        requiresManualEntry: false,
      })
    );
    expect(tokenInput().value).toBe('22');
  });

  it('keeps a newer manual token ownership failure when an older success resolves', async () => {
    const first = deferred();
    const second = deferred();
    mockEmitter.mockImplementation(([, method], args) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: [],
          hasMore: false,
          requiresManualEntry: true,
        });
      if (method === 'verifyERC721Ownership')
        return args[2][0] === '11' ? first.promise : second.promise;
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    fireEvent.change(tokenInput(), { target: { value: '11' } });
    await act(async () => jest.advanceTimersByTime(500));
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    await act(async () => jest.advanceTimersByTime(500));
    await act(async () => second.resolve(ownedReply('22', 0)));
    expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
    await act(async () => first.resolve(ownedReply('11')));
    expect(tokenInput().value).toBe('22');
    expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
    expect(screen.queryByText(/send.youOwnThisToken/)).toBeNull();
  });

  it('keeps the selected ERC1155 quantity bound to that token after an older ownership result', async () => {
    const first = deferred();
    const priorMulti = {
      ...firstNft,
      tokenStandard: 'ERC-1155',
      tokenId: '11',
      balance: 99,
    };
    const multi = {
      ...secondNft,
      tokenStandard: 'ERC-1155',
      tokenId: '22',
      balance: 3,
    };
    mockState.testAssets.ethereum = [priorMulti, multi];
    mockLocation.state = {
      walletScope: getWalletNavigationScope(),
      selectedAsset: priorMulti,
      selectedNftTokenId: '11',
      formValues: { receiver: 'recipient', amount: '1', nftTokenId: '11' },
    };
    mockEmitter.mockImplementation(([, method]) =>
      method === 'verifyERC1155Ownership'
        ? first.promise
        : new Promise(() => undefined)
    );
    render(<SendEth />);
    fireEvent.click(screen.getByRole('button', { name: /COLLB.*ERC-1155/ }));
    await act(async () => first.resolve(ownedReply('11', 99)));
    fireEvent.click(screen.getByRole('button', { name: 'send.max' }));
    expect(
      (screen.getByPlaceholderText('Amount (1-3)') as HTMLInputElement).value
    ).toBe('3');
  });

  it('uses the current enumeration and manual ownership reply normally', async () => {
    mockEmitter.mockImplementation(([, method], args) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: ownedReply('11'),
          hasMore: false,
          requiresManualEntry: false,
        });
      if (method === 'verifyERC721Ownership')
        return Promise.resolve(ownedReply(args[2][0]));
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    expect(tokenInput().value).toBe('11');
    expect(screen.getByRole('button', { name: '#11' })).toBeTruthy();
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    await act(async () => jest.advanceTimersByTime(500));
    expect(tokenInput().value).toBe('22');
    expect(screen.getByText(/send.youOwnThisToken/)).toBeTruthy();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'verifyERC721Ownership'],
      [
        firstNft.contractAddress,
        mockState.vault.accounts.HDAccount[0].address,
        ['22'],
      ]
    );
    expect(navigateWithContext).not.toHaveBeenCalled();
  });

  it('does not populate the new account form with an old account enumeration', async () => {
    const first = deferred();
    mockEmitter.mockImplementation(([, method]) =>
      method === 'fetchNftTokenIds'
        ? first.promise
        : new Promise(() => undefined)
    );
    const view = render(<SendEth />);
    selectCollection('COLLA');
    mockState.vault.activeAccount = {
      id: 1,
      type: KeyringAccountType.HDAccount,
    };
    view.rerender(<SendEth />);
    await act(async () =>
      first.resolve({
        tokens: ownedReply('11'),
        hasMore: false,
        requiresManualEntry: false,
      })
    );
    expect(screen.queryByPlaceholderText('send.enterTokenId')).toBeNull();
    expect(screen.queryByRole('button', { name: '#11' })).toBeNull();
    expect(
      (screen.getByPlaceholderText('send.amount') as HTMLInputElement).value
    ).toBe('');
  });

  it.each(['native', 'ERC-20'])(
    'does not report an obsolete enumeration error after selecting %s',
    async (target) => {
      const first = deferred();
      const token = { ...secondNft, isNft: false, tokenStandard: 'ERC-20' };
      mockState.testAssets.ethereum = [firstNft, token];
      mockEmitter.mockImplementation(([, method]) =>
        method === 'fetchNftTokenIds'
          ? first.promise
          : new Promise(() => undefined)
      );
      render(<SendEth />);
      selectCollection('COLLA');
      fireEvent.click(
        screen.getByRole('button', {
          name: target === 'native' ? 'ETH send.native' : /COLLB.*ERC-20/,
        })
      );
      const logged = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        await act(async () =>
          first.reject(new Error('obsolete enumeration failed'))
        );
        expect(mockAlert.error).not.toHaveBeenCalled();
        expect(
          screen.queryByPlaceholderText('networkConnection.loadingNfts')
        ).toBeNull();
        expect(screen.queryByPlaceholderText('send.enterTokenId')).toBeNull();
      } finally {
        logged.mockRestore();
      }
    }
  );

  it('does not show old ownership while the newly typed token waits for its lookup', async () => {
    const first = deferred();
    mockEmitter.mockImplementation(([, method]) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: [],
          hasMore: false,
          requiresManualEntry: true,
        });
      if (method === 'verifyERC721Ownership') return first.promise;
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    fireEvent.change(tokenInput(), { target: { value: '11' } });
    await act(async () => jest.advanceTimersByTime(500));
    fireEvent.change(tokenInput(), { target: { value: '' } });
    await act(async () => first.resolve(ownedReply('11')));
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    expect(screen.queryByText(/send.youOwnThisToken/)).toBeNull();
    expect(tokenInput().value).toBe('22');
  });

  it('keeps the newer manual lookup pending when an older request finishes', async () => {
    const first = deferred();
    const second = deferred();
    mockEmitter.mockImplementation(([, method], args) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: [],
          hasMore: false,
          requiresManualEntry: true,
        });
      if (method === 'verifyERC721Ownership')
        return args[2][0] === '11' ? first.promise : second.promise;
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    fireEvent.change(tokenInput(), { target: { value: '11' } });
    await act(async () => jest.advanceTimersByTime(500));
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    await act(async () => jest.advanceTimersByTime(500));
    await act(async () => first.resolve(ownedReply('11')));
    expect(screen.getByText('send.verifyingOwnership')).toBeTruthy();
    expect(screen.queryByText(/send.youOwnThisToken/)).toBeNull();
    await act(async () => second.resolve(ownedReply('22', 0)));
    expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
  });

  it('keeps the current no-ownership response visible', async () => {
    mockEmitter.mockImplementation(([, method]) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: [],
          hasMore: false,
          requiresManualEntry: true,
        });
      if (method === 'verifyERC721Ownership')
        return Promise.resolve(ownedReply('22', 0));
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    await act(async () => jest.advanceTimersByTime(500));
    expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
    expect(screen.queryByText('send.verifyingOwnership')).toBeNull();
  });

  it('keeps restored ownership live through StrictMode effect replay', async () => {
    const restored = deferred();
    mockLocation.state = {
      walletScope: getWalletNavigationScope(),
      selectedAsset: firstNft,
      selectedNftTokenId: '11',
      formValues: { receiver: 'recipient', amount: '1', nftTokenId: '11' },
    };
    mockEmitter.mockImplementation(([, method]) =>
      method === 'verifyERC721Ownership'
        ? restored.promise
        : new Promise(() => undefined)
    );
    render(
      <React.StrictMode>
        <SendEth />
      </React.StrictMode>
    );
    expect(screen.getByText('send.verifyingOwnership')).toBeTruthy();
    await act(async () => restored.resolve(ownedReply('11')));
    expect(screen.getByText(/send.youOwnThisToken/)).toBeTruthy();
    expect(screen.queryByText('send.verifyingOwnership')).toBeNull();
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) => method === 'verifyERC721Ownership'
      )
    ).toHaveLength(1);
  });

  it('keeps a discovered token selected when an older manual verification rejects', async () => {
    const manual = deferred();
    mockEmitter.mockImplementation(([, method]) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: ownedReply('11'),
          hasMore: false,
          requiresManualEntry: false,
        });
      if (method === 'verifyERC721Ownership') return manual.promise;
      return new Promise(() => undefined);
    });
    render(<SendEth />);
    selectCollection('COLLA');
    await act(async () => undefined);
    fireEvent.change(tokenInput(), { target: { value: '22' } });
    await act(async () => jest.advanceTimersByTime(500));
    expect(screen.getByText('send.verifyingOwnership')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '#11' }));
    const logged = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await act(async () =>
        manual.reject(new Error('obsolete ownership request failed'))
      );
      expect(logged).not.toHaveBeenCalled();
      expect(tokenInput().value).toBe('11');
      expect(screen.getByRole('button', { name: '#11' }).className).toContain(
        'bg-brand-royalblue'
      );
      expect(screen.queryByText('send.verifyingOwnership')).toBeNull();
      expect(screen.queryByText(/send.verificationFailed/)).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });
});
