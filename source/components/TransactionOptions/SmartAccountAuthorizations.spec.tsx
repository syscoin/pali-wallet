/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

let mockScope = 'one';
const mockRequest = jest.fn();
const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'SmartAccount' },
    activeNetwork: { chainId: 1, url: 'https://rpc.test' },
    isBitcoinBased: false,
  },
};
jest.mock('react-redux', () => ({
  useSelector: (selector) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));
jest.mock('../../utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: mockScope, network: 'eth' }),
}));
jest.mock('../../scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('./useSmartAccountCancellation', () => ({
  useSmartAccountCancellation: (reference: string, operationHash: string) => ({
    available: true,
    busy: false,
    content: null,
    request: () => {
      if (mockRequest(reference, operationHash))
        window.dispatchEvent(
          new Event('pali-smart-account-authorization-signed')
        );
    },
  }),
}));
import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';

import {
  Instruction,
  useSmartAccountAuthorizations,
} from './SmartAccountAuthorizations';

const hash = '0x' + '11'.repeat(32);
const entry = {
  account: '0x' + '22'.repeat(20),
  chainId: '1',
  createdAt: 123,
  operationHash: hash,
  operationNonce: '1',
  observedAt: { number: '12', hash },
  payer: '0x' + '33'.repeat(20),
};
const replacement = (byte: string) => ({
  ...entry,
  createdAt: 456,
  operationHash: `0x${byte.repeat(32)}`,
  replacesOperationHash: hash,
});
const cancellation = replacement('44');
const otherCancellation = replacement('55');
const observation = (
  operationHash: string,
  kind: 'pending' | 'nonce-consumed' | 'observed',
  success = true
) => ({
  anchor: entry.observedAt,
  currentNonce: kind === 'pending' ? '1' : '2',
  operationHash,
  kind,
  ...(kind === 'observed' && { success }),
});
const emit = controllerEmitter as jest.Mock;
const openStatus = (row: HTMLElement) => {
  const details = row.querySelector('details')!;
  details.open = true;
};
const cancelInstruction = 'buttons.cancel';
function ActivityRows() {
  const { groups, scope, load, cursor, failed } =
    useSmartAccountAuthorizations(true);
  return (
    <>
      <ul>
        {groups.map((group) => (
          <Instruction key={group.hash} group={group} scope={scope} />
        ))}
      </ul>
      {failed && <span role="alert">unavailable</span>}
      {cursor && (
        <button onClick={() => void load('more')}>buttons.loadMore</button>
      )}
    </>
  );
}
beforeEach(() => {
  mockScope = 'one';
  emit.mockReset();
  mockRequest.mockReset();
});

it('loads local Activity history on mount and refreshes status when the row is expanded', async () => {
  emit.mockImplementation(async ([, method]) =>
    method === 'getSmartAccountAuthorizations'
      ? { entries: [entry], nextCursor: null }
      : observation(hash, 'nonce-consumed')
  );
  render(<ActivityRows />);
  await screen.findByText(hash);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'buttons.cancel',
    })
  );
  expect(mockRequest).toHaveBeenCalledWith(hash, hash);
  fireEvent.click(screen.getByText('transactions.technicalDetails'));
  openStatus(screen.getByRole('listitem'));
  await screen.findByText(
    'transactions.smartAuthorizations.nonceConsumedUnknown'
  );
  expect(
    screen.queryByRole('button', {
      name: 'buttons.cancel',
    })
  ).toBeNull();
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenLastCalledWith(
    ['wallet', 'getSmartAccountAuthorizationStatus'],
    [hash, { preserveRecords: true }]
  );
});

it('drops a delayed old-account page after the account changes', async () => {
  let release!: (value: unknown) => void;
  emit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const view = render(<ActivityRows />);
  await waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
  emit.mockResolvedValueOnce({ entries: [], nextCursor: null });
  mockScope = 'two';
  view.rerender(<ActivityRows />);
  await act(async () => release({ entries: [entry], nextCursor: null }));
  expect(screen.queryByText(hash)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the exact continuation cursor available after a failed page', async () => {
  emit
    .mockResolvedValueOnce({ entries: [entry], nextCursor: hash })
    .mockRejectedValueOnce(Error('offline'))
    .mockResolvedValueOnce({
      entries: [{ ...entry, operationHash: '0x' + '44'.repeat(32) }],
      nextCursor: null,
    });
  render(<ActivityRows />);
  await screen.findByText(hash);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await screen.findByText('0x' + '44'.repeat(32));
  const pages = emit.mock.calls.filter(
    ([[, method]]) => method === 'getSmartAccountAuthorizations'
  );
  expect(pages[1][1]).toEqual([{ maximum: 20, beforeHash: hash }]);
  expect(pages[2][1]).toEqual(pages[1][1]);
});

it('hydrates an orphan group on load more and reconciles its original and linked attempts', async () => {
  emit
    .mockResolvedValueOnce({
      entries: [cancellation, otherCancellation],
      nextCursor: otherCancellation.operationHash,
    })
    .mockResolvedValueOnce({ entries: [entry], nextCursor: null });
  render(<ActivityRows />);
  await screen.findByText(
    'transactions.smartAuthorizations.cancellationSigned'
  );
  const row = screen.getByRole('listitem');
  expect(within(row).getByText(hash)).toBeTruthy();
  expect(
    within(row).queryByRole('button', { name: cancelInstruction })
  ).toBeNull();
  const details = row.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(within(details).getByText(cancellation.operationHash)).toBeTruthy();
  expect(
    within(details).getByText(otherCancellation.operationHash)
  ).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'buttons.loadMore' }));
  await within(row).findByRole('button', { name: cancelInstruction });
  expect(screen.getAllByRole('listitem')).toEqual([row]);
  expect(details.open).toBe(false);

  emit.mockImplementation(async (_, [operationHash]) =>
    observation(
      operationHash,
      operationHash === cancellation.operationHash
        ? 'observed'
        : 'nonce-consumed'
    )
  );
  openStatus(row);
  await within(row).findByText(
    'transactions.smartAuthorizations.cancellationConfirmed'
  );
  expect(
    within(row).queryByRole('button', { name: cancelInstruction })
  ).toBeNull();
  expect(emit.mock.calls.slice(2)).toEqual(
    [hash, cancellation.operationHash, otherCancellation.operationHash].map(
      (operationHash) => [
        ['wallet', 'getSmartAccountAuthorizationStatus'],
        [operationHash, { preserveRecords: true }],
      ]
    )
  );
});

it.each([
  ['two winner events', observation(cancellation.operationHash, 'observed')],
  ['an inconsistent nonce', observation(cancellation.operationHash, 'pending')],
  ['an unavailable observation', null],
])(
  'keeps grouped local records and shows an unknown outcome for %s',
  async (_, second) => {
    emit.mockResolvedValueOnce({
      entries: [cancellation, entry],
      nextCursor: null,
    });
    emit.mockResolvedValueOnce(observation(hash, 'observed'));
    if (second) emit.mockResolvedValueOnce(second);
    else emit.mockRejectedValueOnce(Error('offline'));
    render(<ActivityRows />);
    openStatus(await screen.findByRole('listitem'));
    const row = screen.getByRole('listitem');
    await within(row).findByText(
      'transactions.smartAuthorizations.outcomeUnknown'
    );
    expect(within(row).getByText(hash)).toBeTruthy();
    expect(row.querySelector('details')?.textContent).toContain(
      cancellation.operationHash
    );
  }
);

it('limits status reads while retaining all local attempts', async () => {
  const attempts = Array.from({ length: 10 }, (_, index) =>
    replacement(String(index).padStart(2, '0'))
  );
  emit.mockResolvedValueOnce({
    entries: [...attempts, entry],
    nextCursor: null,
  });
  emit.mockImplementation(async (_, [operationHash]) =>
    observation(operationHash, 'nonce-consumed')
  );
  render(<ActivityRows />);
  openStatus(await screen.findByRole('listitem'));
  await screen.findByText('transactions.smartAuthorizations.outcomeUnknown');
  expect(emit).toHaveBeenCalledTimes(9);
  expect(screen.getByText(attempts.at(-1)!.operationHash)).toBeTruthy();
});

it('merges the newly signed cancellation without losing the original already in the list', async () => {
  emit
    .mockResolvedValueOnce({ entries: [entry], nextCursor: null })
    .mockResolvedValueOnce({ entries: [cancellation], nextCursor: hash });
  mockRequest.mockReturnValueOnce(true);
  render(<ActivityRows />);
  fireEvent.click(
    await screen.findByRole('button', { name: cancelInstruction })
  );
  const row = screen.getByRole('listitem');
  await within(row).findByText(
    'transactions.smartAuthorizations.cancellationSigned'
  );
  expect(
    within(row).getByRole('button', { name: cancelInstruction })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'buttons.loadMore' })).toBeNull();
});

it('reads only local pages in Activity and preserves the continuation across a disjoint first-page refresh', async () => {
  const newEntry = { ...entry, operationHash: '0x' + '66'.repeat(32) };
  const newCursor = '0x' + '77'.repeat(32);
  emit
    .mockResolvedValueOnce({ entries: [entry], nextCursor: null })
    .mockResolvedValueOnce({ entries: [newEntry], nextCursor: newCursor })
    .mockResolvedValueOnce({ entries: [entry], nextCursor: null });
  const { result } = renderHook(() => useSmartAccountAuthorizations(true));
  await waitFor(() => expect(result.current.groups).toHaveLength(1));
  act(() => {
    window.dispatchEvent(new Event('pali-smart-account-authorization-signed'));
  });
  await waitFor(() => expect(result.current.groups).toHaveLength(2));
  expect(result.current.cursor).toBe(newCursor);
  await act(() => result.current.load('more'));
  expect(result.current.groups).toHaveLength(2);
  expect(result.current.cursor).toBeNull();
  expect(emit.mock.calls).toEqual([
    [['wallet', 'getSmartAccountAuthorizations'], [{ maximum: 20 }]],
    [['wallet', 'getSmartAccountAuthorizations'], [{ maximum: 20 }]],
    [
      ['wallet', 'getSmartAccountAuthorizations'],
      [{ maximum: 20, beforeHash: newCursor }],
    ],
  ]);
});
