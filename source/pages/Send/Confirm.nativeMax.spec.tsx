/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { formatEther, parseEther } from 'ethers';
import React from 'react';

import { SendConfirm } from 'pages/Send/Confirm';

let mockEIP1559 = true;
let mockRefreshedBalance = '100';
let mockRefreshFails = false;
let mockRefreshDeferred: ReturnType<typeof deferred> | undefined;
let mockRerender: (() => void) | undefined;
const mockAlertError = jest.fn();
const mockEmitter = jest.fn();
const mockAuth = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
const mockLocation: any = {
  key: 'fee-readiness-entry',
  pathname: '/send/confirm',
  state: {
    submissionStarted: false,
    walletScope: mockScope,
    tx: {
      sender: '0x1111111111111111111111111111111111111111',
      receivingAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
      transactionType: 'NATIVE_ETH',
      defaultGasLimit: 42000,
    },
    returnContext: { returnRoute: '/send/eth', walletScope: mockScope },
  },
};
const mockState = {
  vault: {
    activeNetwork: {
      kind: 'ethereum',
      chainId: 5700,
      currency: 'TSYS',
      url: 'https://rpc.invalid',
    },
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: '0x1111111111111111111111111111111111111111',
          balances: { ethereum: '100' },
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
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: { error: mockAlertError, success: jest.fn(), info: jest.fn() },
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockAuth }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockAuth,
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({
    isEIP1559Compatible: mockEIP1559,
    forceRecheck: jest.fn(),
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Icon: ({ name }: any) => <span>{name}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DeviceWaitingBanner: () => null,
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: () => null,
}));
jest.mock('pages/Send/components', () => ({ PriorityBar: () => null }));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  removeScientificNotation: (value: any) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  omitTransactionObjectData: (value: any) => value,
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => ({
  clearTransactionNavigationState: jest.fn(),
  getTransactionReturnContext: () => mockLocation.state.returnContext,
  getWalletNavigationScope: () => mockScope,
  navigateBack: jest.fn(),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));
jest.mock('utils/validations', () => ({
  getErc20Abi: jest.fn(),
  getErc721Abi: jest.fn(),
  getErc1155Abi: jest.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout.
    }
    unobserve() {
      // JSDOM has no layout.
    }
    disconnect() {
      // JSDOM has no layout.
    }
  } as typeof ResizeObserver;
  (globalThis as any).MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mockLocation.key += '-next';
  mockEIP1559 = true;
  mockRefreshedBalance = '100';
  mockRefreshFails = false;
  mockRefreshDeferred = undefined;
  mockRerender = undefined;
  mockScope.network = 'synthetic-network';
  mockState.vault.accounts.HDAccount[0].balances.ethereum = '100';
  mockLocation.state.tx.amount = '1';
  mockLocation.state.tx.isMax = false;
  delete mockLocation.state.tx.cachedGasData;
});
afterEach(() => {
  expect(
    mockEmitter.mock.calls.every(([path]) =>
      [
        'getFeeDataWithDynamicMaxPriorityFeePerGas',
        'getTxGasLimit',
        'refreshActiveAccountBalances',
        'sendAndSaveEthTransaction',
        'getRecommendedGasPrice',
      ].includes(path.at(-1))
    )
  ).toBe(true);
});

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (reason: any) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function prepare(quoteCount = 1) {
  const quotes = Array.from({ length: quoteCount }, deferred);
  let nextQuote = 0;
  mockEmitter.mockImplementation((path: string[]) => {
    const method = path.at(-1);
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return quotes[nextQuote++].promise;
    if (method === 'getTxGasLimit') return Promise.resolve(21000);
    if (method === 'refreshActiveAccountBalances')
      return mockRefreshFails
        ? Promise.reject(new Error('Synthetic balance read failure'))
        : mockRefreshDeferred?.promise ||
            Promise.resolve({ nativeBalance: mockRefreshedBalance });
    if (method === 'getRecommendedGasPrice')
      return Promise.resolve('3000000000');
    if (method === 'sendAndSaveEthTransaction')
      return Promise.reject(
        Object.assign(new Error('Synthetic refused submission boundary'), {
          transactionNotBroadcast: true,
        })
      );
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  const rendered = render(<SendConfirm />);
  mockRerender = () => rendered.rerender(<SendConfirm />);
  return quotes;
}
const edit = () => screen.getByRole('button', { name: 'send.editFee' });
const quoteRequests = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'getFeeDataWithDynamicMaxPriorityFeePerGas'
  );
const waitForQuote = (count = 1) =>
  waitFor(() => expect(quoteRequests()).toHaveLength(count));
const headline = () =>
  screen
    .getByText('buttons.send')
    .parentElement!.querySelectorAll('p')[1]
    .textContent!.trim();
const submissionCalls = () =>
  mockEmitter.mock.calls.filter(
    ([path]) => path.at(-1) === 'sendAndSaveEthTransaction'
  );
const ready = async (
  max: boolean,
  { balance = '100', legacy = false } = {}
) => {
  mockEIP1559 = !legacy;
  mockRefreshedBalance = balance;
  mockState.vault.accounts.HDAccount[0].balances.ethereum = balance;
  mockLocation.state.tx.amount = max ? balance : '1';
  mockLocation.state.tx.isMax = max;
  mockLocation.state.tx.cachedGasData = {
    maxFeePerGas: '0xb2d05e00',
    maxPriorityFeePerGas: '0x00',
  };
  prepare();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeEnabled()
  );
  if (!legacy) expect(edit()).toBeEnabled();
  expect(quoteRequests()).toHaveLength(0);
};
const changeFee = async (save: boolean) => {
  fireEvent.click(edit());
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByPlaceholderText('send.maxFee (GWEI)'), {
    target: { value: '4' },
  });
  fireEvent.change(dialog.getByPlaceholderText('send.gasLimit'), {
    target: { value: '30000' },
  });
  await act(async () =>
    fireEvent.click(
      dialog.getByRole('button', {
        name: save ? 'buttons.save' : 'buttons.cancel',
      })
    )
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};
const captureRefusedSubmission = async () => {
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  await waitFor(() => expect(submissionCalls()).toHaveLength(1));
  return submissionCalls()[0][1][0];
};
const expectedNet = (gas: bigint, capGwei: bigint) =>
  formatEther(
    BigInt('100000000000000000000') -
      gas * capGwei * BigInt(1000000000) -
      BigInt(1000000000000)
  );

it('healthy ordinary fixed amount displays and forwards its exact value at refused signing boundary', async () => {
  await ready(false);
  expect(headline()).toBe('1 TSYS');
  const tx = await captureRefusedSubmission();
  expect(BigInt(tx.value).toString()).toBe('1000000000000000000');
  expect(tx.gasLimit.toString()).toBe('21000');
  expect(tx.maxFeePerGas.toString()).toBe('3000000000');
});
it('healthy ordinary fixed amount preserves value when actual fee form saves new gas and cap', async () => {
  await ready(false);
  await changeFee(true);
  expect(headline()).toBe('1 TSYS');
  expect(screen.getByText('0.00012 TSYS')).toBeInTheDocument();
  const tx = await captureRefusedSubmission();
  expect(BigInt(tx.value).toString()).toBe('1000000000000000000');
  expect(tx.gasLimit.toString()).toBe('30000');
  expect(tx.maxFeePerGas.toString()).toBe('4000000000');
});
it('healthy MAX cancel discards actual fee form edits and forwards the original net only', async () => {
  await ready(true);
  await changeFee(false);
  expect(screen.getByText('0.000063 TSYS')).toBeInTheDocument();
  const tx = await captureRefusedSubmission();
  expect(formatEther(tx.value)).toBe(expectedNet(BigInt(21000), BigInt(3)));
  expect(tx.gasLimit.toString()).toBe('21000');
  expect(tx.maxFeePerGas.toString()).toBe('3000000000');
});
it.each([false, true])(
  'native MAX headline matches the prepared exact net after saved fee edit=%s',
  async (saved) => {
    await ready(true);
    if (saved) await changeFee(true);
    const observed = headline();
    const tx = await captureRefusedSubmission();
    const gas = BigInt(saved ? 30000 : 21000);
    const cap = BigInt(saved ? 4 : 3);
    const net = expectedNet(gas, cap);
    expect(formatEther(tx.value)).toBe(net);
    expect(tx.gasLimit.toString()).toBe(String(gas));
    expect(tx.maxFeePerGas.toString()).toBe(String(cap * BigInt(1000000000)));
    expect(observed).toBe(net + ' TSYS');
  }
);

const reviewedTotal = () => screen.getByText(/^send.total/).textContent;

it.each([false, true])(
  'MAX total follows the reviewed amount plus displayed fee after balance update (legacy=%s)',
  async (legacy) => {
    await ready(true, { legacy });
    expect(reviewedTotal()).toContain('99.999999 TSYS');
    mockState.vault.accounts.HDAccount[0].balances.ethereum = '99';
    await act(async () => mockRerender!());
    expect(headline()).toBe('98.999936 TSYS');
    expect(reviewedTotal()).toContain('98.999999 TSYS');
  }
);

it.each([false, true])(
  'MAX total retains wei precision for the reviewed amount plus fee (legacy=%s)',
  async (legacy) => {
    await ready(true, { balance: '1.123456789123456789', legacy });
    expect(reviewedTotal()).toContain('1.123455789123456789 TSYS');
  }
);

it.each([false, true])(
  'keeps exact native MAX wei for high-precision balance (legacy=%s)',
  async (legacy) => {
    const balance = '1.123456789123456789';
    await ready(true, { balance, legacy });
    const net = formatEther(parseEther(balance) - BigInt(64000000000000));
    expect(headline()).toBe(net + ' TSYS');
    const tx = await captureRefusedSubmission();
    expect(formatEther(tx.value)).toBe(net);
    expect(BigInt(tx.gasLimit.toString())).toBe(BigInt(21000));
    if (legacy) expect(BigInt(tx.gasPrice)).toBe(BigInt(3000000000));
    else expect(tx.maxFeePerGas.toString()).toBe('3000000000');
  }
);

it.each([false, true])(
  'preserves a one-wei positive native MAX net (legacy=%s)',
  async (legacy) => {
    await ready(true, { balance: '0.000064000000000001', legacy });
    expect(headline()).toBe('0.000000000000000001 TSYS');
    const tx = await captureRefusedSubmission();
    expect(BigInt(tx.value)).toBe(BigInt(1));
  }
);

it.each([false, true])(
  'does not advertise an unaffordable native MAX gross amount (legacy=%s)',
  async (legacy) => {
    await ready(true, { balance: '0.000063', legacy });
    expect(headline()).toBe('send.calculating TSYS');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
    );
    expect(submissionCalls()).toHaveLength(0);
  }
);

it('does not advertise gross MAX while its initial quote is pending or failed', async () => {
  mockLocation.state.tx.amount = '100';
  mockLocation.state.tx.isMax = true;
  const [quote] = prepare();
  expect(headline()).toBe('send.calculating TSYS');
  await waitForQuote();
  expect(headline()).toBe('send.calculating TSYS');
  expect(reviewedTotal()).toContain('send.calculating');
  expect(reviewedTotal()).not.toContain('100 TSYS');
  await act(async () => quote.reject(new Error('Synthetic failed quote')));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'send.editFee' })).toBeNull()
  );
  expect(headline()).toBe('send.calculating TSYS');
  expect(reviewedTotal()).toContain('send.calculating');
  expect(reviewedTotal()).not.toContain('100 TSYS');
  expect(submissionCalls()).toHaveLength(0);
});

it.each([
  [false, '100'],
  [false, '101'],
  [true, '100'],
  [true, '101'],
] as const)(
  'keeps the reviewed native MAX when legacy=%s and refreshed balance=%s',
  async (legacy, refreshedBalance) => {
    await ready(true, { legacy });
    const reviewed = headline();
    mockRefreshedBalance = refreshedBalance;
    const tx = await captureRefusedSubmission();
    expect(formatEther(tx.value) + ' TSYS').toBe(reviewed);
  }
);

it.each([false, true])(
  'rejects native MAX before submission when refreshed balance cannot afford the reviewed amount (legacy=%s)',
  async (legacy) => {
    await ready(true, { legacy });
    expect(headline()).toBe('99.999936 TSYS');
    mockRefreshedBalance = '99';
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
    );
    await waitFor(() =>
      expect(mockAlertError).toHaveBeenCalledWith(
        'send.maxBalanceReviewRequired'
      )
    );
    expect(submissionCalls()).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'buttons.confirm' })
      ).toBeEnabled()
    );
  }
);

it('does not submit a MAX when the fee mode changes during refresh', async () => {
  await ready(true);
  mockRefreshDeferred = deferred();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(
        ([path]) => path.at(-1) === 'refreshActiveAccountBalances'
      )
    ).toBe(true)
  );
  mockEIP1559 = false;
  await act(async () => mockRerender!());
  await act(async () => mockRefreshDeferred!.resolve({ nativeBalance: '100' }));
  expect(submissionCalls()).toHaveLength(0);
  expect(mockAlertError).not.toHaveBeenCalledWith(
    'send.maxBalanceReviewRequired'
  );
});

it('does not submit a MAX after the account or network scope changes during refresh', async () => {
  await ready(true);
  mockRefreshDeferred = deferred();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.some(
        ([path]) => path.at(-1) === 'refreshActiveAccountBalances'
      )
    ).toBe(true)
  );
  mockScope.network = 'different-network';
  await act(async () => mockRefreshDeferred!.resolve({ nativeBalance: '100' }));
  expect(submissionCalls()).toHaveLength(0);
  expect(mockAlertError).not.toHaveBeenCalledWith(
    'send.maxBalanceReviewRequired'
  );
});

it.each([false, true])(
  'rejects native MAX before submission when its fresh balance cannot be read (legacy=%s)',
  async (legacy) => {
    await ready(true, { legacy });
    mockRefreshFails = true;
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
    );
    await waitFor(() =>
      expect(mockAlertError).toHaveBeenCalledWith(
        'send.maxBalanceReviewRequired'
      )
    );
    expect(submissionCalls()).toHaveLength(0);
  }
);
