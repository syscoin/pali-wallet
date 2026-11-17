/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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
    request: () => mockRequest(reference, operationHash),
  }),
}));
import { controllerEmitter } from '../../scripts/Background/controllers/controllerEmitter';

import { SmartAccountAuthorizations } from './SmartAccountAuthorizations';

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
const emit = controllerEmitter as jest.Mock;
function open(container: HTMLElement) {
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}
beforeEach(() => {
  mockScope = 'one';
  emit.mockReset();
  mockRequest.mockReset();
});

it('loads local history only on opening and requests status only by explicit action', async () => {
  emit.mockImplementation(async ([, method]) =>
    method === 'getSmartAccountAuthorizations'
      ? { entries: [entry], nextCursor: null }
      : { operationHash: hash, kind: 'nonce-consumed' }
  );
  const view = render(<SmartAccountAuthorizations />);
  expect(emit).not.toHaveBeenCalled();
  open(view.container);
  await screen.findByText(hash);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'transactions.smartAuthorizations.cancelInstruction',
    })
  );
  expect(mockRequest).toHaveBeenCalledWith(hash, hash);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'transactions.smartAuthorizations.checkStatus',
    })
  );
  await screen.findByText(
    'transactions.smartAuthorizations.nonceConsumedUnknown'
  );
  expect(
    screen.queryByRole('button', {
      name: 'transactions.smartAuthorizations.cancelInstruction',
    })
  ).toBeNull();
  expect(emit).toHaveBeenCalledTimes(2);
});

it('drops a delayed old-account page after the account changes', async () => {
  let release!: (value: unknown) => void;
  emit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const view = render(<SmartAccountAuthorizations />);
  open(view.container);
  await waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
  mockScope = 'two';
  view.rerender(<SmartAccountAuthorizations />);
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
  const view = render(<SmartAccountAuthorizations />);
  open(view.container);
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
