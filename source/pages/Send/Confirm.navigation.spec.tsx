/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { INetworkType } from 'types/network';
import { TransactionType } from 'types/transactions';
import { BigNumber } from 'utils/ethersV6Compat';
import { signAndSubmitSmartAccountExecutions } from 'utils/smartAccount';

import { SendConfirm } from './Confirm';

const mockControllerEmitter = jest.fn();
const mockClearNavigationState = jest.fn();
const mockSaveNavigationState = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateBack = jest.fn();
let mockAuth: {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};
let mockPublishedAuth: typeof mockAuth | undefined;
const mockAlert = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
let mockLocation: any;
let mockEntry = 0;
let mockConfirmClick: () => void;
let mockEip1559Compatible = false;
let mockAllowFeeEditing = false;
let mockAllowLegacyFeeEditing = false;
let mockEditedLegacyGasPrice = 0.123456789;
let mockNavigationScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};

const mockState: any = {
  vault: {
    activeNetwork: { chainId: 57, currency: 'SYS' },
    isBitcoinBased: true,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: 'synthetic-sender',
          balances: { syscoin: '100' },
        },
      },
    },
    accountTransactions: {},
  },
  price: { fiat: { asset: 'USD' } },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: mockNavigate,
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
    ...mockAuth,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockPublishedAuth || mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({
    isEIP1559Compatible: mockEip1559Compatible,
    forceRecheck: jest.fn(),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => {
    if (children === 'buttons.confirm') mockConfirmClick = onClick;
    return (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('./EditPriority', () => ({
  EditPriorityModal: ({ fee, setCustomFee }: any) =>
    mockAllowLegacyFeeEditing ? (
      <button
        onClick={() =>
          setCustomFee({
            isCustom: true,
            gasLimit: fee.gasLimit,
            gasPrice: mockEditedLegacyGasPrice,
            maxFeePerGas: 0,
            maxPriorityFeePerGas: 0,
          })
        }
      >
        choose-legacy-price
      </button>
    ) : mockAllowFeeEditing ? (
      <button
        onClick={() =>
          setCustomFee({
            isCustom: true,
            gasLimit: fee.gasLimit,
            gasPrice: 0,
            maxFeePerGas: fee.maxFeePerGas,
            maxPriorityFeePerGas: 0,
          })
        }
      >
        choose-zero-tip
      </button>
    ) : null,
}));
jest.mock('utils/index', () => ({
  clearNavigationState: () => mockClearNavigationState(),
  saveNavigationState: (...args: any[]) => mockSaveNavigationState(...args),
  ellipsis: (value: string) => value,
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
jest.mock('utils/navigationState', () => {
  const actual = jest.requireActual('utils/navigationState');
  return {
    clearTransactionNavigationState: (...args: any[]) =>
      mockClearNavigationState(...args),
    getTransactionReturnContext: actual.getTransactionReturnContext,
    getWalletNavigationScope: () => mockNavigationScope,
    navigateBack: (...args: any[]) => mockNavigateBack(...args),
  };
});
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: async () => ['function transfer(address,uint256)'],
  getErc721Abi: async () => [
    'function safeTransferFrom(address,address,uint256)',
  ],
  getErc1155Abi: async () => [
    'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  ],
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishedAuth = undefined;
  mockEip1559Compatible = false;
  mockAllowFeeEditing = false;
  mockAllowLegacyFeeEditing = false;
  mockEditedLegacyGasPrice = 0.123456789;
  window.history.replaceState(null, '', '/');
  mockAuth = {
    connectionUnavailable: false,
    isLoading: false,
    isUnlocked: true,
  };
  mockNavigateBack.mockImplementation((navigate: any, location: any) => {
    const context = location.state?.returnContext;
    navigate(context?.returnRoute || '/home');
  });
  mockState.vault.isBitcoinBased = true;
  mockState.vault.activeNetwork = { chainId: 57, currency: 'SYS' };
  mockState.vault.accounts = {
    HDAccount: {
      0: {
        id: 0,
        address: 'synthetic-sender',
        balances: { syscoin: '100' },
      },
    },
  };
  mockNavigationScope = {
    account: 'synthetic-account',
    network: 'synthetic-network',
  };
  mockLocation = {
    key: `entry-${++mockEntry}`,
    pathname: '/send/confirm',
    state: {
      submissionStarted: false,
      walletScope: mockNavigationScope,
      tx: {
        sender: 'synthetic-sender',
        receivingAddress: 'synthetic-recipient',
        amount: '1',
        fee: 0.00001,
        psbt: 'synthetic-psbt',
      },
      returnContext: {
        returnRoute: '/send/sys',
        walletScope: mockNavigationScope,
        state: { formValues: { amount: '1' } },
      },
    },
  };
  mockClearNavigationState.mockResolvedValue(undefined);
  (signAndSubmitSmartAccountExecutions as jest.Mock).mockResolvedValue({
    hash: 'synthetic-sa-hash',
  });
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    if (method === 'signSendAndSaveTransaction')
      return { txid: 'synthetic-txid' };
    return undefined;
  });
});

const wrongNetworkSmartAddress = '0x3333333333333333333333333333333333333333';
const currentNetworkSmartAddress = '0x4444444444444444444444444444444444444444';
const prepareEvmRecipientConfirmation = (receiver: string) => {
  mockState.vault.isBitcoinBased = false;
  mockState.vault.activeNetwork = {
    kind: INetworkType.Ethereum,
    chainId: 5700,
    currency: 'TSYS',
    url: 'https://rpc.example',
  };
  const sender = '0x1111111111111111111111111111111111111111';
  mockState.vault.accounts.HDAccount[0] = {
    id: 0,
    address: sender,
    balances: { ethereum: '100' },
  };
  mockState.vault.accounts.SmartAccount = {
    0: {
      id: 0,
      address: wrongNetworkSmartAddress,
      isSmartAccount: true,
      smartAccount: { chainId: 57042 },
    },
    1: {
      id: 1,
      address: currentNetworkSmartAddress,
      isSmartAccount: true,
      smartAccount: { chainId: 5700, isDeployed: false },
    },
  };
  mockLocation.state.tx = {
    sender,
    receivingAddress: receiver,
    amount: '1',
    transactionType: TransactionType.NATIVE_ETH,
    defaultGasLimit: 21000,
  };
  mockLocation.state.returnContext.returnRoute = '/send/eth';
  mockControllerEmitter.mockImplementation(async (path: string[]) => {
    const method = path.at(-1);
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    if (method === 'getRecommendedGasPrice') return '1000000000';
    if (method === 'getTxGasLimit') return '21000';
    if (method === 'sendAndSaveEthTransaction')
      return { hash: 'synthetic-evm-hash' };
    return undefined;
  });
};

const prepareZeroTipNativeConfirmation = (cached = false) => {
  prepareEvmRecipientConfirmation('0x2222222222222222222222222222222222222222');
  mockEip1559Compatible = true;
  const fees = {
    maxFeePerGas: BigNumber.from('2000000000'),
    maxPriorityFeePerGas: BigNumber.from(0),
  };
  if (cached)
    mockLocation.state.tx.cachedGasData = {
      maxFeePerGas: fees.maxFeePerGas.toHexString(),
      maxPriorityFeePerGas: '0x0',
    };
  const prior = mockControllerEmitter.getMockImplementation()!;
  mockControllerEmitter.mockImplementation((path: string[]) => {
    if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return fees;
    return prior(path);
  });
  return fees;
};

const prepareSmartAccountConfirmation = (isMax = false) => {
  prepareEvmRecipientConfirmation('0x2222222222222222222222222222222222222222');
  const sender = mockState.vault.accounts.HDAccount[0];
  sender.isSmartAccount = true;
  sender.smartAccount = { chainId: 5700, isDeployed: true };
  mockLocation.state.tx.isMax = isMax;
  const prior = mockControllerEmitter.getMockImplementation()!;
  mockControllerEmitter.mockImplementation((path: string[], args: any[]) => {
    if (path.at(-1) === 'getSmartAccountNativeGasStatus')
      return { gasUnitsReserve: '650000' };
    if (path.at(-1) === 'checkAddressBlacklist')
      return { isBlacklisted: false };
    return prior(path, args);
  });
};

it.each([false, true])(
  'forwards the exact edited positive legacy price to ordinary native SA execution (Max=%s)',
  async (isMax) => {
    prepareSmartAccountConfirmation(isMax);
    mockAllowLegacyFeeEditing = true;
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'choose-legacy-price' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() =>
      expect(signAndSubmitSmartAccountExecutions).toHaveBeenCalledTimes(1)
    );
    const sent = (signAndSubmitSmartAccountExecutions as jest.Mock).mock
      .calls[0][0];
    expect(sent.feeOverrides).toEqual({ gasPrice: '123456789' });
    expect(sent.executions).toEqual([
      {
        target: mockLocation.state.tx.receivingAddress,
        data: '0x',
        value: BigNumber.from(
          isMax
            ? BigInt('100000000000000000000') -
                BigInt(650000) * BigInt(123456789) -
                BigInt('1000000000000')
            : BigInt('1000000000000000000')
        ).toHexString(),
      },
    ]);
    expect(sent.onBeforeSubmit).toEqual(expect.any(Function));
  }
);

it.each([
  TransactionType.ERC20,
  TransactionType.ERC721,
  TransactionType.ERC1155,
])(
  'forwards the same explicit legacy price through the generic SA token consumer (%s)',
  async (transactionType) => {
    prepareSmartAccountConfirmation();
    mockAllowLegacyFeeEditing = true;
    mockLocation.state.tx.transactionType = transactionType;
    mockLocation.state.tx.token = {
      contractAddress: '0x5555555555555555555555555555555555555555',
      tokenId: '1',
      decimals: 18,
      name: 'Test token',
      symbol: 'TEST',
      isNft: transactionType !== TransactionType.ERC20,
    };
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'choose-legacy-price' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() =>
      expect(signAndSubmitSmartAccountExecutions).toHaveBeenCalledTimes(1)
    );
    const sent = (signAndSubmitSmartAccountExecutions as jest.Mock).mock
      .calls[0][0];
    expect(sent.feeOverrides).toEqual({ gasPrice: '123456789' });
    expect(sent.executions[0]).toMatchObject({
      target: mockLocation.state.tx.token.contractAddress,
      value: '0x0',
    });
    expect(sent.executions[0].data).toMatch(/^0x[\da-f]+$/i);
  }
);

it('binds the freshly read non-custom legacy Max price to both reserve and ordinary SA publication', async () => {
  prepareSmartAccountConfirmation(true);
  let priceReads = 0;
  const prior = mockControllerEmitter.getMockImplementation()!;
  mockControllerEmitter.mockImplementation(
    async (path: string[], args: any[]) => {
      if (path.at(-1) === 'getRecommendedGasPrice')
        return ++priceReads === 1 ? '1000000000' : '2000000000';
      return prior(path, args);
    }
  );
  render(<SendConfirm />);
  await waitFor(() =>
    expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(signAndSubmitSmartAccountExecutions).toHaveBeenCalledTimes(1)
  );
  const sent = (signAndSubmitSmartAccountExecutions as jest.Mock).mock
    .calls[0][0];
  expect(sent.feeOverrides).toEqual({ gasPrice: '2000000000' });
  expect(BigNumber.from(sent.executions[0].value).toString()).toBe(
    String(
      BigInt('100000000000000000000') -
        BigInt(650000) * BigInt('2000000000') -
        BigInt('1000000000000')
    )
  );
});

it.each([false, true])(
  'refuses a zero selected legacy SA price instead of fetching or sending different fees (Max=%s)',
  async (isMax) => {
    prepareSmartAccountConfirmation(isMax);
    mockAllowLegacyFeeEditing = true;
    mockEditedLegacyGasPrice = 0;
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'choose-legacy-price' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
    expect(signAndSubmitSmartAccountExecutions).not.toHaveBeenCalled();
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([path]) => path.at(-1) === 'getRecommendedGasPrice'
      )
    ).toHaveLength(1);
  }
);

it.each(['network', 'fee'])(
  'refuses to prepare/sign a Max SA execution after %s changes during reserve lookup',
  async (change) => {
    prepareSmartAccountConfirmation(true);
    mockAllowLegacyFeeEditing = true;
    let finishReserve!: (value: any) => void;
    const prior = mockControllerEmitter.getMockImplementation()!;
    mockControllerEmitter.mockImplementation((path: string[], args: any[]) => {
      if (path.at(-1) === 'getSmartAccountNativeGasStatus')
        return new Promise((resolve) => {
          finishReserve = resolve;
        });
      return prior(path, args);
    });
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(finishReserve).toBeDefined());
    if (change === 'network')
      mockNavigationScope = {
        ...mockNavigationScope,
        network: 'changed-network',
      };
    else
      fireEvent.click(
        screen.getByRole('button', { name: 'choose-legacy-price' })
      );
    await act(async () => finishReserve({ gasUnitsReserve: '650000' }));
    expect(signAndSubmitSmartAccountExecutions).not.toHaveBeenCalled();
  }
);

it('rechecks the approved native-SA fee selection immediately before publication after authenticator preparation', async () => {
  prepareSmartAccountConfirmation();
  mockAllowLegacyFeeEditing = true;
  let finishPreparation!: () => void;
  const publication = jest.fn();
  (signAndSubmitSmartAccountExecutions as jest.Mock).mockImplementation(
    async (options) => {
      await new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      await options.onBeforeSubmit();
      publication();
      return { hash: 'synthetic-sa-hash' };
    }
  );
  render(<SendConfirm />);
  await waitFor(() =>
    expect(screen.getAllByText(/0\.000021/).length).toBeGreaterThan(0)
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(finishPreparation).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'choose-legacy-price' }));
  await act(async () => finishPreparation());
  expect(publication).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalled();
});

it('retains positive-cap zero-tip EIP1559 SA pricing on the native Max path', async () => {
  prepareSmartAccountConfirmation(true);
  mockEip1559Compatible = true;
  mockAllowFeeEditing = true;
  const prior = mockControllerEmitter.getMockImplementation()!;
  mockControllerEmitter.mockImplementation((path: string[], args: any[]) => {
    if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return {
        maxFeePerGas: BigNumber.from('2000000000'),
        maxPriorityFeePerGas: BigNumber.from('1000000000'),
      };
    return prior(path, args);
  });
  render(<SendConfirm />);
  await waitFor(() =>
    expect(screen.getAllByText(/0\.000042/).length).toBeGreaterThan(0)
  );
  fireEvent.click(screen.getByRole('button', { name: 'choose-zero-tip' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(signAndSubmitSmartAccountExecutions).toHaveBeenCalledTimes(1)
  );
  expect(
    (signAndSubmitSmartAccountExecutions as jest.Mock).mock.calls[0][0]
      .feeOverrides
  ).toEqual({ maxFeePerGas: '2000000000', maxPriorityFeePerGas: '0' });
});

it.each([undefined, null])(
  'refuses missing fresh Max priority %p instead of copying an old native-SA tip',
  async (priority) => {
    prepareSmartAccountConfirmation(true);
    mockEip1559Compatible = true;
    let reads = 0;
    const prior = mockControllerEmitter.getMockImplementation()!;
    mockControllerEmitter.mockImplementation((path: string[], args: any[]) => {
      if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        return {
          maxFeePerGas: BigNumber.from('2000000000'),
          maxPriorityFeePerGas:
            ++reads === 1 ? BigNumber.from('1000000000') : priority,
        };
      return prior(path, args);
    });
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000042/).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
    expect(signAndSubmitSmartAccountExecutions).not.toHaveBeenCalled();
  }
);

it('keeps a genuinely fresh zero-tip Max quote as EIP1559 SA pricing without a custom selection', async () => {
  prepareSmartAccountConfirmation(true);
  mockEip1559Compatible = true;
  const prior = mockControllerEmitter.getMockImplementation()!;
  mockControllerEmitter.mockImplementation((path: string[], args: any[]) => {
    if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return {
        maxFeePerGas: BigNumber.from('2000000000'),
        maxPriorityFeePerGas: BigNumber.from(0),
      };
    return prior(path, args);
  });
  render(<SendConfirm />);
  await waitFor(() =>
    expect(screen.getAllByText(/0\.000042/).length).toBeGreaterThan(0)
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(signAndSubmitSmartAccountExecutions).toHaveBeenCalledTimes(1)
  );
  expect(
    (signAndSubmitSmartAccountExecutions as jest.Mock).mock.calls[0][0]
      .feeOverrides
  ).toEqual({ maxFeePerGas: '2000000000', maxPriorityFeePerGas: '0' });
});

it.each([false, true])(
  'preserves a valid native-send zero tip from fresh/cached fee data (%s)',
  async (cached) => {
    const fees = prepareZeroTipNativeConfirmation(cached);
    render(<SendConfirm />);
    await waitFor(() =>
      expect(
        mockControllerEmitter.mock.calls.some(
          ([path]) => path.at(-1) === 'getTxGasLimit'
        )
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'buttons.confirm' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000042/).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() =>
      expect(mockControllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'sendAndSaveEthTransaction'],
        [
          expect.objectContaining({
            to: mockLocation.state.tx.receivingAddress,
            maxFeePerGas: expect.anything(),
            maxPriorityFeePerGas: expect.anything(),
          }),
        ],
        expect.any(Number)
      )
    );
    const [, [sent, legacy]] = mockControllerEmitter.mock.calls.find(
      ([path]) => path.at(-1) === 'sendAndSaveEthTransaction'
    )!;
    expect(legacy).not.toBe(true);
    expect(BigNumber.from(sent.maxFeePerGas).toString()).toBe(
      fees.maxFeePerGas.toString()
    );
    expect(BigNumber.from(sent.maxPriorityFeePerGas).isZero()).toBe(true);
    expect(sent).not.toHaveProperty('gasPrice');
    if (cached)
      expect(
        mockControllerEmitter.mock.calls.some(
          ([path]) =>
            path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
        )
      ).toBe(false);
  }
);

it.each([
  TransactionType.NATIVE_ETH,
  TransactionType.ERC20,
  TransactionType.ERC721,
  TransactionType.ERC1155,
])(
  'preserves the user-selected zero tip at actual native/token submission (%s)',
  async (transactionType) => {
    const fees = prepareZeroTipNativeConfirmation();
    fees.maxPriorityFeePerGas = BigNumber.from('1000000000');
    mockAllowFeeEditing = true;
    mockLocation.state.tx.transactionType = transactionType;
    if (transactionType !== TransactionType.NATIVE_ETH) {
      mockLocation.state.tx.token = {
        contractAddress: '0x5555555555555555555555555555555555555555',
        tokenId: '1',
        decimals: 18,
        name: 'Test token',
        symbol: 'TEST',
        isNft: transactionType !== TransactionType.ERC20,
      };
    }
    render(<SendConfirm />);
    await waitFor(() =>
      expect(screen.getAllByText(/0\.000042/).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getByRole('button', { name: 'choose-zero-tip' }));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    const method =
      transactionType === TransactionType.NATIVE_ETH
        ? 'sendAndSaveEthTransaction'
        : 'sendAndSaveTokenTransaction';
    await waitFor(() =>
      expect(
        mockControllerEmitter.mock.calls.some(
          ([path]) => path.at(-1) === method
        )
      ).toBe(true)
    );
    const [, args] = mockControllerEmitter.mock.calls.find(
      ([path]) => path.at(-1) === method
    )!;
    const sent =
      transactionType === TransactionType.NATIVE_ETH ? args[0] : args[1];
    expect(BigNumber.from(sent.maxFeePerGas).toString()).toBe('2000000000');
    expect(BigNumber.from(sent.maxPriorityFeePerGas).isZero()).toBe(true);
    if (transactionType === TransactionType.NATIVE_ETH)
      expect(args[1]).not.toBe(true);
    else expect(sent.isLegacy).toBe(false);
  }
);

it.each([
  { maxFeePerGas: undefined, maxPriorityFeePerGas: '0' },
  { maxFeePerGas: '2000000000', maxPriorityFeePerGas: undefined },
  { maxFeePerGas: '0', maxPriorityFeePerGas: '0' },
  { maxFeePerGas: '2000000000', maxPriorityFeePerGas: '2000000001' },
  { maxFeePerGas: '2000000000', maxPriorityFeePerGas: null },
])(
  'does not fabricate a native-send zero-tip quote from missing or invalid fees %p',
  async (fees) => {
    prepareZeroTipNativeConfirmation();
    const prior = mockControllerEmitter.getMockImplementation()!;
    mockControllerEmitter.mockImplementation((path: string[]) => {
      if (path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
        return fees;
      return prior(path);
    });
    render(<SendConfirm />);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'buttons.confirm' })
          .hasAttribute('disabled')
      ).toBe(true)
    );
    await waitFor(() =>
      expect(screen.getAllByText('send.unableToLoad').length).toBeGreaterThan(0)
    );
    expect(
      mockControllerEmitter.mock.calls.some(
        ([path]) => path.at(-1) === 'sendAndSaveEthTransaction'
      )
    ).toBe(false);
  }
);

it('blocks a stale wrong-network smart recipient in confirmation before fee preparation or submission', async () => {
  prepareEvmRecipientConfirmation(wrongNetworkSmartAddress);
  render(<SendConfirm />);
  const confirm = screen.getByRole('button', { name: 'buttons.confirm' });
  expect(screen.getByText('send.smartAccountWrongNetwork')).toBeTruthy();
  expect(confirm.hasAttribute('disabled')).toBe(true);
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  // Calling the captured callback bypasses the DOM disabled attribute and
  // verifies that the submission boundary independently rejects the recipient.
  await act(async () => {
    mockConfirmClick();
  });
  expect(mockAlert.error).toHaveBeenCalledWith('send.smartAccountWrongNetwork');
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockClearNavigationState).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['undeployed smart account', 'EOA'])(
  'allows confirmation to send to a compatible %s using the normal transaction path',
  async (kind) => {
    const receiver =
      kind === 'EOA'
        ? '0x2222222222222222222222222222222222222222'
        : currentNetworkSmartAddress;
    prepareEvmRecipientConfirmation(receiver);
    render(<SendConfirm />);
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'buttons.confirm' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    expect(screen.queryByText('send.smartAccountWrongNetwork')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() =>
      expect(mockControllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'sendAndSaveEthTransaction'],
        [expect.objectContaining({ to: receiver }), true],
        expect.any(Number)
      )
    );
    expect(
      mockControllerEmitter.mock.calls.some(
        ([path]) => path.at(-1) === 'getCode'
      )
    ).toBe(false);
  }
);

it.each([
  { state: undefined, isBitcoinBased: true },
  { state: null, isBitcoinBased: false },
  { state: {}, isBitcoinBased: false },
])(
  'returns an empty direct confirmation home without RPC calls: %j',
  ({ state, isBitcoinBased }) => {
    mockLocation.state = state;
    mockState.vault.isBitcoinBased = isBitcoinBased;

    render(<SendConfirm />);

    expect(mockNavigate).toHaveBeenCalledWith('/home');
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(mockSaveNavigationState).not.toHaveBeenCalled();
  }
);

it('does not persist a confirmation payload or erase the caller on idle unmount', () => {
  const view = render(<SendConfirm />);
  expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy();
  expect(mockSaveNavigationState).not.toHaveBeenCalled();
  expect(mockClearNavigationState).not.toHaveBeenCalled();
  view.unmount();
  expect(mockClearNavigationState).not.toHaveBeenCalled();
});

it('Cancel returns to the immediate unsigned draft without submitting', () => {
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, {
    state: { returnContext: mockLocation.state.returnContext },
  });
  expect(mockNavigate).toHaveBeenCalledWith('/send/sys');
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});

it.each(['connectionUnavailable', 'isLoading'] as const)(
  'an idle %s trust check hides confirmation temporarily and recovers without discarding its draft',
  (trustField) => {
    const view = render(<SendConfirm />);
    mockAuth[trustField] = true;
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    mockAuth[trustField] = false;
    view.rerender(<SendConfirm />);
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  }
);

it('a departed confirmation cannot override Back before React commits the draft route', () => {
  const view = render(<SendConfirm />);
  window.history.replaceState(
    { key: 'new-draft-entry' },
    '',
    '/app.html#/send/sys'
  );
  view.rerender(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});

it('a late successful submission cannot replace a native caller departure with Home', async () => {
  let finishSend!: (value: any) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((resolve) => {
      finishSend = resolve;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(finishSend).toBeDefined());
  mockNavigate.mockClear();
  window.history.replaceState(
    { key: 'new-caller-entry' },
    '',
    '/app.html#/settings/about'
  );
  view.rerender(<SendConfirm />);
  await act(async () => finishSend({ txid: 'synthetic-txid' }));
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockAlert.success).not.toHaveBeenCalled();
});

it.each(['connectionUnavailable', 'isLoading'] as const)(
  '%s during preparation permanently prevents broadcast after trust recovers',
  async (trustField) => {
    let finishPreparation!: (value: any) => void;
    mockControllerEmitter.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        })
    );
    const view = render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(finishPreparation).toBeDefined());
    mockAuth[trustField] = true;
    view.rerender(<SendConfirm />);
    mockAuth[trustField] = false;
    view.rerender(<SendConfirm />);
    await act(async () => finishPreparation({ nativeBalance: '100' }));
    expect(mockControllerEmitter).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('/send/confirm', {
      replace: true,
      state: mockLocation.state,
    });
  }
);

it.each(['isLoading', 'connectionUnavailable'] as const)(
  'published %s before React commits blocks a prepared broadcast permanently',
  async (trustField) => {
    let finishPreparation!: (value: any) => void;
    mockControllerEmitter.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        })
    );
    const view = render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(finishPreparation).toBeDefined());
    mockPublishedAuth = { ...mockAuth, [trustField]: true };
    await act(async () => finishPreparation({ nativeBalance: '100' }));
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(0);
    mockPublishedAuth = { ...mockAuth };
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('/send/confirm', {
      replace: true,
      state: mockLocation.state,
    });
  }
);

it('an ambiguous attempt returns only to its public caller after trust recovers', async () => {
  mockLocation.state.returnContext.returnContext = {
    returnRoute: '/home?tab=activity',
    walletScope: mockNavigationScope,
    state: { tab: 'activity', tx: { psbt: 'private-history-payload' } },
  };
  let finishSend!: (value: any) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((resolve) => {
      finishSend = resolve;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(finishSend).toBeDefined());
  mockAuth.connectionUnavailable = true;
  view.rerender(<SendConfirm />);
  mockAuth.connectionUnavailable = false;
  view.rerender(<SendConfirm />);
  expect(screen.getByRole('status').textContent).toBe(
    'send.submissionStatusUnknown'
  );
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  expect(mockNavigate).toHaveBeenCalledWith('/home?tab=activity');
  const context = mockNavigateBack.mock.calls[0][1].state.returnContext;
  expect(JSON.stringify(context)).not.toContain('/send/sys');
  expect(JSON.stringify(context)).not.toContain('private-history-payload');
  await act(async () => finishSend({ txid: 'synthetic-txid' }));
  expect(mockAlert.success).not.toHaveBeenCalled();
});

it.each(['/send/confirm', '/external/tx/send/confirm'])(
  'discards persisted navigation before the first submission RPC on %s',
  async (pathname) => {
    mockLocation.pathname = pathname;
    let finishDiscard!: () => void;
    mockClearNavigationState.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        })
    );
    render(<SendConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockClearNavigationState).toHaveBeenCalledTimes(1);
    expect(mockClearNavigationState).toHaveBeenCalledWith({
      requireDiscard: true,
      assertCurrent: expect.any(Function),
    });
    expect(mockControllerEmitter).not.toHaveBeenCalled();

    await act(async () => finishDiscard());
    await waitFor(() =>
      expect(mockControllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'signSendAndSaveTransaction'],
        [{ psbt: 'synthetic-psbt', isTrezor: undefined, isLedger: undefined }],
        30000
      )
    );
    expect(mockSaveNavigationState).not.toHaveBeenCalled();
  }
);

it('storage discard failure stays on the active confirmation with a recoverable error and zero RPC', async () => {
  mockClearNavigationState.mockRejectedValueOnce(
    new Error('Synthetic storage failure')
  );
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith('send.cantCompleteTxs')
  );
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalledWith('/home');
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(false);
  mockAuth.isLoading = true;
  view.rerender(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  mockAuth.isLoading = false;
  view.rerender(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockControllerEmitter).toHaveBeenCalled());
});

it('does not save a confirmation again when submission outcome is unknown', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw new Error('Synthetic response lost after submission');
  });
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(mockClearNavigationState).toHaveBeenCalledTimes(1);
  expect(mockSaveNavigationState).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('status').textContent).toBe(
    'send.submissionStatusUnknown'
  );
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: {
      submissionStarted: true,
      walletScope: mockNavigationScope,
      returnContext: undefined,
    },
  });
});

it('removes transaction payload from history before RPC and rejects a duplicate pending attempt', async () => {
  let finishDiscard!: () => void;
  mockClearNavigationState.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishDiscard = resolve;
      })
  );
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: {
      submissionStarted: true,
      walletScope: mockNavigationScope,
      returnContext: undefined,
    },
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.cancel' })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  await act(async () => finishDiscard());
  await waitFor(() =>
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(1)
  );
});

it('a marker recreated by native Forward or a new document cannot confirm again', () => {
  mockLocation.state = { submissionStarted: true };
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('even an older consumed history entry cannot recreate an ambiguous confirmation', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw new Error('Synthetic response lost after submission');
  });
  const first = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  first.unmount();
  mockControllerEmitter.mockClear();
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('allows retry only after an explicitly safe pre-broadcast rejection', async () => {
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    throw Object.assign(new Error('Synthetic validation failure'), {
      transactionNotBroadcast: true,
    });
  });
  render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(
    screen
      .getByRole('button', { name: 'buttons.confirm' })
      .hasAttribute('disabled')
  ).toBe(false);
  expect(screen.queryByRole('status')).toBeNull();
  expect(mockNavigate).toHaveBeenCalledWith('/send/confirm', {
    replace: true,
    state: mockLocation.state,
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(
      mockControllerEmitter.mock.calls.filter(
        ([[, method]]) => method === 'signSendAndSaveTransaction'
      )
    ).toHaveLength(2)
  );
});

it('an early failure settling after departure cannot navigate back to confirmation', async () => {
  let rejectSend!: (error: Error) => void;
  mockControllerEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '100' };
    return new Promise((_, reject) => {
      rejectSend = reject;
    });
  });
  const view = render(<SendConfirm />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(rejectSend).toBeDefined());
  view.unmount();
  mockNavigate.mockClear();
  await act(async () =>
    rejectSend(
      Object.assign(new Error('Synthetic pre-broadcast failure'), {
        transactionNotBroadcast: true,
      })
    )
  );
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['account', 'network'])(
  'an idle confirmation exits when its %s scope changes',
  (field) => {
    const view = render(<SendConfirm />);
    mockNavigationScope = { ...mockNavigationScope, [field]: 'changed-scope' };
    view.rerender(<SendConfirm />);
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  }
);

it('does not revive an unstamped legacy internal transaction entry', () => {
  delete mockLocation.state.walletScope;
  render(<SendConfirm />);
  expect(screen.queryByRole('button', { name: 'buttons.confirm' })).toBeNull();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('keeps authoritative external confirmation context compatible with an unstamped payload', () => {
  mockLocation.pathname = '/external/tx/send/confirm';
  delete mockLocation.state.walletScope;
  render(<SendConfirm />);
  expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy();
  expect(mockControllerEmitter).not.toHaveBeenCalled();
});

it.each([
  { gross: 0.001, fee: 0.00000113, net: '0.00099887' },
  { gross: 1e-7, fee: 1e-8, net: '0.00000009' },
  { gross: 2e-8, fee: 1e-8, net: '0.00000001' },
  { gross: 1, fee: 0, net: '1' },
  { gross: '21000000.00000001', fee: 1e-8, net: '21000000' },
  { gross: 0.3, fee: 0.1, net: '0.2' },
])(
  'native MAX display shows exact net $net while retaining its gross transaction',
  ({ gross, fee, net }) => {
    const tx = { ...mockLocation.state.tx, amount: gross, fee, isMax: true };
    mockLocation.state.tx = tx;
    render(<SendConfirm />);

    const headline = screen.getByText('buttons.send').parentElement!;
    expect(headline.querySelectorAll('p')[1].textContent?.trim()).toBe(
      `${net} SYS`
    );
    expect(mockLocation.state.tx).toBe(tx);
    expect(tx.amount).toBe(gross);
    expect(tx.fee).toBe(fee);
    expect(tx.psbt).toBe('synthetic-psbt');
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  }
);

it('native MAX display leaves the total as gross debit and displays the quoted fee separately', () => {
  mockLocation.state.tx = {
    ...mockLocation.state.tx,
    amount: 0.001,
    fee: 0.00000113,
    isMax: true,
  };
  render(<SendConfirm />);
  expect(screen.getByText('Total (send.amountAndFee)').textContent).toContain(
    '0.00100000 SYS'
  );
  expect(screen.getByText('send.estimatedGasFee').textContent).toContain(
    '0.00000113 SYS'
  );
});

it.each([
  { isBitcoinBased: true, isMax: false, token: null, symbol: 'SYS' },
  {
    isBitcoinBased: true,
    isMax: true,
    token: { symbol: 'SPT', guid: '123', decimals: 8 },
    symbol: 'SPT',
  },
  { isBitcoinBased: false, isMax: true, token: null, symbol: 'SYS' },
])(
  'native MAX display leaves other headlines unchanged: %j',
  async ({ isBitcoinBased, isMax, token, symbol }) => {
    mockState.vault.isBitcoinBased = isBitcoinBased;
    mockLocation.state.tx = {
      ...mockLocation.state.tx,
      amount: 0.001,
      fee: 0.00000113,
      isMax,
      token,
    };
    await act(async () => {
      render(<SendConfirm />);
    });
    const headline = screen.getByText('buttons.send').parentElement!;
    expect(headline.querySelectorAll('p')[1].textContent?.trim()).toBe(
      `0.001 ${symbol}`
    );
  }
);

it.each([undefined, 'invalid-fee', -0.1, 2, 1e-9])(
  'native MAX display does not invent a net amount from invalid quote %p',
  (fee) => {
    mockLocation.state.tx = {
      ...mockLocation.state.tx,
      amount: 1,
      fee,
      isMax: true,
    };
    render(<SendConfirm />);
    const headline = screen.getByText('buttons.send').parentElement!;
    expect(headline.querySelectorAll('p')[1].textContent?.trim()).toBe(
      'send.calculating SYS'
    );
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  }
);
