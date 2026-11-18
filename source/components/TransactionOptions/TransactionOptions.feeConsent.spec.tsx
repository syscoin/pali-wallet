/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';

import { SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT } from '../../shared/smartAccountControllerAuthority';
import { ConfirmationModal } from 'components/Modal/Modal';
import { getWalletNavigationScope } from 'utils/navigationState';
import {
  handleUpdateTransaction,
  previewSpeedUpTransaction,
  UpdateTxAction,
} from 'utils/transactions';

import { TransactionOptions } from './TransactionOptions';

const ORIGINAL = `0x${'11'.repeat(32)}`;
const REPLACEMENT = `0x${'22'.repeat(32)}`;
const ACCOUNT = `0x${'33'.repeat(20)}`;
const NEXT_ACCOUNT = `0x${'44'.repeat(20)}`;
const MAXIMUM_FEE = '1234567890123456';
let mockVault: any;
let mockModal: any;
let mockRevision = 0;
const mockSubscribers = new Set<() => void>();
const mockEmitter = jest.fn();
const mockClosePopover = jest.fn();
const mockUpdate = jest.fn(handleUpdateTransaction);
const mockAlert = { error: jest.fn(), warning: jest.fn(), success: jest.fn() };
const mockT = (key: string, values?: any) => {
  const text: Record<string, string> = {
    'buttons.confirm': 'Confirm',
    'buttons.back': 'Back',
    'buttons.cancel': 'Cancel',
    'header.speedUp': 'Speed Up',
    'header.cancelTx': 'Cancel Transaction',
    'transactions.cancelFeePreview': 'Checking cancellation fee…',
    'transactions.cancelFeeConsent':
      'Cancel with a maximum gas fee of {{fee}} {{currency}}?',
    'transactions.cancelFeeUnavailable': 'Cancellation fee unavailable.',
    'send.calculating': 'Calculating…',
    'transactions.replay.maximumFee': 'Maximum fee',
    'transactions.speedUpFeeUnavailable':
      'Unable to check the fee. Please try again.',
    'transactions.speedUpAmountWouldChange':
      'Add funds to this account before speeding up this transaction. The original amount will not be changed.',
  };
  return (text[key] || key).replace(
    /{{(\w+)}}/g,
    (_, name) => values?.[name] || ''
  );
};

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => {
    const react = jest.requireActual('react');
    react.useSyncExternalStore(
      (callback: () => void) => {
        mockSubscribers.add(callback);
        return () => mockSubscribers.delete(callback);
      },
      () => mockRevision
    );
    return selector({ vault: mockVault });
  },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({
  ExternalLinkSvg: () => null,
  TrashIconSvg: () => null,
  LoadingSvg: () => <span>Loading</span>,
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: ({ show, children }: any) =>
    show ? <div role="dialog">{children}</div> : null,
  CenterPanel: ({ children }: any) => <div>{children}</div>,
  CenterTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogHeader: ({ title }: any) => <h2>{title}</h2>,
  DialogBody: ({ children }: any) => <>{children}</>,
  DialogFooter: ({ children }: any) => <>{children}</>,
  DialogActions: ({ children }: any) => <>{children}</>,
  DialogActionButton: ({ children, loading, tone, ...props }: any) => (
    <button
      {...props}
      data-tone={tone}
      disabled={Boolean(props.disabled || loading)}
    >
      {loading ? 'Loading' : children}
    </button>
  ),
}));
jest.mock('@headlessui/react', () => {
  const Menu = ({ children }: any) => children({ open: true });
  Menu.Button = function MenuButton({ children }: any) {
    return <div>{children}</div>;
  };
  Menu.Items = function MenuItems({ children }: any) {
    return <ul>{children}</ul>;
  };
  Menu.Item = ({ children }: any) => children({ active: false });
  const Popover = ({ children }: any) =>
    children({ open: true, close: mockClosePopover });
  Popover.Button = function PopoverButton({ children }: any) {
    return <div>{children}</div>;
  };
  Popover.Panel = function PopoverPanel({ children }: any) {
    return <div>{children}</div>;
  };
  return { Menu, Popover };
});

const transaction = {
  hash: ORIGINAL,
  from: ACCOUNT,
  type: 2,
  nonce: 0,
  // History is deliberately different from the authenticated preview.
  gasLimit: '999999999',
  maxFeePerGas: '99999999999999999999999',
};
const Harness = ({
  tx = transaction,
  chainId = 1,
  showOptions = true,
}: any) => {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<any>();
  mockModal = modal;
  return (
    <>
      {showOptions && (
        <TransactionOptions
          transaction={tx}
          chainId={chainId}
          alert={mockAlert}
          handleUpdateTransaction={mockUpdate}
          setIsOpenModal={setOpen}
          setModalData={setModal}
        />
      )}
      <ConfirmationModal show={open} {...modal} />
    </>
  );
};
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
};
const openSpeedUp = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Speed Up' }));
const speedUpConfirm = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm' });
const quote = (maximumFee = MAXIMUM_FEE) => ({
  isSpeedUp: false,
  maximumFee,
});
const settleQuote = async (
  pending: ReturnType<typeof deferred>,
  value: any
) => {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset();
  mockUpdate.mockReset().mockImplementation(handleUpdateTransaction);
  mockModal = undefined;
  mockVault = {
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: { HDAccount: { 0: { address: ACCOUNT } } },
    activeNetwork: {
      chainId: 1,
      kind: 'evm',
      currency: 'eth',
      url: 'https://rpc.example',
      explorer: 'https://explorer.example',
    },
  };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('quotes a local Smart Account replacement from its gas payer in the existing menu', async () => {
  mockVault.activeAccount = { type: 'SmartAccount', id: 7 };
  mockVault.accounts.SmartAccount = {
    7: {
      address: NEXT_ACCOUNT,
      isSmartAccount: true,
      smartAccount: { chainId: 1 },
    },
  };
  mockEmitter
    .mockResolvedValueOnce(quote())
    .mockRejectedValueOnce(new Error('Submission could not be confirmed'));
  const refresh = jest.fn();
  window.addEventListener(SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT, refresh, {
    once: true,
  });
  render(
    <Harness
      tx={{
        ...transaction,
        from: NEXT_ACCOUNT,
        feePayer: ACCOUNT,
        historySource: 'local-signed',
        speedUpAvailable: true,
      }}
    />
  );
  openSpeedUp();
  await screen.findByText('0.001234567890123456 ETH');
  expect(screen.getByText('Maximum fee')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockModal).toBeUndefined();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'speedUpEvmTransaction'],
    [
      ORIGINAL,
      false,
      1,
      ACCOUNT,
      { previewOnly: true, walletScope: getWalletNavigationScope() },
    ]
  );
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('quotes without submitting, shows the exact authenticated fee, and forwards that consent once', async () => {
  const pending = deferred();
  mockEmitter
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({
      isSpeedUp: true,
      transaction: { hash: REPLACEMENT },
    })
    .mockResolvedValueOnce({ hash: REPLACEMENT });
  render(<Harness />);
  openSpeedUp();
  expect(screen.getByRole('status').textContent).toBe('Calculating…');
  expect(speedUpConfirm().disabled).toBe(true);
  fireEvent.click(speedUpConfirm());
  expect(mockModal).toBeUndefined();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'speedUpEvmTransaction'],
    [
      ORIGINAL,
      false,
      1,
      ACCOUNT,
      { previewOnly: true, walletScope: getWalletNavigationScope() },
    ]
  );

  await settleQuote(pending, quote());
  expect(screen.getByText('Maximum fee')).toBeTruthy();
  expect(screen.getByText('0.001234567890123456 ETH')).toBeTruthy();
  const confirm = speedUpConfirm();
  expect(confirm.disabled).toBe(false);
  await act(async () => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(mockClosePopover).toHaveBeenCalled();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenNthCalledWith(
    2,
    ['wallet', 'speedUpEvmTransaction'],
    [
      ORIGINAL,
      false,
      1,
      ACCOUNT,
      {
        approvedMaximumFee: MAXIMUM_FEE,
        walletScope: getWalletNavigationScope(),
      },
    ]
  );
  expect(mockUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      updateData: expect.objectContaining({
        approvedMaximumFee: MAXIMUM_FEE,
        walletScope: getWalletNavigationScope(),
      }),
    })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('routes SmartAccount preview and approved cap through the outer-payer controller', async () => {
  mockVault.activeAccount = { type: 'SmartAccount', id: 0 };
  mockVault.accounts.SmartAccount = { 0: { address: NEXT_ACCOUNT } };
  mockEmitter
    .mockResolvedValueOnce(quote())
    .mockResolvedValueOnce({ isSpeedUp: false });
  render(<Harness />);
  await act(async () => openSpeedUp());
  expect(mockEmitter).toHaveBeenNthCalledWith(
    1,
    ['wallet', 'speedUpEvmTransaction'],
    [
      ORIGINAL,
      false,
      1,
      ACCOUNT,
      { previewOnly: true, walletScope: getWalletNavigationScope() },
    ]
  );
  await act(async () => fireEvent.click(screen.getByText('Confirm')));
  expect(mockEmitter).toHaveBeenNthCalledWith(
    2,
    ['wallet', 'speedUpEvmTransaction'],
    [
      ORIGINAL,
      false,
      1,
      ACCOUNT,
      {
        approvedMaximumFee: MAXIMUM_FEE,
        walletScope: getWalletNavigationScope(),
      },
    ]
  );
});

it('keeps zero network fees visible and usable without converting them to a nonzero cap', async () => {
  mockEmitter.mockResolvedValueOnce(quote('0'));
  render(<Harness />);
  await act(async () => openSpeedUp());
  expect(screen.getByText('0.0 ETH')).toBeTruthy();
  expect(speedUpConfirm().disabled).toBe(false);
});

it('dismisses with Back and ignores the pending quote', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  openSpeedUp();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(mockClosePopover).toHaveBeenCalledTimes(1);
  await settleQuote(pending, quote());
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it.each(['account', 'network'])(
  'ignores a quote after the %s changes',
  async (change) => {
    const pending = deferred();
    mockEmitter.mockReturnValueOnce(pending.promise);
    render(<Harness />);
    openSpeedUp();
    if (change === 'account')
      mockVault.accounts.HDAccount[0].address = NEXT_ACCOUNT;
    else mockVault.activeNetwork.url = 'https://other-rpc.example';
    act(() => {
      mockRevision++;
      mockSubscribers.forEach((subscriber) => subscriber());
    });
    await settleQuote(pending, quote());
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('checks the current scope synchronously before submitting the visible quote', async () => {
  mockEmitter.mockResolvedValueOnce(quote());
  render(<Harness />);
  await act(async () => openSpeedUp());
  mockVault.accounts.HDAccount[0].address = NEXT_ACCOUNT;
  fireEvent.click(speedUpConfirm());
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'disposes the inline confirmation when a mined row removes the options (quoted=%s)',
  async (quoted) => {
    const pending = deferred();
    mockEmitter.mockReturnValueOnce(pending.promise);
    const view = render(<Harness />);
    openSpeedUp();
    if (quoted) await settleQuote(pending, quote());
    view.rerender(<Harness showOptions={false} />);
    if (!quoted) await settleQuote(pending, quote());
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockModal).toBeUndefined();
  }
);

it('closes and reports a quote timeout, then ignores the late response', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  openSpeedUp();
  act(() => jest.advanceTimersByTime(15_000));
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'Unable to check the fee. Please try again.'
  );
  await settleQuote(pending, quote());
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('keeps a fresh preview independent of an earlier dismissed request', async () => {
  const first = deferred();
  const second = deferred();
  mockEmitter
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<Harness />);
  openSpeedUp();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  openSpeedUp();
  await settleQuote(first, quote('999'));
  expect(screen.getByRole('status').textContent).toBe('Calculating…');
  expect(speedUpConfirm().disabled).toBe(true);
  await settleQuote(second, quote());
  expect(screen.getByText('0.001234567890123456 ETH')).toBeTruthy();
  expect(speedUpConfirm().disabled).toBe(false);
});

it.each([
  undefined,
  null,
  { isSpeedUp: true, maximumFee: MAXIMUM_FEE },
  { ...quote(), error: true },
  quote('-1'),
  quote('1e18'),
  quote('00'),
  quote('1'.repeat(79)),
])(
  'rejects malformed preview data %j and never enables submission',
  async (response) => {
    mockEmitter.mockResolvedValueOnce(response);
    render(<Harness />);
    await act(async () => openSpeedUp());
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).toHaveBeenCalledWith(
      'Unable to check the fee. Please try again.'
    );
  }
);

it.each([true, false])(
  'refuses a preview for the wrong active network (UTXO=%s)',
  async (isBitcoinBased) => {
    mockVault.isBitcoinBased = isBitcoinBased;
    mockVault.activeNetwork.chainId = 57;
    await expect(
      previewSpeedUpTransaction(ORIGINAL, false, 1)
    ).rejects.toThrow();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('refuses final submission if the approved scope changed before dispatch', async () => {
  const walletScope = getWalletNavigationScope();
  mockVault.activeNetwork.url = 'https://other-rpc.example';
  await handleUpdateTransaction({
    t: mockT,
    updateData: {
      alert: mockAlert,
      chainId: 1,
      isLegacy: false,
      txHash: ORIGINAL,
      updateType: UpdateTxAction.SpeedUp,
      approvedMaximumFee: MAXIMUM_FEE,
      walletScope,
    },
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'transactions.transactionSpeedUpFailed'
  );
});

it('quotes the cancellation fee and submits the approved maximum once', async () => {
  mockEmitter
    .mockResolvedValueOnce({ isCanceled: false, maximumFee: MAXIMUM_FEE })
    .mockResolvedValueOnce({ isCanceled: false });
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  await act(async () => fireEvent.click(screen.getByText('Confirm')));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelEvmTransaction'],
    [
      ORIGINAL,
      false,
      0,
      ACCOUNT,
      { chainId: 1, walletScope: getWalletNavigationScope() },
      { approvedMaximumFee: MAXIMUM_FEE },
    ]
  );
});

it.each(['account', 'network', 'transaction', 'removed'])(
  'closes a cancellation confirmation when its %s context changes',
  async (change) => {
    mockEmitter.mockResolvedValue({
      isCanceled: false,
      maximumFee: MAXIMUM_FEE,
    });
    const view = render(<Harness />);
    await act(async () => fireEvent.click(screen.getByText('Cancel')));
    const oldConfirm = mockModal.onClick;
    if (change === 'account')
      mockVault.accounts.HDAccount[0].address = NEXT_ACCOUNT;
    if (change === 'network')
      mockVault.activeNetwork.url = 'https://other-rpc.invalid';
    if (change === 'account' || change === 'network')
      act(() => {
        mockRevision++;
        mockSubscribers.forEach((subscriber) => subscriber());
      });
    if (change === 'transaction')
      view.rerender(<Harness tx={{ ...transaction, hash: REPLACEMENT }} />);
    if (change === 'removed') view.rerender(<Harness showOptions={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => oldConfirm());
    expect(mockUpdate).not.toHaveBeenCalled();
  }
);

it('rechecks a retained cancellation callback before React updates the view', async () => {
  mockEmitter.mockResolvedValue({ isCanceled: false, maximumFee: MAXIMUM_FEE });
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  const confirm = mockModal.onClick;
  mockVault.activeNetwork.url = 'https://other-rpc.invalid';
  await act(async () => confirm());
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('admits cancellation once even when its callback is retained', async () => {
  mockEmitter.mockResolvedValue({ isCanceled: false, maximumFee: MAXIMUM_FEE });
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  const confirm = mockModal.onClick;
  await act(async () => {
    confirm();
    confirm();
  });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

it('does not let an old cancellation callback close a newer confirmation', async () => {
  mockEmitter.mockResolvedValue({ isCanceled: false, maximumFee: MAXIMUM_FEE });
  render(<Harness />);
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  const oldClose = mockModal.onClose;
  const oldConfirm = mockModal.onClick;
  act(() => oldClose());
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  await act(async () => {
    oldClose();
    oldConfirm();
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByText('Confirm')));
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});

it('rejects cancellation dispatch when the approved scope has changed', async () => {
  const walletScope = getWalletNavigationScope();
  mockVault.activeNetwork.url = 'https://other-rpc.invalid';
  await handleUpdateTransaction({
    t: mockT,
    updateData: {
      alert: mockAlert,
      approvedMaximumFee: MAXIMUM_FEE,
      chainId: 1,
      isLegacy: false,
      txHash: ORIGINAL,
      updateType: UpdateTxAction.Cancel,
      walletScope,
    },
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'transactions.transactionCancelFailed'
  );
});

it('rejects cancellation without an approved scope instead of adopting the current wallet', async () => {
  await handleUpdateTransaction({
    t: mockT,
    // @ts-expect-error Exercise an obsolete caller at the runtime boundary.
    updateData: {
      alert: mockAlert,
      chainId: 1,
      isLegacy: false,
      txHash: ORIGINAL,
      updateType: UpdateTxAction.Cancel,
    },
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'transactions.transactionCancelFailed'
  );
});

it.each([
  ['nonce', { nonce: 19 }],
  ['sender', { from: NEXT_ACCOUNT }],
  ['type', { type: 0 }],
])(
  'closes cancellation when same-hash %s identity changes',
  async (_label, fields) => {
    mockEmitter.mockResolvedValue({
      isCanceled: false,
      maximumFee: MAXIMUM_FEE,
    });
    const view = render(<Harness />);
    await act(async () => fireEvent.click(screen.getByText('Cancel')));
    const oldConfirm = mockModal.onClick;
    view.rerender(<Harness tx={{ ...transaction, ...fields }} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => oldConfirm());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('keeps cancellation disabled until its quote arrives and displays its exact cap', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  fireEvent.click(screen.getByText('Cancel'));
  expect(
    (screen.getByRole('button', { name: 'Loading' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(mockUpdate).not.toHaveBeenCalled();
  await settleQuote(pending, { isCanceled: false, maximumFee: MAXIMUM_FEE });
  expect(
    screen.getByText(
      'Cancel with a maximum gas fee of 0.001234567890123456 ETH?'
    )
  ).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it.each([
  undefined,
  { isCanceled: true, maximumFee: MAXIMUM_FEE },
  { isCanceled: false, maximumFee: '1e18' },
])(
  'fails closed when cancellation quote is malformed (%j)',
  async (response) => {
    mockEmitter.mockResolvedValueOnce(response);
    render(<Harness />);
    await act(async () => fireEvent.click(screen.getByText('Cancel')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'Cancellation fee unavailable.'
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  }
);

it('ignores a cancellation quote arriving after the modal is closed', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  fireEvent.click(screen.getByText('Cancel'));
  const confirm = mockModal.onClick;
  act(() => mockModal.onClose());
  await settleQuote(pending, { isCanceled: false, maximumFee: MAXIMUM_FEE });
  await act(async () => confirm());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('times out a cancellation quote and ignores its late result', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  fireEvent.click(screen.getByText('Cancel'));
  act(() => jest.advanceTimersByTime(15_000));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledWith('Cancellation fee unavailable.');
  await settleQuote(pending, { isCanceled: false, maximumFee: MAXIMUM_FEE });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('shows the specific amount-preservation guidance when the speed-up preview would reduce the amount', async () => {
  mockEmitter.mockResolvedValueOnce({
    isSpeedUp: false,
    error: true,
    code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
  });
  render(<Harness />);
  await act(async () => openSpeedUp());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'Add funds to this account before speeding up this transaction. The original amount will not be changed.'
  );
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('shows amount-preservation guidance if the balance changes after fee approval', async () => {
  mockEmitter.mockResolvedValueOnce(quote()).mockResolvedValueOnce({
    isSpeedUp: false,
    error: true,
    code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
  });
  render(<Harness />);
  await act(async () => openSpeedUp());
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  );
  expect(mockAlert.error).toHaveBeenCalledWith(
    'Add funds to this account before speeding up this transaction. The original amount will not be changed.'
  );
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('does not classify a stale amount-change preview as current', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const preview = previewSpeedUpTransaction(ORIGINAL, false, 1);
  mockVault.activeNetwork.url = 'https://other-rpc.example';
  pending.resolve({
    isSpeedUp: false,
    error: true,
    code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
  });
  await expect(preview).rejects.toThrow('Transaction context changed');
});

it('does not show amount guidance from a final response after the scope changes', async () => {
  const pending = deferred();
  const walletScope = getWalletNavigationScope();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const operation = handleUpdateTransaction({
    t: mockT,
    updateData: {
      alert: mockAlert,
      chainId: 1,
      isLegacy: false,
      txHash: ORIGINAL,
      updateType: UpdateTxAction.SpeedUp,
      approvedMaximumFee: MAXIMUM_FEE,
      walletScope,
    },
  });
  mockVault.activeNetwork.url = 'https://other-rpc.example';
  pending.resolve({
    isSpeedUp: false,
    error: true,
    code: 'REPLACEMENT_VALUE_WOULD_CHANGE',
  });
  await operation;
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(mockAlert.warning).not.toHaveBeenCalled();
  expect(mockAlert.success).not.toHaveBeenCalled();
});
