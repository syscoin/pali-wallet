/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { BigNumber, Interface } from 'utils/ethersV6Compat';
import { saveNavigationState } from 'utils/navigationState';

import { SendTransaction } from './SendTransaction';

const mockEmitter = jest.fn();
const mockClose = jest.fn();
const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockRemove = jest.fn();
const mockFee = jest.fn();
const mockSmartSubmit = jest.fn();
const mockHandleTransactionError = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn(), info: jest.fn() };
let mockStorage: Record<string, any>;
let mockButtonHandlers: Record<string, () => any>;
let mockQuery: any;
let mockState: any;
let mockLocation: any;
let mockShowSmartFeeEditor = false;
let mockEditHandlers: {
  fee?: (value: any) => void;
  nonce?: (value: number) => void;
  open?: (value: boolean) => void;
};

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'send.tokenId'
        ? jest.requireActual('../../assets/locales/en.json').send.tokenId
        : key,
  }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: (...args: any[]) => mockGet(...args),
    setItem: (...args: any[]) => mockSet(...args),
    removeItem: (...args: any[]) => mockRemove(...args),
  },
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/fetchGasAndDecodeFunction', () => ({
  fetchGasAndDecodeFunction: async (...args: any[]) => {
    const result = await mockFee(...args);
    // Synthetic successful background quote for lifecycle tests; the real
    // quote builder and required-prefund arithmetic have separate tests.
    if (
      mockState.vault.accounts[mockState.vault.activeAccount.type][
        mockState.vault.activeAccount.id
      ].isSmartAccount &&
      result.feeDetails.smartAccountFeeQuote === undefined
    ) {
      result.feeDetails.smartAccountFeeQuote = {
        gasUnits: '863456',
        maximumFeeWei: '43172800000000000',
      };
    }
    return result;
  },
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  signAndSubmitSmartAccountExecutions: (...args: any[]) =>
    mockSmartSubmit(...args),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: (...args: any[]) =>
    mockHandleTransactionError(...args),
}));
jest.mock('utils/logger', () => ({ logError: jest.fn() }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => {
    mockButtonHandlers[String(children)] = onClick;
    return (
      <button onClick={onClick} disabled={disabled || loading}>
        {children}
      </button>
    );
  },
  DeviceWaitingBanner: () => null,
  WarningModal: () => null,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('./components', () => ({
  ApprovalDetails: (props: any) => (
    <pre data-testid="reviewed-approval">{JSON.stringify(props)}</pre>
  ),
  TransactionDetailsComponent: ({
    tx,
    customFee,
    customNonce,
    editingDisabled,
    setCustomNonce,
    setIsOpen,
  }: any) => {
    mockEditHandlers.nonce = setCustomNonce;
    mockEditHandlers.open = setIsOpen;
    return (
      <>
        <pre data-testid="reviewed-custom-fee">{JSON.stringify(customFee)}</pre>
        <input
          aria-label="reviewed-nonce"
          disabled={editingDisabled}
          value={customNonce ?? tx.nonce}
          onChange={(event) => setCustomNonce(Number(event.target.value))}
        />
        <button disabled={editingDisabled} onClick={() => setIsOpen(true)}>
          open-synthetic-fee
        </button>
      </>
    );
  },
  TransactionDataComponent: ({ decodedTx }: any) => (
    <pre data-testid="transaction-data">{JSON.stringify(decodedTx)}</pre>
  ),
  TransactionHexComponent: ({ dataHex }: any) => (
    <pre data-testid="transaction-hex">{dataHex}</pre>
  ),
}));
jest.mock('./EditPriority', () => ({
  EditPriorityModal: ({ setCustomFee }: any) => {
    mockEditHandlers.fee = setCustomFee;
    return mockShowSmartFeeEditor ? (
      <button
        onClick={() =>
          setCustomFee({
            isCustom: true,
            gasLimit: 21000,
            gasPrice: 0,
            maxFeePerGas: 7,
            maxPriorityFeePerGas: 1,
          })
        }
      >
        edit-synthetic-fee
      </button>
    ) : null;
  },
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: async () => ['function approve(address,uint256)'],
}));

const prepare = async (external = true) => {
  mockQuery.external = external;
  await saveNavigationState('/send/eth', undefined, {
    formValues: { receiver: mockQuery.tx.to, amount: '1' },
  });
  const view = render(<SendTransaction />);
  await waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeDefined();
  });
  mockEmitter.mockClear();
  mockGet.mockClear();
  return view;
};
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage = {};
  mockButtonHandlers = {};
  mockShowSmartFeeEditor = false;
  mockEditHandlers = {};
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: `0x${'11'.repeat(20)}`,
            balances: { ethereum: '1' },
          },
        },
      },
      activeNetwork: {
        chainId: 1,
        currency: 'ETH',
        url: 'https://rpc.example',
      },
    },
    vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 30 } },
  };
  mockQuery = {
    host: 'https://dapp.example',
    eventName: 'sendTransaction',
    external: true,
    tx: {
      from: mockState.vault.accounts.HDAccount[0].address,
      to: `0x${'22'.repeat(20)}`,
      data: '0x',
      value: '0x0',
    },
    decodedTx: { method: 'transfer' },
    txMetadata: {},
  };
  mockLocation = {
    state: {
      tx: mockQuery.tx,
      decodedTx: mockQuery.decodedTx,
      txMetadata: {},
    },
  };
  mockGet.mockImplementation(async (key) => mockStorage[key] || null);
  mockSet.mockImplementation(async (key, value) => (mockStorage[key] = value));
  mockRemove.mockImplementation(async (key) => delete mockStorage[key]);
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '1' };
    if (method === 'sendAndSaveEthTransaction')
      return { hash: 'public-test-hash' };
    throw Error(`Unexpected method: ${method}`);
  });
  mockFee.mockImplementation(async () => ({
    feeDetails: {
      gasLimit: 21000,
      maxFeePerGas: 2,
      maxPriorityFeePerGas: 1,
    },
    formTx: { ...mockQuery.tx, gasLimit: BigNumber.from(21000), nonce: 0 },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  }));
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  mockSmartSubmit.mockResolvedValue({ hash: 'public-sa-test-hash' });
  mockHandleTransactionError.mockReturnValue(false);
});
afterEach(() => jest.restoreAllMocks());

jest.mock('components/Icon/Icon', () => ({
  Icon: () => <svg aria-hidden="true" />,
}));
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
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
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

const SPENDER = '0x3333333333333333333333333333333333333333';
const TOKEN_INFO = {
  name: 'Synthetic token',
  symbol: 'UNIT',
  decimals: 6,
  balance: '10',
};
type MetadataRequest = {
  chain: number;
  expectedContext: unknown;
  resolve: (value: typeof TOKEN_INFO) => void;
};

const prepareApproval = async (expectedInitialRequests = 1) => {
  const abi = new Interface(['function approve(address,uint256)']);
  mockQuery.tx.data = abi.encodeFunctionData('approve', [SPENDER, '1000000']);
  mockQuery.decodedTx = {
    method: 'approve',
    inputs: [SPENDER, '1000000'],
    names: ['spender', 'amount'],
    types: ['address', 'uint256'],
  };
  mockQuery.txMetadata = { isApproval: true, approvalType: 'erc20-amount' };
  const pending: MetadataRequest[] = [];
  const invoke = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'getERC20TokenInfo') {
      return new Promise((resolve) =>
        pending.push({
          chain: mockState.vault.activeNetwork.chainId,
          expectedContext: args[2],
          resolve,
        })
      );
    }
    if (path[1] === 'isContractAddress') return true;
    return invoke(path, args);
  });
  // The quote boundary is synthetic; preserve exactly the bytes provided by
  // the real component so review and emitted calldata can be compared.
  mockFee.mockImplementation(async (transaction) => ({
    feeDetails: { gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 },
    formTx: { ...transaction, gasLimit: BigNumber.from(21000), nonce: 0 },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  }));
  const view = await prepare();
  await waitFor(() => expect(pending).toHaveLength(expectedInitialRequests));
  return { ...view, abi, pending };
};

const editAllowance = async (value: string) => {
  fireEvent.click(
    await screen.findByRole('button', { name: 'send.editPermission' })
  );
  fireEvent.click(
    screen.getByRole('radio', { name: 'send.customSpendingLimit' })
  );
  fireEvent.change(
    screen.getByRole('textbox', { name: 'send.enterAMaximumSpendingLimit' }),
    {
      target: { value },
    }
  );
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

const expectReadyAllowance = async (data: string) => {
  await waitFor(() => {
    expect(screen.getByTestId('transaction-hex').textContent).toBe(data);
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });
};

it.each([0, 6])(
  'uses the real allowance editor with healthy %s-decimal metadata',
  async (decimals) => {
    const { abi, pending } = await prepareApproval();
    expect(pending[0].expectedContext).toMatchObject({
      account: { type: 'HDAccount', id: 0, address: mockQuery.tx.from },
      chainId: 1,
      rpcUrl: 'https://rpc.example',
      slip44: 60,
    });
    await act(async () => pending[0].resolve({ ...TOKEN_INFO, decimals }));
    await editAllowance('2');
    const expected = abi.encodeFunctionData('approve', [
      SPENDER,
      decimals === 0 ? '2' : '2000000',
    ]);
    await expectReadyAllowance(expected);
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const sent = mockEmitter.mock.calls.find(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    );
    expect(sent?.[1][0].data).toBe(expected);
  }
);

it.each([false, true])(
  'ignores foreign metadata after an A-B-A return (foreign last: %s)',
  async (foreignLast) => {
    const { abi, pending, rerender } = await prepareApproval();
    await act(async () => pending[0].resolve(TOKEN_INFO));
    await screen.findByRole('button', { name: 'send.editPermission' });
    const originalNetwork = mockState.vault.activeNetwork;
    const originalAccount = mockState.vault.activeAccount;
    mockState.vault.accounts.HDAccount[1] = {
      id: 1,
      address: '0x4444444444444444444444444444444444444444',
      balances: { ethereum: '1' },
    };
    await act(async () => {
      mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
      mockState.vault.activeNetwork = {
        ...originalNetwork,
        chainId: 2,
        url: 'https://rpc-b.example',
      };
      rerender(<SendTransaction />);
    });
    // Old code starts this read in the wrong context. Correct code never does.
    const foreign = pending.find((request) => request.chain === 2);
    await act(async () => {
      mockState.vault.activeAccount = originalAccount;
      mockState.vault.activeNetwork = originalNetwork;
      rerender(<SendTransaction />);
    });
    const current = pending.at(-1)!;
    expect(current).not.toBe(pending[0]);
    expect(current.chain).toBe(1);
    if (!foreignLast && foreign) {
      await act(async () => foreign.resolve({ ...TOKEN_INFO, decimals: 18 }));
    }
    await act(async () => current.resolve(TOKEN_INFO));
    if (foreignLast && foreign) {
      await act(async () => foreign.resolve({ ...TOKEN_INFO, decimals: 18 }));
    }
    await editAllowance('2');
    const expected = abi.encodeFunctionData('approve', [SPENDER, '2000000']);
    await expectReadyAllowance(expected);
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const sent = mockEmitter.mock.calls.find(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    );
    expect(sent?.[1][0].data).toBe(expected);
    expect(sent?.[1][4].expectedContext.chainId).toBe(1);
  }
);

it('retires the first A read even after the wallet returns to the same A context', async () => {
  const { abi, pending, rerender } = await prepareApproval();
  const originalNetwork = mockState.vault.activeNetwork;
  await act(async () => {
    mockState.vault.activeNetwork = { ...originalNetwork, chainId: 2 };
    rerender(<SendTransaction />);
  });
  await act(async () => {
    mockState.vault.activeNetwork = originalNetwork;
    rerender(<SendTransaction />);
  });
  const current = pending.at(-1)!;
  expect(current).not.toBe(pending[0]);
  await act(async () => current.resolve(TOKEN_INFO));
  await act(async () => pending[0].resolve({ ...TOKEN_INFO, decimals: 18 }));
  await editAllowance('2');
  await expectReadyAllowance(
    abi.encodeFunctionData('approve', [SPENDER, '2000000'])
  );
});

it("does not reuse a retired approval request's metadata for a new token contract", async () => {
  const { abi, pending, rerender } = await prepareApproval();
  mockQuery.tx = {
    ...mockQuery.tx,
    to: '0x6666666666666666666666666666666666666666',
  };
  await act(async () => rerender(<SendTransaction />));
  expect(
    screen.queryByRole('button', { name: 'send.editPermission' })
  ).toBeNull();
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1].resolve(TOKEN_INFO));
  await act(async () => pending[0].resolve({ ...TOKEN_INFO, decimals: 18 }));
  await editAllowance('2');
  await expectReadyAllowance(
    abi.encodeFunctionData('approve', [SPENDER, '2000000'])
  );
});

it.each([
  'chain',
  'rpc',
  'account-id',
  'account-type',
  'account-address',
  'network-kind',
  'slip44',
])(
  'hides cached metadata and waits for a fresh read after a %s-only context change',
  async (change) => {
    const { pending, rerender } = await prepareApproval();
    await act(async () => pending[0].resolve(TOKEN_INFO));
    await screen.findByRole('button', { name: 'send.editPermission' });
    const originalNetwork = mockState.vault.activeNetwork;
    const originalAccount = mockState.vault.activeAccount;
    const originalAccountValue = mockState.vault.accounts.HDAccount[0];
    if (change === 'chain')
      mockState.vault.activeNetwork = { ...originalNetwork, chainId: 2 };
    if (change === 'rpc')
      mockState.vault.activeNetwork = {
        ...originalNetwork,
        url: 'https://other-rpc.example',
      };
    if (change === 'account-id') {
      mockState.vault.accounts.HDAccount[1] = {
        ...originalAccountValue,
        id: 1,
      };
      mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
    }
    if (change === 'account-type') {
      mockState.vault.accounts.Imported = { 0: originalAccountValue };
      mockState.vault.activeAccount = { type: 'Imported', id: 0 };
    }
    if (change === 'account-address') {
      mockState.vault.accounts.HDAccount[0] = {
        ...originalAccountValue,
        address: '0x5555555555555555555555555555555555555555',
      };
    }
    if (change === 'network-kind') mockState.vault.isBitcoinBased = true;
    if (change === 'slip44') mockState.vaultGlobal.activeSlip44 = 1;
    await act(async () => rerender(<SendTransaction />));
    expect(
      screen.queryByRole('button', { name: 'send.editPermission' })
    ).toBeNull();
    expect(pending).toHaveLength(1);
    await act(async () => {
      mockState.vault.activeNetwork = originalNetwork;
      mockState.vault.activeAccount = originalAccount;
      mockState.vault.accounts.HDAccount[0] = originalAccountValue;
      mockState.vault.isBitcoinBased = false;
      mockState.vaultGlobal.activeSlip44 = 60;
      rerender(<SendTransaction />);
    });
    expect(
      screen.queryByRole('button', { name: 'send.editPermission' })
    ).toBeNull();
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1].resolve(TOKEN_INFO));
    await screen.findByRole('button', { name: 'send.editPermission' });
  }
);

it('does not read metadata when the initial wallet differs from the original approved context', async () => {
  mockQuery.approvedContext = {
    account: { ...mockState.vault.activeAccount, address: mockQuery.tx.from },
    chainId: 1,
    rpcUrl: 'https://rpc.example',
    slip44: 60,
  };
  mockState.vault.activeNetwork = {
    ...mockState.vault.activeNetwork,
    chainId: 2,
  };
  const { pending } = await prepareApproval(0);
  expect(pending).toHaveLength(0);
  expect(
    screen.queryByRole('button', { name: 'send.editPermission' })
  ).toBeNull();
});

it('checks the live wallet context before a metadata completion can cause a render', async () => {
  const { pending } = await prepareApproval();
  mockState.vault.activeNetwork = {
    ...mockState.vault.activeNetwork,
    chainId: 2,
  };
  // Deliberately do not rerender: a controller reply can precede React's
  // processing of the Redux update. It must still fail the live context check.
  await act(async () => pending[0].resolve(TOKEN_INFO));
  expect(
    screen.queryByRole('button', { name: 'send.editPermission' })
  ).toBeNull();
});

it.each(['erc721-single', 'nft-all'])(
  'preserves healthy %s metadata and original calldata',
  async (approvalType) => {
    const isSingle = approvalType === 'erc721-single';
    const method = isSingle ? 'approve' : 'setApprovalForAll';
    const value = isSingle ? '7' : true;
    const abi = new Interface([
      isSingle
        ? 'function approve(address,uint256)'
        : 'function setApprovalForAll(address,bool)',
    ]);
    mockQuery.tx.data = abi.encodeFunctionData(method, [SPENDER, value]);
    mockQuery.decodedTx = {
      method,
      inputs: [SPENDER, value],
      names: ['operator', 'value'],
      types: ['address', isSingle ? 'uint256' : 'bool'],
    };
    mockQuery.txMetadata = { isApproval: true, approvalType };
    const invoke = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation(async (path, args) => {
      if (path[1] === 'getTokenDetails') {
        expect(args[2]).toMatchObject({
          chainId: 1,
          rpcUrl: 'https://rpc.example',
        });
        return { symbol: 'COLLECTIBLE' };
      }
      if (path[1] === 'isContractAddress') return true;
      return invoke(path, args);
    });
    await prepare();
    await waitFor(() =>
      expect(
        JSON.parse(screen.getByTestId('reviewed-approval').textContent!)
          .tokenSymbol
      ).toBe('COLLECTIBLE')
    );
    expect(screen.getByTestId('transaction-hex').textContent).toBe(
      mockQuery.tx.data
    );
    expect(
      screen.queryByRole('button', { name: 'send.editPermission' })
    ).toBeNull();
    if (isSingle) expect(screen.getByText('Token ID: 7')).toBeDefined();
  }
);
