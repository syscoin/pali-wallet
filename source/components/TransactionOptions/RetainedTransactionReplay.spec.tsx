/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { RetainedTransactionReplay } from './RetainedTransactionReplay';

const PREVIOUS = `0x${'22'.repeat(32)}`;
const HASH = `0x${'11'.repeat(32)}`;
let mockScope = { account: 'account-a', network: 'network-a' };
let mockRevision = 0;
let mockAccountType = 'HDAccount';
let mockSmartAccountAvailable = false;
const mockSubscribers = new Set<() => void>();
const mockEmitter = jest.fn();
const mockAlert = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
};
const messages = jest.requireActual('../../assets/locales/en.json');
const mockT = (key: string, values?: Record<string, string>) => {
  let value: any = messages;
  for (const part of key.split('.')) value = value?.[part];
  return String(value ?? key).replace(
    /{{(\w+)}}/g,
    (_, name) => values?.[name] ?? ''
  );
};
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-redux', () => ({
  shallowEqual: (a: any, b: any) => a === b,
  useSelector: (selector: any) => {
    jest.requireActual('react').useSyncExternalStore(
      (callback: () => void) => {
        mockSubscribers.add(callback);
        return () => mockSubscribers.delete(callback);
      },
      () => mockRevision
    );
    return selector({
      vault: {
        activeAccount: { id: 0, type: mockAccountType },
        accounts: {
          Imported: {},
          SmartAccount: mockSmartAccountAvailable
            ? { 0: { isSmartAccount: true, smartAccount: { chainId: 57057 } } }
            : {},
        },
        activeNetwork: {
          label: 'Test network',
          currency: 'SYS',
          chainId: 57057,
        },
      },
    });
  },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('hooks/useUtils', () => ({ useUtils: () => ({ alert: mockAlert }) }));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockEmitter(...args),
}));
jest.mock('components/Modal', () => ({
  ConfirmationModal: ({
    show,
    children,
    title,
    description,
    onClose,
    onClick,
    isButtonLoading,
    buttonText,
  }: any) =>
    show ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        <button onClick={onClose} disabled={isButtonLoading}>
          Close
        </button>
        <button onClick={onClick} disabled={isButtonLoading}>
          {buttonText}
        </button>
      </div>
    ) : null,
}));
jest.mock('../../pages/Send/components/ReviewedAssetIcon', () => ({
  ReviewedAssetIcon: () => null,
}));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const changeScope = (account: string) =>
  act(() => {
    mockScope = { ...mockScope, account };
    mockRevision++;
    mockSubscribers.forEach((callback) => callback());
  });
beforeEach(() => {
  jest.useFakeTimers();
  mockScope = { account: 'account-a', network: 'network-a' };
  mockAccountType = 'HDAccount';
  mockSmartAccountAvailable = false;
  mockRevision++;
  mockEmitter.mockReset().mockResolvedValue(undefined);
  Object.values(mockAlert).forEach((method) => method.mockClear());
});
afterEach(() => jest.useRealTimers());

const savedCancellationQuote = {
  id: 'cancel-1',
  hash: HASH,
  chainId: 57057,
  from: `0x${'33'.repeat(20)}`,
  nonce: 0,
  maximumFee: '1234567890000000',
  validForMs: 90000,
};
const exposeSavedCancellation = () =>
  mockEmitter.mockImplementationOnce(() =>
    Promise.resolve({
      hash: HASH,
      operation: 'erc721',
      phase: 'signed',
      type: 0,
    })
  );

test('an explicit saved Cancel review sends only its opaque one-use approval', async () => {
  exposeSavedCancellation();
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  const pending = deferred<{ hash: string; status: string }>();
  mockEmitter
    .mockResolvedValueOnce(savedCancellationQuote)
    .mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Transaction' }));
  await flush();
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'prepareRetainedEvmCancellation'],
    [HASH],
    15000,
    false
  );
  expect(
    screen.getByText(/0\.00123456789 SYS.*original may still confirm first/)
  ).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getByText(HASH)).toBeTruthy();
  const confirm = screen.getByRole('button', { name: 'Confirm' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(
    mockEmitter.mock.calls.filter(
      ([route]) => route[1] === 'confirmRetainedEvmCancellation'
    )
  ).toEqual([
    [['wallet', 'confirmRetainedEvmCancellation'], ['cancel-1'], 30000, false],
  ]);
  pending.resolve({ status: 'submitted', hash: PREVIOUS });
  await flush();
  expect(mockAlert.success).toHaveBeenCalledWith(
    expect.stringContaining('Cancellation submitted.'),
    undefined,
    expect.any(Function)
  );
  expect(mockAlert.success.mock.calls[0][0]).toContain(PREVIOUS);
  expect(
    screen.queryByRole('button', { name: 'Cancel Transaction' })
  ).toBeNull();
});

test('saved cancellation reports a verified fee shortfall before signing', async () => {
  exposeSavedCancellation();
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  mockEmitter.mockRejectedValueOnce(
    new Error('Insufficient funds for reviewed EVM transfer')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Transaction' }));
  await flush();
  expect(mockAlert.error).toHaveBeenCalledWith(
    messages.send.insufficientFundsForGas
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    mockEmitter.mock.calls.some(
      ([route]) => route[1] === 'confirmRetainedEvmCancellation'
    )
  ).toBe(false);
});

test('an old account cannot use an arriving saved Cancel quote', async () => {
  exposeSavedCancellation();
  const pending = deferred<typeof savedCancellationQuote>();
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  mockEmitter.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel Transaction' }));
  changeScope('account-b');
  pending.resolve(savedCancellationQuote);
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelRetainedEvmCancellationReview'],
    ['cancel-1'],
    10000,
    false
  );
});

test.each(['Ledger', 'Trezor', 'SmartAccount', 'Imported'])(
  'does not expose the new software-only saved cancellation for %s',
  async (type) => {
    mockAccountType = type;
    exposeSavedCancellation();
    render(<RetainedTransactionReplay hash={HASH} />);
    await flush();
    expect(
      screen.queryByRole('button', { name: 'Cancel Transaction' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review resend' })).toBeNull();
  }
);

test('shows saved collectible intent without enabling ordinary replay', async () => {
  const amountUnits = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
  const recipient = `0x${'22'.repeat(20)}`;
  const contractAddress = `0x${'33'.repeat(20)}`;
  mockEmitter.mockImplementationOnce(() =>
    Promise.resolve({
      hash: HASH,
      collectibleTransfer: {
        chainId: '57057',
        recipient,
        contractAddress,
        tokenStandard: 'ERC-1155',
        tokenId: '0',
        amountUnits,
      },
    })
  );
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  expect(screen.getByText('NFT transfer')).toBeTruthy();
  expect(screen.getByText('ERC-1155')).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getByText(amountUnits)).toBeTruthy();
  expect(screen.getByText(recipient)).toBeTruthy();
  expect(screen.getByText(contractAddress)).toBeTruthy();
  expect(mockEmitter.mock.calls.map((call) => call[0][1])).toEqual([
    'getSavedEvmTransaction',
  ]);
  expect(screen.queryByText('Review resend')).toBeNull();
  mockEmitter.mockImplementationOnce(() =>
    Promise.resolve({
      hash: HASH,
      collectibleTransfer: { chainId: '1', tokenId: '0', amountUnits },
    })
  );
  changeScope('account-b');
  expect(screen.queryByText(amountUnits)).toBeNull();
  await flush();
  expect(screen.queryByText(amountUnits)).toBeNull();
  expect(screen.queryByText('Review resend')).toBeNull();
});
