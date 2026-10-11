/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';

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
const mockUpdate = jest.fn(handleUpdateTransaction);
const mockAlert = { error: jest.fn(), warning: jest.fn(), success: jest.fn() };
const mockT = (key: string, values?: any) => {
  const text: Record<string, string> = {
    'buttons.confirm': 'Confirm',
    'buttons.cancel': 'Cancel',
    'header.speedUp': 'Speed Up',
    'header.speedTx': 'Speed Up Transaction',
    'transactions.speedUpFeePreview': 'Checking the network fee…',
    'transactions.speedUpFeeConsent':
      'Speed up this transaction with a maximum network fee of {{fee}} {{currency}}?',
    'transactions.speedUpFeeUnavailable':
      'Unable to check the fee. Please try again.',
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
  return { Menu };
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
const openSpeedUp = () => fireEvent.click(screen.getByText('Speed Up'));
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
  expect(screen.getByText('Checking the network fee…')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Loading' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  const waitingConfirm = mockModal.onClick;
  waitingConfirm();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
    [ORIGINAL, false, { previewOnly: true }]
  );

  await settleQuote(pending, quote());
  expect(
    screen.getByText(
      'Speed up this transaction with a maximum network fee of 0.001234567890123456 ETH?'
    )
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  const confirm = mockModal.onClick;
  await act(async () => {
    confirm();
    confirm();
  });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenNthCalledWith(
    2,
    ['wallet', 'ethereumTransaction', 'sendTransactionWithEditedFee'],
    [ORIGINAL, false, { approvedMaximumFee: MAXIMUM_FEE }]
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
    [ORIGINAL, false, 1, ACCOUNT, { previewOnly: true }]
  );
  await act(async () => fireEvent.click(screen.getByText('Confirm')));
  expect(mockEmitter).toHaveBeenNthCalledWith(
    2,
    ['wallet', 'speedUpEvmTransaction'],
    [ORIGINAL, false, 1, ACCOUNT, { approvedMaximumFee: MAXIMUM_FEE }]
  );
});

it('keeps zero network fees visible and usable without converting them to a nonzero cap', async () => {
  mockEmitter.mockResolvedValueOnce(quote('0'));
  render(<Harness />);
  await act(async () => openSpeedUp());
  expect(
    screen.getByText(
      'Speed up this transaction with a maximum network fee of 0.0 ETH?'
    )
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
});

it('ignores a delayed quote after Cancel and latches any retained confirmation callback', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  openSpeedUp();
  const confirm = mockModal.onClick;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await settleQuote(pending, quote());
  confirm();
  expect(screen.queryByRole('dialog')).toBeNull();
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
    const confirm = mockModal.onClick;
    if (change === 'account')
      mockVault.accounts.HDAccount[0].address = NEXT_ACCOUNT;
    else mockVault.activeNetwork.url = 'https://other-rpc.example';
    act(() => {
      mockRevision++;
      mockSubscribers.forEach((subscriber) => subscriber());
    });
    await settleQuote(pending, quote());
    confirm();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('checks the current scope synchronously before a retained confirmation callback', async () => {
  mockEmitter.mockResolvedValueOnce(quote());
  render(<Harness />);
  await act(async () => openSpeedUp());
  const confirm = mockModal.onClick;
  mockVault.accounts.HDAccount[0].address = NEXT_ACCOUNT;
  confirm();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('ignores a late quote after the option component unmounts', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const view = render(<Harness />);
  openSpeedUp();
  const confirm = mockModal.onClick;
  view.unmount();
  await settleQuote(pending, quote());
  confirm();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it.each([false, true])(
  'closes a parent-owned modal when a mined row removes the options (quoted=%s)',
  async (quoted) => {
    const pending = deferred();
    mockEmitter.mockReturnValueOnce(pending.promise);
    const view = render(<Harness />);
    openSpeedUp();
    if (quoted) await settleQuote(pending, quote());
    const confirm = mockModal.onClick;
    view.rerender(<Harness showOptions={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    if (!quoted) await settleQuote(pending, quote());
    confirm();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
  }
);

it('closes and reports a quote timeout, then ignores the late response', async () => {
  jest.useFakeTimers();
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<Harness />);
  openSpeedUp();
  act(() => jest.advanceTimersByTime(15_000));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledWith(
    'Unable to check the fee. Please try again.'
  );
  await settleQuote(pending, quote());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockAlert.error).toHaveBeenCalledTimes(1);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('keeps a fresh preview independent of an earlier cancelled request', async () => {
  const first = deferred();
  const second = deferred();
  mockEmitter
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<Harness />);
  openSpeedUp();
  const oldClose = mockModal.onClose;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  openSpeedUp();
  act(() => oldClose());
  await settleQuote(first, quote('999'));
  expect(screen.getByText('Checking the network fee…')).toBeTruthy();
  await settleQuote(second, quote());
  expect(
    screen.getByText(/maximum network fee of 0.001234567890123456 ETH/)
  ).toBeTruthy();
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
    expect(screen.queryByRole('dialog')).toBeNull();
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

it('retains the existing Cancel flow without requesting a speed-up quote', async () => {
  mockEmitter.mockResolvedValueOnce({ isCanceled: false });
  render(<Harness />);
  fireEvent.click(screen.getByText('Cancel'));
  await act(async () => fireEvent.click(screen.getByText('Confirm')));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelEvmTransaction'],
    [ORIGINAL, false, 0, ACCOUNT]
  );
});
