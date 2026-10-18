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

const KEY = 'pali_navigation_state';
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
let mockAllowanceValue = '2';
let mockAllowanceIsCustom = true;
let mockAllowanceOpen = false;
let mockFeeOpen = false;
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
  useTranslation: () => ({ t: (key: string) => key }),
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
  ApprovalDetails: () => null,
  TransactionDetailsComponent: ({
    customFee,
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
          defaultValue="0"
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
jest.mock('./EditApprovedAllowanceValueModal', () => ({
  EditApprovedAllowanceValueModal: ({
    setCustomApprovedAllowanceAmount,
    showModal,
  }: any) => {
    mockAllowanceOpen = showModal;
    return (
      <button
        onClick={() =>
          setCustomApprovedAllowanceAmount({
            isCustom: mockAllowanceIsCustom,
            defaultAllowanceValue: '1',
            customAllowanceValue: mockAllowanceValue,
          })
        }
      >
        edit-synthetic-allowance
      </button>
    );
  },
}));
jest.mock('./EditPriority', () => ({
  EditPriorityModal: ({ setCustomFee, showModal }: any) => {
    mockEditHandlers.fee = setCustomFee;
    mockFeeOpen = showModal;
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
const delayCleanup = () => {
  let resolve!: (value: any) => void;
  const snapshot = mockStorage[KEY];
  mockGet.mockImplementationOnce(
    () => new Promise((finish) => (resolve = finish))
  );
  return () => resolve(snapshot);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage = {};
  mockButtonHandlers = {};
  mockShowSmartFeeEditor = false;
  mockAllowanceValue = '2';
  mockAllowanceIsCustom = true;
  mockAllowanceOpen = false;
  mockFeeOpen = false;
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
    formTx: { ...mockQuery.tx, gasLimit: BigNumber.from(21000) },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  }));
  jest.spyOn(window, 'close').mockImplementation(mockClose);
  mockSmartSubmit.mockResolvedValue({ hash: 'public-sa-test-hash' });
  mockHandleTransactionError.mockReturnValue(false);
});
afterEach(() => jest.restoreAllMocks());

it('locks fee and nonce edits while an EOA confirmation waits for its balance refresh', async () => {
  mockShowSmartFeeEditor = true;
  const quote = mockFee.getMockImplementation()!;
  mockFee.mockImplementation(async (...args) => ({
    ...(await quote(...args)),
    feeSafety: { maxFeePerGas: { requested: 1, recommended: 2 } },
    recommendationOnly: true,
  }));
  const view = await prepare();
  const staleEditors = { ...mockEditHandlers };
  act(() => staleEditors.open!(true));
  expect(mockFeeOpen).toBe(true);
  let finishBalance!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise((resolve) => (finishBalance = resolve))
  );
  let pending!: Promise<any>;
  act(() => {
    pending = mockButtonHandlers['buttons.confirm']();
    // These old DOM handlers run before the disabled render is committed.
    fireEvent.click(
      screen.getByRole('button', { name: 'send.useDappFeeRequest' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'send.useNetworkFeeSuggestion' })
    );
  });
  act(() => {
    staleEditors.nonce!(7);
    staleEditors.fee!({
      isCustom: true,
      gasLimit: 30000,
      gasPrice: 0,
      maxFeePerGas: 7,
      maxPriorityFeePerGas: 1,
    });
    staleEditors.open!(true);
  });
  expect(
    JSON.parse(screen.getByTestId('reviewed-custom-fee').textContent!)
  ).toMatchObject({ isCustom: false });
  expect(mockFeeOpen).toBe(false);
  expect(
    (
      screen.getByRole('button', {
        name: 'send.useDappFeeRequest',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (screen.getByLabelText('reviewed-nonce') as HTMLInputElement).disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'open-synthetic-fee',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  fireEvent.click(screen.getByText('send.data'));
  expect(
    screen.getByTestId('transaction-data').parentElement!.className
  ).not.toContain('hidden');
  fireEvent.click(screen.getByText('send.hex'));
  expect(
    screen.getByTestId('transaction-hex').parentElement!.className
  ).not.toContain('hidden');

  await act(async () => {
    finishBalance({ nativeBalance: '1' });
    await pending;
  });
  const submitted = mockEmitter.mock.calls.find(
    ([path]) => path[1] === 'sendAndSaveEthTransaction'
  )![1][0];
  expect(submitted.nonce).toBe(0);
  expect(BigNumber.from(submitted.maxFeePerGas).toString()).toBe('2000000000');
  view.unmount();
});

it.each(['dismissed', 'completed', 'outcome-unknown'])(
  'ignores stale fee and nonce editor callbacks after an approval is %s',
  async (outcome) => {
    mockShowSmartFeeEditor = true;
    const view = await prepare();
    const staleEditors = { ...mockEditHandlers };
    if (outcome === 'dismissed') {
      await act(async () => mockButtonHandlers['buttons.cancel']());
    } else {
      if (outcome === 'outcome-unknown') {
        mockHandleTransactionError.mockReturnValueOnce(true);
        mockEmitter
          .mockResolvedValueOnce({ nativeBalance: '1' })
          .mockRejectedValueOnce(Error('Network request timed out'));
      }
      await act(async () => mockButtonHandlers['buttons.confirm']());
    }
    act(() => {
      staleEditors.nonce!(7);
      staleEditors.fee!({
        isCustom: true,
        gasLimit: 30000,
        gasPrice: 0,
        maxFeePerGas: 7,
        maxPriorityFeePerGas: 1,
      });
      staleEditors.open!(true);
    });
    expect(
      JSON.parse(screen.getByTestId('reviewed-custom-fee').textContent!)
    ).toMatchObject({ isCustom: false });
    expect(mockFeeOpen).toBe(false);
    expect(
      (screen.getByLabelText('reviewed-nonce') as HTMLInputElement).disabled
    ).toBe(true);
    view.unmount();
  }
);

it('unlocks fee and nonce edits for a retry after a known pre-submit failure', async () => {
  mockShowSmartFeeEditor = true;
  const view = await prepare();
  const staleEditors = { ...mockEditHandlers };
  mockEmitter.mockResolvedValueOnce({ nativeBalance: '0' });
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(mockAlert.error).toHaveBeenCalledWith('send.enoughFunds');
  expect(
    (screen.getByLabelText('reviewed-nonce') as HTMLInputElement).disabled
  ).toBe(false);
  act(() => {
    staleEditors.nonce!(7);
    staleEditors.fee!({
      isCustom: true,
      gasLimit: 30000,
      gasPrice: 0,
      maxFeePerGas: 7,
      maxPriorityFeePerGas: 1,
    });
  });
  expect(
    JSON.parse(screen.getByTestId('reviewed-custom-fee').textContent!)
  ).toMatchObject({ isCustom: true, maxFeePerGas: 7 });
  await act(async () => mockButtonHandlers['buttons.confirm']());
  const submitted = mockEmitter.mock.calls.find(
    ([path]) => path[1] === 'sendAndSaveEthTransaction'
  )![1][0];
  expect(submitted.nonce).toBe(7);
  expect(BigNumber.from(submitted.maxFeePerGas).toString()).toBe('7000000000');
  view.unmount();
});

it.each([false, true])(
  'preserves the app fee by default and uses the network suggestion only after a click (%s)',
  async (chooseSuggestion) => {
    mockQuery.tx.gasPrice = '0x3b9aca00';
    mockFee.mockImplementation(async () => ({
      feeDetails: {
        gasLimit: 21000,
        gasPrice: 1,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
      },
      feeSafety: { gasPrice: { requested: 1, recommended: 2 } },
      recommendationOnly: true,
      formTx: {
        ...mockQuery.tx,
        gasPrice: '1000000000',
        gasLimit: BigNumber.from(21000),
      },
      nonce: 0,
      isInvalidTxData: false,
      gasLimitError: false,
    }));
    await prepare();
    expect(screen.queryByText('send.dappFeeRaisedDescription')).toBeNull();
    expect(
      screen.getByText('send.customFeeBelowEstimateWarning')
    ).toBeDefined();
    if (chooseSuggestion)
      fireEvent.click(
        screen.getByRole('button', { name: 'send.useNetworkFeeSuggestion' })
      );
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const submitted = mockEmitter.mock.calls.find(
      ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
    );
    expect(submitted).toBeDefined();
    expect(BigNumber.from(submitted![1][0].gasPrice).toString()).toBe(
      chooseSuggestion ? '2000000000' : '1000000000'
    );
    expect(BigNumber.from(submitted![1][0].gasLimit).toString()).toBe('21000');
  }
);

it('rejects a malformed requested value without signing or latching the spinner', async () => {
  mockQuery.tx.value = 'invalid';
  await prepare();
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalledWith('send.txWillFail');
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  await act(async () => mockButtonHandlers['buttons.cancel']());
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('requires an explicit refreshed quote after a fresh AA preparation exceeds the approved maximum', async () => {
  mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
  mockState.vault.accounts.HDAccount[0].smartAccount = {};
  mockSmartSubmit.mockRejectedValueOnce(
    Object.assign(new Error('PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED'), {
      transactionNotBroadcast: true,
    })
  );
  await prepare();
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(mockSmartSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ maximumUserOpFeeWei: '43172800000000000' })
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(mockClose).not.toHaveBeenCalled();
  const count = mockFee.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'send.refreshFeeQuote' }));
  await waitFor(() => expect(mockFee.mock.calls.length).toBe(count + 1));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
});

it.each([undefined, false, true])(
  'keeps a same-message error unknown after SA submission begins (%s)',
  async (transactionNotBroadcast) => {
    mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
    mockState.vault.accounts.HDAccount[0].smartAccount = {};
    mockSmartSubmit.mockImplementation(async (params) => {
      await params.controllerEmitter(
        ['wallet', 'submitSmartAccountExecution'],
        []
      );
      throw Object.assign(new Error('PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED'), {
        transactionNotBroadcast,
      });
    });
    mockEmitter.mockImplementation(async ([, method]) => {
      if (method === 'refreshActiveAccountBalances')
        return { nativeBalance: '1' };
      if (method === 'submitSmartAccountExecution') return;
      throw Error(method);
    });
    await prepare();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'send.refreshFeeQuote' })
    ).toBeNull();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
  }
);

it('rejects a changed quote context after preparation and before any authenticator signing', async () => {
  mockShowSmartFeeEditor = true;
  mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
  mockState.vault.accounts.HDAccount[0].smartAccount = {};
  let finishPreparation!: () => void;
  const authenticator = jest.fn();
  mockSmartSubmit.mockImplementation(async (options) => {
    await new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    options.onPrepared?.();
    authenticator();
    return { hash: 'synthetic-sa-hash' };
  });
  const view = await prepare();
  let pending!: Promise<any>;
  await act(async () => {
    pending = mockButtonHandlers['buttons.confirm']();
  });
  await waitFor(() => expect(finishPreparation).toBeDefined());
  // Editing is locked once Confirm starts. A network switch can still
  // invalidate the approved quote independently of those controls.
  mockState.vault.activeNetwork = {
    ...mockState.vault.activeNetwork,
    chainId: 2,
  };
  view.rerender(<SendTransaction />);
  await act(async () => {
    finishPreparation();
    await pending;
  });
  expect(authenticator).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  view.unmount();
});

it('refreshes the AA quote for edited fee caps while retaining the original dapp fields', async () => {
  mockShowSmartFeeEditor = true;
  mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
  mockState.vault.accounts.HDAccount[0].smartAccount = {};
  mockQuery.tx.maxFeePerGas = '5000000000';
  mockQuery.tx.maxPriorityFeePerGas = '1000000000';
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'edit-synthetic-fee' }));
  await waitFor(() =>
    expect(mockFee.mock.calls.at(-1)![3]).toEqual({
      maxFeePerGas: '7000000000',
      maxPriorityFeePerGas: '1000000000',
    })
  );
  expect(mockQuery.tx.maxFeePerGas).toBe('5000000000');
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(mockSmartSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      feeOverrides: {
        maxFeePerGas: '7000000000',
        maxPriorityFeePerGas: '1000000000',
      },
    })
  );
});

it.each([false, true])(
  'reviews and quotes the same edited approval calldata that the signer will execute (smart: %s)',
  async (smart) => {
    mockState.vault.accounts.HDAccount[0].isSmartAccount = smart;
    if (smart) mockState.vault.accounts.HDAccount[0].smartAccount = {};
    const spender = `0x${'33'.repeat(20)}`;
    const abi = new Interface(['function approve(address,uint256)']);
    mockQuery.tx.data = abi.encodeFunctionData('approve', [
      spender,
      '1000000000000000000',
    ]);
    mockQuery.decodedTx = {
      method: 'approve',
      inputs: [spender, '1000000000000000000'],
      names: ['spender', 'value'],
      types: ['address', 'uint256'],
    };
    mockQuery.txMetadata = {
      isApproval: true,
      approvalType: 'erc20-amount',
      tokenStandard: 'ERC-20',
    };
    const invoke = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation(async (path, args) =>
      path[1] === 'getERC20TokenInfo'
        ? { name: 'Synthetic', symbol: 'UNIT', decimals: 18, balance: '10' }
        : path[1] === 'isContractAddress'
        ? true
        : invoke(path, args)
    );
    await prepare();
    expect(screen.getByTestId('transaction-hex').textContent).toBe(
      mockQuery.tx.data
    );
    expect(
      JSON.parse(screen.getByTestId('transaction-data').textContent!).inputs
    ).toEqual(mockQuery.decodedTx.inputs);
    fireEvent.click(
      await screen.findByRole('button', { name: 'edit-synthetic-allowance' })
    );
    const expectedData = abi.encodeFunctionData('approve', [
      spender,
      '2000000000000000000',
    ]);
    await waitFor(() =>
      expect(mockFee.mock.calls.at(-1)![0].data).toBe(expectedData)
    );
    expect(screen.getByTestId('transaction-hex').textContent).toBe(
      expectedData
    );
    expect(
      JSON.parse(screen.getByTestId('transaction-data').textContent!).inputs
    ).toEqual([spender, '2000000000000000000']);
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'buttons.confirm',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
    await act(async () => mockButtonHandlers['buttons.confirm']());
    if (smart)
      expect(mockSmartSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          executions: [
            expect.objectContaining({
              target: mockQuery.tx.to,
              data: expectedData,
            }),
          ],
        })
      );
    else
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'sendAndSaveEthTransaction'],
        [
          expect.objectContaining({
            from: mockQuery.tx.from,
            to: mockQuery.tx.to,
            data: expectedData,
          }),
          false,
          undefined,
          undefined,
          { expectedContext: approvedContextForTest() },
        ],
        10000
      );
  }
);

function approvedContextForTest() {
  return {
    account: { type: 'HDAccount', id: 0, address: mockQuery.tx.from },
    chainId: 1,
    rpcUrl: 'https://rpc.example',
    slip44: 60,
  };
}

it('binds EOA quotes to custom and restored proposed approvals and ignores superseded quotes', async () => {
  const spender = `0x${'33'.repeat(20)}`;
  const abi = new Interface(['function approve(address,uint256)']);
  mockQuery.tx.data = abi.encodeFunctionData('approve', [spender, '1000000']);
  mockQuery.decodedTx = {
    method: 'approve',
    inputs: [spender, '1000000'],
    names: ['spender', 'amount'],
    types: ['address', 'uint256'],
  };
  mockQuery.txMetadata = { isApproval: true, approvalType: 'erc20-amount' };
  const invoke = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) =>
    path[1] === 'getERC20TokenInfo'
      ? { name: 'Synthetic', symbol: 'UNIT', decimals: 6, balance: '10' }
      : path[1] === 'isContractAddress'
      ? true
      : invoke(path, args)
  );
  await prepare();
  const pending: { data: string; resolve: (result: any) => void }[] = [];
  mockFee.mockImplementation(
    (transaction) =>
      new Promise((resolve) =>
        pending.push({ data: transaction.data, resolve })
      )
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'edit-synthetic-allowance' })
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(
    mockEmitter.mock.calls.some(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    )
  ).toBe(false);

  mockAllowanceValue = '3';
  fireEvent.click(
    screen.getByRole('button', { name: 'edit-synthetic-allowance' })
  );
  await waitFor(() => expect(pending).toHaveLength(2));
  const result = (data: string) => ({
    feeDetails: { gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 },
    formTx: { ...mockQuery.tx, data, gasLimit: BigNumber.from(21000) },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  });
  await act(async () => pending[0].resolve(result(pending[0].data)));
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(
    mockEmitter.mock.calls.some(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    )
  ).toBe(false);
  const expectedData = abi.encodeFunctionData('approve', [spender, '3000000']);
  expect(screen.getByTestId('transaction-hex').textContent).toBe(expectedData);
  await act(async () => pending[1].resolve(result(pending[1].data)));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  mockAllowanceIsCustom = false;
  fireEvent.click(
    screen.getByRole('button', { name: 'edit-synthetic-allowance' })
  );
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(screen.getByTestId('transaction-hex').textContent).toBe(
    mockQuery.tx.data
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(
    mockEmitter.mock.calls.some(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    )
  ).toBe(false);
  await act(async () => pending[2].resolve(result(pending[2].data)));
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  let resolveBalance!: (result: any) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveBalance = resolve;
      })
  );
  let submitting!: Promise<unknown>;
  act(() => {
    submitting = mockButtonHandlers['buttons.confirm']();
  });
  const edit = screen.getByRole('button', { name: 'send.editPermission' });
  expect((edit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(edit);
  expect(mockAllowanceOpen).toBe(false);
  await act(async () => {
    resolveBalance({ nativeBalance: '1' });
    await submitting;
  });
  expect(
    mockEmitter.mock.calls.find(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    )?.[1][0].data
  ).toBe(mockQuery.tx.data);
});

it('keeps malformed edited allowances out of review, estimation and submission', async () => {
  const spender = `0x${'22'.repeat(20)}`;
  mockQuery.tx.data = new Interface([
    'function approve(address,uint256)',
  ]).encodeFunctionData('approve', [spender, '1000000']);
  mockQuery.decodedTx = {
    method: 'approve',
    inputs: [spender, '1000000'],
    names: ['spender', 'amount'],
    types: ['address', 'uint256'],
  };
  mockQuery.txMetadata = { isApproval: true, approvalType: 'erc20-amount' };
  const invoke = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) =>
    path[1] === 'getERC20TokenInfo'
      ? { name: 'Synthetic', symbol: 'UNIT', decimals: 6, balance: '10' }
      : path[1] === 'isContractAddress'
      ? true
      : invoke(path, args)
  );
  await prepare();
  const quotes = mockFee.mock.calls.length;
  mockAllowanceValue = '-1';
  fireEvent.click(
    screen.getByRole('button', { name: 'edit-synthetic-allowance' })
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  );
  expect(screen.queryByTestId('transaction-data')).toBeNull();
  expect(screen.queryByTestId('transaction-hex')).toBeNull();
  expect(mockFee).toHaveBeenCalledTimes(quotes);
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(
    mockEmitter.mock.calls.some(
      ([path]) => path[1] === 'sendAndSaveEthTransaction'
    )
  ).toBe(false);
  expect(mockSmartSubmit).not.toHaveBeenCalled();
});

it.each([false, true])(
  'retains cancellation after failed ENS resolution (external: %s)',
  async (external) => {
    mockQuery.external = external;
    mockQuery.tx.to = 'unregistered-name.eth';
    mockEmitter.mockImplementation(async ([, method]) => {
      if (method === 'resolveEns') return null;
      if (method === 'refreshActiveAccountBalances')
        return { nativeBalance: '1' };
      throw Error(`Unexpected method: ${method}`);
    });
    await saveNavigationState('/send/eth', undefined, {
      formValues: { receiver: mockQuery.tx.to },
    });
    render(<SendTransaction />);
    await screen.findByText('send.unableToResolveEns');
    expect(
      screen.queryByRole('button', { name: 'buttons.confirm' })
    ).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }))
    );
    await waitFor(() =>
      external
        ? expect(mockClose).toHaveBeenCalledTimes(1)
        : expect(mockNavigate).toHaveBeenCalledWith('/home')
    );
    expect(mockStorage[KEY]).toBeUndefined();
    expect(mockFee).not.toHaveBeenCalled();
    expect(mockSmartSubmit).not.toHaveBeenCalled();
  }
);

it.each([
  { legacy: true, typed: true },
  { legacy: true, typed: false },
  { legacy: false, typed: true },
  { legacy: false, typed: true, zeroTipOnly: true },
])(
  'honors zero legacy fees and zero tips while refusing zero EIP-1559 maxima %p',
  async ({ legacy, typed, zeroTipOnly }) => {
    if (typed) mockQuery.tx.type = legacy ? '0x0' : '0x2';
    if (legacy) mockQuery.tx.gasPrice = '0x0';
    else {
      mockQuery.tx.maxFeePerGas = zeroTipOnly ? '0x77359400' : '0x0';
      mockQuery.tx.maxPriorityFeePerGas = '0x0';
    }
    mockFee.mockImplementation(async () => ({
      feeDetails: {
        gasLimit: 21000,
        gasPrice: 2,
        maxFeePerGas: 2,
        maxPriorityFeePerGas: 1,
      },
      feeSafety: legacy
        ? { gasPrice: { requested: 0, recommended: 2 } }
        : {
            maxFeePerGas: zeroTipOnly
              ? undefined
              : { requested: 0, recommended: 2 },
            maxPriorityFeePerGas: { requested: 0, recommended: 1 },
          },
      formTx: { ...mockQuery.tx, gasLimit: BigNumber.from(21000) },
      nonce: 0,
      isInvalidTxData: false,
      gasLimitError: false,
    }));
    await prepare();
    fireEvent.click(
      screen.getByRole('button', { name: 'send.useDappFeeRequest' })
    );
    if (legacy || zeroTipOnly)
      expect(
        screen.getByText('send.customFeeBelowEstimateWarning')
      ).toBeDefined();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const submitted = mockEmitter.mock.calls.find(
      ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
    );
    if (legacy || zeroTipOnly) {
      expect(submitted).toBeDefined();
      if (legacy)
        expect(BigNumber.from(submitted![1][0].gasPrice).isZero()).toBe(true);
      else {
        expect(BigNumber.from(submitted![1][0].maxFeePerGas).toString()).toBe(
          '2000000000'
        );
        expect(
          BigNumber.from(submitted![1][0].maxPriorityFeePerGas).isZero()
        ).toBe(true);
        expect(submitted![1][1]).toBe(false);
        expect(submitted![1][0]).not.toHaveProperty('gasPrice');
      }
    } else {
      expect(submitted).toBeUndefined();
      expect(mockAlert.error).toHaveBeenCalledWith('send.invalidFeeRate');
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole('button', {
            name: 'buttons.cancel',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
    }
  }
);

it('refuses smart-account review without account metadata before requesting a signature', async () => {
  mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
  mockQuery.tx.gasPrice = '0x1';
  await prepare();
  await act(async () => mockButtonHandlers['buttons.confirm']());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockSmartSubmit).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalledWith('send.cantCompleteTxs');
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
});

it.each([false, true])(
  'preserves an exact app legacy price for smart-account=%s without float repricing',
  async (smartAccount) => {
    const price = '1152921504606846977';
    mockQuery.tx.gasPrice = BigNumber.from(price).toHexString();
    if (smartAccount) {
      mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
      mockState.vault.accounts.HDAccount[0].smartAccount = {};
    }
    mockFee.mockImplementation(async () => ({
      feeDetails: {
        gasLimit: 21000,
        gasPrice: Number(price) / 1e9,
        maxFeePerGas: 1,
        maxPriorityFeePerGas: 1,
      },
      formTx: {
        ...mockQuery.tx,
        gasPrice: price,
        gasLimit: BigNumber.from(21000),
      },
      nonce: 0,
      isInvalidTxData: false,
      gasLimitError: false,
    }));
    await prepare();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    if (smartAccount) {
      expect(mockSmartSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          feeOverrides: { gasPrice: price },
          executions: [{ target: mockQuery.tx.to, value: '0x00', data: '0x' }],
        })
      );
      expect(
        mockEmitter.mock.calls.every(
          ([path]) => path.join('.') === 'wallet.refreshActiveAccountBalances'
        )
      ).toBe(true);
    } else {
      const submitted = mockEmitter.mock.calls.find(
        ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
      );
      expect(BigNumber.from(submitted![1][0].gasPrice).toString()).toBe(price);
      expect(mockSmartSubmit).not.toHaveBeenCalled();
    }
  }
);

it.each(['chain', 'rpc', 'account', 'slip44'])(
  'a stale transaction review cannot submit after the %s context changes',
  async (field) => {
    await prepare();
    const confirm = mockButtonHandlers['buttons.confirm'];
    if (field === 'chain') mockState.vault.activeNetwork.chainId = 2;
    if (field === 'rpc')
      mockState.vault.activeNetwork.url = 'https://rpc.other';
    if (field === 'slip44') mockState.vaultGlobal.activeSlip44 = 1;
    if (field === 'account')
      mockState.vault.accounts.HDAccount[0].address = `0x${'33'.repeat(20)}`;
    await act(async () => confirm());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'transactions.psbtSigningContextChanged'
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.cancel',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  }
);

it('passes the immutable reviewed context after a delayed balance refresh', async () => {
  await prepare();
  let finish!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  act(() => {
    void mockButtonHandlers['buttons.confirm']();
  });
  mockState.vault.activeNetwork.chainId = 2;
  await act(async () => finish({ nativeBalance: '1' }));
  const submitted = mockEmitter.mock.calls.find(
    ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
  );
  expect(submitted![1][4].expectedContext).toEqual({
    account: { type: 'HDAccount', id: 0, address: `0x${'11'.repeat(20)}` },
    chainId: 1,
    rpcUrl: 'https://rpc.example',
    slip44: 60,
  });
});

it.each(['before render', 'after render'])(
  'SendTransaction cancellation blocks confirmation %s during cleanup',
  async (phase) => {
    await prepare();
    const finishCleanup = delayCleanup();
    const cancel = mockButtonHandlers['buttons.cancel'];
    const confirm = mockButtonHandlers['buttons.confirm'];
    act(() => {
      void cancel();
      if (phase === 'before render') void confirm();
    });
    if (phase === 'after render')
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    for (const name of ['buttons.cancel', 'buttons.confirm'])
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled
      ).toBe(true);
    await act(async () => finishCleanup());
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => confirm());
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each([true, false])(
  'duplicate SendTransaction cancellation performs one terminal exit (external=%s)',
  async (external) => {
    await prepare(external);
    const finishCleanup = delayCleanup();
    const cancel = mockButtonHandlers['buttons.cancel'];
    act(() => {
      void cancel();
      void cancel();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => finishCleanup());
    expect(mockClose).toHaveBeenCalledTimes(external ? 1 : 0);
    expect(mockNavigate).toHaveBeenCalledTimes(external ? 0 : 1);
    if (!external) expect(mockNavigate).toHaveBeenCalledWith('/home');
  }
);

it('a stale Cancel callback cannot close an active SendTransaction submission', async () => {
  await prepare();
  let finishRefresh!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise((resolve) => (finishRefresh = resolve))
  );
  mockEmitter.mockImplementationOnce(() => new Promise(() => undefined));
  const cancel = mockButtonHandlers['buttons.cancel'];
  const confirm = mockButtonHandlers['buttons.confirm'];
  act(() => {
    void confirm();
    void cancel();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => finishRefresh({ nativeBalance: '1' }));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'sendAndSaveEthTransaction'],
    expect.any(Array),
    10000
  );
  await act(async () => cancel());
  expect(mockGet).not.toHaveBeenCalled();
  expect(mockClose).not.toHaveBeenCalled();
});

it('SendTransaction cancellation stays terminal after a storage read failure', async () => {
  await prepare();
  mockGet.mockRejectedValueOnce(new Error('Storage unavailable'));
  const cancel = mockButtonHandlers['buttons.cancel'];
  const confirm = mockButtonHandlers['buttons.confirm'];
  await act(async () => cancel());
  await act(async () => confirm());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('an unchanged SendTransaction approval still submits and closes after cleanup', async () => {
  jest.useFakeTimers();
  try {
    await prepare();
    const cancel = mockButtonHandlers['buttons.cancel'];
    const confirm = mockButtonHandlers['buttons.confirm'];
    await act(async () => confirm());
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'sendAndSaveEthTransaction'],
      expect.any(Array),
      10000
    );
    await act(async () => cancel());
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

describe('SendTransaction error close lifetimes', () => {
  let timeouts: jest.SpyInstance;
  let clearTimeouts: jest.SpyInstance;
  const closeTimer = (delay: number) => {
    let index = timeouts.mock.calls.length - 1;
    while (index >= 0 && timeouts.mock.calls[index][1] !== delay) index--;
    expect(index).toBeGreaterThanOrEqual(0);
    return {
      callback: timeouts.mock.calls[index][0] as () => Promise<void> | void,
      id: timeouts.mock.results[index].value,
    };
  };
  const refuseForInsufficientFunds = async () => {
    mockEmitter.mockResolvedValueOnce({ nativeBalance: '0' });
    await act(async () => mockButtonHandlers['buttons.confirm']());
    return closeTimer(2000);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    timeouts = jest.spyOn(globalThis, 'setTimeout');
    clearTimeouts = jest.spyOn(globalThis, 'clearTimeout');
  });
  afterEach(() => jest.useRealTimers());

  it.each(['insufficient funds', 'submission error'])(
    'invalidates a prior %s close while a retry is in flight',
    async (failure) => {
      await prepare();
      let timer: ReturnType<typeof closeTimer>;
      if (failure === 'insufficient funds') {
        timer = await refuseForInsufficientFunds();
      } else {
        mockEmitter
          .mockResolvedValueOnce({ nativeBalance: '1' })
          .mockRejectedValueOnce(
            Object.assign(Error('RPC refused'), {
              transactionNotBroadcast: true,
            })
          );
        await act(async () => mockButtonHandlers['buttons.confirm']());
        timer = closeTimer(4000);
      }
      mockEmitter
        .mockClear()
        .mockImplementationOnce(() => new Promise(() => undefined));
      act(() => {
        void mockButtonHandlers['buttons.confirm']();
      });
      mockGet.mockClear();
      await act(async () => timer.callback());
      expect(mockGet).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
      expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    }
  );

  it('does not offer a second submission after a controller timeout', async () => {
    await prepare();
    mockEmitter
      .mockResolvedValueOnce({ nativeBalance: '1' })
      .mockRejectedValueOnce(Error('Network request timed out'));
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const timer = closeTimer(4000);
    mockEmitter.mockClear();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    await act(async () => mockButtonHandlers['buttons.cancel']());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
    await act(async () => timer.callback());
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it.each(['hardware cancellation', 'device locked', 'blind signing disabled'])(
    'keeps an ambiguous %s non-retryable but allows dismissal',
    async (message) => {
      const view = await prepare();
      mockHandleTransactionError.mockReturnValueOnce(true);
      mockEmitter
        .mockResolvedValueOnce({ nativeBalance: '1' })
        .mockRejectedValueOnce(Error(message));
      await act(async () => mockButtonHandlers['buttons.confirm']());
      expect(
        (
          screen.getByRole('button', {
            name: 'buttons.confirm',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      expect(
        (
          screen.getByRole('button', {
            name: 'buttons.cancel',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
      mockEmitter.mockClear();
      await act(async () => mockButtonHandlers['buttons.confirm']());
      expect(mockEmitter).not.toHaveBeenCalled();
      await act(async () => mockButtonHandlers['buttons.cancel']());
      expect(mockClose).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  );

  it('keeps a smart-account attempt consumed after its actual submit call times out', async () => {
    mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
    mockState.vault.accounts.HDAccount[0].smartAccount = {};
    await prepare();
    mockSmartSubmit.mockImplementationOnce(({ controllerEmitter }) =>
      controllerEmitter(['wallet', 'submitSmartAccountExecution'], [{}])
    );
    mockEmitter
      .mockResolvedValueOnce({ nativeBalance: '1' })
      .mockRejectedValueOnce(Error('Network request timed out'));
    await act(async () => mockButtonHandlers['buttons.confirm']());
    const timer = closeTimer(4000);
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
    mockEmitter.mockClear();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
    await act(async () => timer.callback());
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh smart-account attempt after cancellation before submission', async () => {
    mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
    mockState.vault.accounts.HDAccount[0].smartAccount = {};
    const view = await prepare();
    mockSmartSubmit.mockRejectedValueOnce(Error('Authenticator cancelled'));
    await act(async () => mockButtonHandlers['buttons.confirm']());
    expect(mockSmartSubmit).toHaveBeenCalledTimes(1);
    mockEmitter.mockClear();
    await act(async () => mockButtonHandlers['buttons.confirm']());
    expect(mockSmartSubmit).toHaveBeenCalledTimes(2);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter.mock.calls[0][0]).toEqual([
      'wallet',
      'refreshActiveAccountBalances',
    ]);
    view.unmount();
  });

  it('a first error cannot close the lifetime of a failed retry', async () => {
    await prepare();
    const first = await refuseForInsufficientFunds();
    const second = await refuseForInsufficientFunds();
    mockGet.mockClear();
    await act(async () => first.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(clearTimeouts).toHaveBeenCalledWith(first.id);
    await act(async () => second.callback());
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('an eligible error timer claims dismissal before cleanup can race a retry', async () => {
    await prepare();
    const timer = await refuseForInsufficientFunds();
    const finishCleanup = delayCleanup();
    const confirm = mockButtonHandlers['buttons.confirm'];
    mockEmitter.mockClear();
    let closing: Promise<void> | void;
    act(() => {
      closing = timer.callback();
      void confirm();
    });
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => {
      finishCleanup();
      await closing;
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('manual cancellation invalidates an exposed error timer callback', async () => {
    await prepare();
    const timer = await refuseForInsufficientFunds();
    await act(async () => mockButtonHandlers['buttons.cancel']());
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    expect(mockClose).toHaveBeenCalledTimes(1);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('unmount invalidates an exposed error timer callback', async () => {
    const view = await prepare();
    const timer = await refuseForInsufficientFunds();
    view.unmount();
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('unmount during error cleanup prevents its late close', async () => {
    const view = await prepare();
    const timer = await refuseForInsufficientFunds();
    mockGet.mockClear();
    const finishCleanup = delayCleanup();
    let closing: Promise<void> | void;
    act(() => {
      closing = timer.callback();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      finishCleanup();
      await closing;
    });
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('an eligible error timeout still closes at its existing deadline', async () => {
    await prepare();
    await refuseForInsufficientFunds();
    await act(async () => {
      jest.advanceTimersByTime(1999);
    });
    expect(mockClose).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it.each(['resolved', 'rejected'])(
    'unmount prevents a late %s submission from scheduling a close',
    async (result) => {
      const view = await prepare();
      let finish!: (value: any) => void;
      let fail!: (error: Error) => void;
      mockEmitter
        .mockResolvedValueOnce({ nativeBalance: '1' })
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finish = resolve;
              fail = reject;
            })
        );
      let submitting!: Promise<any>;
      await act(async () => {
        submitting = mockButtonHandlers['buttons.confirm']();
        await Promise.resolve();
      });
      view.unmount();
      timeouts.mockClear();
      await act(async () => {
        if (result === 'resolved') finish({ hash: 'public-test-hash' });
        else fail(Error('RPC refused'));
        await submitting;
        jest.advanceTimersByTime(4000);
      });
      expect(timeouts).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    }
  );

  it('a fee estimation error close cannot interrupt a new confirmation attempt', async () => {
    const view = await prepare();
    mockFee.mockRejectedValueOnce(Error('fee estimate failed'));
    mockQuery.tx = { ...mockQuery.tx, to: `0x${'33'.repeat(20)}` };
    view.rerender(<SendTransaction />);
    await waitFor(() => {
      expect(mockAlert.error).toHaveBeenCalledWith(
        'send.txWillFail',
        expect.any(Error)
      );
    });
    const timer = closeTimer(3000);
    mockEmitter.mockImplementationOnce(() => new Promise(() => undefined));
    act(() => {
      void mockButtonHandlers['buttons.confirm']();
    });
    expect(clearTimeouts).toHaveBeenCalledWith(timer.id);
    mockGet.mockClear();
    await act(async () => timer.callback());
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
