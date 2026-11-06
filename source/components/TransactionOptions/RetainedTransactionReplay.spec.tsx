/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { RetainedTransactionReplay } from './RetainedTransactionReplay';

const HASH = `0x${'11'.repeat(32)}`;
const PREVIOUS = `0x${'22'.repeat(32)}`;
let mockScope = { account: 'account-a', network: 'network-a' };
let mockRevision = 0;
let mockAccountType = 'HDAccount';
const mockSubscribers = new Set<() => void>();
const mockEmitter = jest.fn();
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
        accounts: { Imported: {} },
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
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const review = (id = 'review-1', hash = HASH) => ({
  status: 'review',
  review: {
    id,
    hash,
    validForMs: 90000,
    chainId: '57057',
    from: `0x${'33'.repeat(20)}`,
    to: null,
    value: '1000000000000000001',
    nonce: '4',
    maximumFee: '1234567890000000',
    dataBytes: 10000,
    selector: '0x12345678',
    accessListEntries: 2,
    operation: 'send',
    predecessors: [],
    predecessorCount: 0,
  },
});
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
  mockRevision++;
  mockEmitter.mockReset();
  mockEmitter.mockImplementation(([, method]: string[], args: any[]) => {
    if (method === 'getSavedEvmTransaction')
      return Promise.resolve({ hash: HASH });
    if (method === 'prepareEvmSignedReplay')
      return Promise.resolve(review('review-1', args[0]));
    if (method === 'confirmEvmSignedReplay')
      return Promise.resolve({ status: 'submitted', hash: HASH });
    return Promise.resolve();
  });
});
afterEach(() => {
  jest.useRealTimers();
});

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
  fireEvent.click(screen.getByRole('button', { name: 'Review cancellation' }));
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
  expect(screen.getByRole('status').textContent).toContain(
    'Cancellation submitted.'
  );
  expect(screen.getByRole('status').textContent).toContain(PREVIOUS);
  expect(
    screen.queryByRole('button', { name: 'Review cancellation' })
  ).toBeNull();
});

test('saved cancellation reports a verified fee shortfall before signing', async () => {
  exposeSavedCancellation();
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  mockEmitter.mockRejectedValueOnce(
    new Error('Insufficient funds for reviewed EVM transfer')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review cancellation' }));
  await flush();
  expect(screen.getByRole('status').textContent).toContain(
    'Insufficient funds to cover gas fees'
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
  fireEvent.click(screen.getByRole('button', { name: 'Review cancellation' }));
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
      screen.queryByRole('button', { name: 'Review cancellation' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Review resend' })).toBeTruthy();
  }
);

test('shows saved collectible intent without preparing or changing generic replay', async () => {
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
  expect(screen.getByText('Review resend')).toBeTruthy();
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
  expect(screen.getByText('Review resend')).toBeTruthy();
});

test('review shows exact amount, fee, contract creation and calldata before a single nonretrying confirm', async () => {
  const confirmation = deferred<any>();
  mockEmitter.mockImplementationOnce(() => Promise.resolve({ hash: HASH }));
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  fireEvent.click(screen.getByText('Review resend'));
  await flush();
  expect(screen.getByText('1.000000000000000001 SYS')).toBeTruthy();
  expect(screen.getByText('0.00123456789 SYS')).toBeTruthy();
  expect(screen.getByText('Contract creation')).toBeTruthy();
  expect(screen.getByText('10000 bytes · 0x12345678')).toBeTruthy();
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toBe(false);
  mockEmitter.mockImplementation(([, method]: string[]) =>
    method === 'confirmEvmSignedReplay'
      ? confirmation.promise
      : Promise.resolve()
  );
  fireEvent.click(screen.getByText('Resend'));
  fireEvent.click(screen.getByText('Resend'));
  expect(
    mockEmitter.mock.calls.filter(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toEqual([
    [['wallet', 'confirmEvmSignedReplay'], ['review-1'], 30000, false],
  ]);
  await act(async () =>
    confirmation.resolve({ status: 'submitted', hash: HASH })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain(
    'Transaction resent'
  );
});

test('expiry clears old consent and a fresh review uses a different ID', async () => {
  let next = 0;
  mockEmitter.mockImplementation(([, method]: string[]) =>
    method === 'prepareEvmSignedReplay'
      ? Promise.resolve(review(`review-${++next}`))
      : Promise.resolve({ hash: HASH })
  );
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  fireEvent.click(screen.getByText('Review resend'));
  await flush();
  act(() => {
    jest.advanceTimersByTime(90000);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelEvmSignedReplay'],
    ['review-1'],
    10000,
    false
  );
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toBe(false);
  fireEvent.click(screen.getByText('Review resend'));
  await flush();
  fireEvent.click(screen.getByText('Resend'));
  await flush();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'confirmEvmSignedReplay'],
    ['review-2'],
    30000,
    false
  );
});

test('a late review after an account A-B-A change only cancels its own ID', async () => {
  const pending = deferred<any>();
  mockEmitter.mockImplementation(([, method]: string[]) =>
    method === 'prepareEvmSignedReplay'
      ? pending.promise
      : Promise.resolve({ hash: HASH })
  );
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  fireEvent.click(screen.getByText('Review resend'));
  changeScope('account-b');
  changeScope('account-a');
  await flush();
  await act(async () => pending.resolve(review('stale-review')));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelEvmSignedReplay'],
    ['stale-review'],
    10000,
    false
  );
});

test('selecting a retained predecessor requires its own fresh review and does not submit automatically', async () => {
  mockEmitter.mockImplementation(([, method]: string[], args: any[]) => {
    if (method !== 'prepareEvmSignedReplay')
      return Promise.resolve({ hash: HASH });
    const result = review(
      args[0] === HASH ? 'current-review' : 'previous-review',
      args[0]
    );
    if (args[0] === HASH)
      Object.assign(result.review, {
        missingNonce: '3',
        predecessors: [{ hash: PREVIOUS, operation: 'cancel', nonce: 3 }],
      });
    return Promise.resolve(result);
  });
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  fireEvent.click(screen.getByText('Review resend'));
  await flush();
  fireEvent.click(screen.getByText(/Review previous transaction/));
  await flush();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'prepareEvmSignedReplay'],
    [PREVIOUS],
    15000,
    false
  );
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'cancelEvmSignedReplay'],
    ['current-review'],
    10000,
    false
  );
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toBe(false);
});

test('a missing saved record leaves the existing details uncluttered', async () => {
  mockEmitter.mockResolvedValue(null);
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  expect(screen.queryByRole('button')).toBeNull();
});

test('lost confirm response directs the user to Activity without another dispatch', async () => {
  render(<RetainedTransactionReplay hash={HASH} />);
  await flush();
  fireEvent.click(screen.getByText('Review resend'));
  await flush();
  mockEmitter.mockRejectedValue(new Error('Network request timed out'));
  fireEvent.click(screen.getByText('Resend'));
  await flush();
  expect(screen.getByRole('status').textContent).toContain('Check Activity');
  expect(
    mockEmitter.mock.calls.filter(
      (call) => call[0][1] === 'confirmEvmSignedReplay'
    )
  ).toHaveLength(1);
});

test.each([81, 255])(
  'reviews a one-unit token with %i decimals using the shared exact formatter',
  async (decimals) => {
    mockEmitter.mockImplementation(([, method]: string[]) => {
      if (method !== 'prepareEvmSignedReplay')
        return Promise.resolve({ hash: HASH });
      const result = review();
      Object.assign(result.review, {
        tokenTransfer: {
          recipient: 'public-token-recipient',
          amountUnits: '1',
          token: { decimals, symbol: 'TKN' },
        },
      });
      return Promise.resolve(result);
    });
    render(<RetainedTransactionReplay hash={HASH} />);
    await flush();
    fireEvent.click(screen.getByText('Review resend'));
    await flush();
    expect(screen.getByText(`0.${'0'.repeat(decimals - 1)}1 TKN`)).toBeTruthy();
    expect(screen.getByText('public-token-recipient')).toBeTruthy();
    expect(
      mockEmitter.mock.calls.some(
        (call) => call[0][1] === 'confirmEvmSignedReplay'
      )
    ).toBe(false);
  }
);
