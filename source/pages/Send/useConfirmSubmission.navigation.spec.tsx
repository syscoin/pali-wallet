/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React, { useEffect } from 'react';
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { useConfirmSubmission } from './useConfirmSubmission';

const SCOPE = {
  account: 'public-account-scope',
  network: 'public-network-scope',
};
const mockClear = jest.fn();
const mockSend = jest.fn();
let mockPreparation: Promise<void> | undefined;
let mockRetryWithinAction = false;
jest.mock('react-redux', () => ({ useSelector: (select: any) => select() }));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('utils/navigationState', () => {
  const actual = jest.requireActual('utils/navigationState');
  return {
    clearTransactionNavigationState: (...args: any[]) => mockClear(...args),
    getTransactionReturnContext: actual.getTransactionReturnContext,
    getWalletNavigationScope: () => SCOPE,
  };
});

const Draft = () => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() =>
        navigate('/send/confirm', {
          state: {
            submissionStarted: false,
            walletScope: SCOPE,
            tx: {
              psbt: 'synthetic-unsigned-psbt',
              receivingAddress: 'synthetic-recipient',
              amount: '1',
            },
          },
        })
      }
    >
      Review draft
    </button>
  );
};
const Confirmation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const submission = useConfirmSubmission({
    location,
    navigate,
    controllerEmitter: mockSend,
    isUnlocked: true,
  });
  useEffect(() => {
    if (!submission.hasUsableEntry && submission.ownsRoute())
      navigate('/home', { replace: true });
  }, [submission.hasUsableEntry, submission.ownsRoute, navigate]);
  return (
    <>
      <output data-testid="route-state">
        {JSON.stringify(location.state)}
      </output>
      {submission.state?.tx && (
        <button
          disabled={submission.blocked}
          onClick={() => {
            void submission
              .run(async () => {
                if (mockPreparation) await mockPreparation;
                try {
                  await submission.controllerEmitter([
                    'wallet',
                    'signSendAndSaveTransaction',
                  ]);
                } catch (error) {
                  if (!mockRetryWithinAction) throw error;
                  await submission.controllerEmitter([
                    'wallet',
                    'signSendAndSaveTransaction',
                  ]);
                }
              })
              .catch(() => undefined);
          }}
        >
          Confirm once
        </button>
      )}
      {submission.unknown && <p role="status">Unknown outcome</p>}
    </>
  );
};
const mount = () =>
  render(
    <BrowserRouter>
      <Routes>
        <Route path="/send/sys" element={<Draft />} />
        <Route path="/send/confirm" element={<Confirmation />} />
        <Route path="/home" element={<p>Wallet home</p>} />
      </Routes>
    </BrowserRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/send/sys');
  mockClear.mockResolvedValue(undefined);
  mockPreparation = undefined;
  mockRetryWithinAction = false;
});

it('native Back/Forward after an ambiguous submission cannot reconstruct its transaction payload', async () => {
  mockSend.mockRejectedValue(
    new Error('Synthetic response lost after broadcast')
  );
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(screen.getByText('Unknown outcome')).toBeTruthy());
  expect(window.history.state.usr).toEqual({
    submissionStarted: true,
    walletScope: SCOPE,
  });
  expect(JSON.stringify(window.history.state)).not.toContain(
    'synthetic-unsigned-psbt'
  );
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByText('Review draft')).toBeTruthy());
  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByText('Wallet home')).toBeTruthy());
  expect(screen.queryByText('Confirm once')).toBeNull();
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it('an early failure after native Back does not reopen confirmation or restore its payload', async () => {
  let rejectSend!: (error: Error) => void;
  mockSend.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectSend = reject;
      })
  );
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(rejectSend).toBeDefined());
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByText('Review draft')).toBeTruthy());
  await act(async () =>
    rejectSend(
      Object.assign(new Error('Synthetic validation failure'), {
        transactionNotBroadcast: true,
      })
    )
  );
  expect(screen.getByText('Review draft')).toBeTruthy();
  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByText('Wallet home')).toBeTruthy());
  expect(mockSend).toHaveBeenCalledTimes(1);
});

it('leaving while storage cleanup is pending prevents the first submission RPC', async () => {
  let finishDiscard!: () => void;
  mockClear.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishDiscard = resolve;
      })
  );
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByText('Review draft')).toBeTruthy());
  await act(async () => finishDiscard());
  expect(mockSend).not.toHaveBeenCalled();
  expect(screen.getByText('Review draft')).toBeTruthy();
});

it('a failed mandatory storage discard restores the active idle entry and permits a fresh attempt', async () => {
  mockClear.mockRejectedValueOnce(new Error('Synthetic storage failure'));
  mockSend.mockResolvedValue({ txid: 'synthetic-txid' });
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  expect(mockClear).toHaveBeenCalledWith({
    requireDiscard: true,
    assertCurrent: expect.any(Function),
  });
  await waitFor(() =>
    expect(screen.getByText('Confirm once').hasAttribute('disabled')).toBe(
      false
    )
  );
  expect(mockSend).not.toHaveBeenCalled();
  expect(window.history.state.usr.tx.psbt).toBe('synthetic-unsigned-psbt');
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
});

it('a storage discard failure after native departure cannot restore its old confirmation', async () => {
  let rejectDiscard!: (error: Error) => void;
  mockClear.mockImplementation(
    () =>
      new Promise<void>((_, reject) => {
        rejectDiscard = reject;
      })
  );
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  act(() => window.history.back());
  await waitFor(() => expect(screen.getByText('Review draft')).toBeTruthy());
  await act(async () => rejectDiscard(new Error('Synthetic storage failure')));
  expect(mockSend).not.toHaveBeenCalled();
  expect(screen.getByText('Review draft')).toBeTruthy();
  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByText('Wallet home')).toBeTruthy());
});

it('a proven pre-broadcast failure restores only the active unsigned entry and permits retry', async () => {
  mockSend
    .mockRejectedValueOnce(
      Object.assign(new Error('Synthetic validation failure'), {
        transactionNotBroadcast: true,
      })
    )
    .mockResolvedValueOnce({ txid: 'synthetic-txid' });
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() =>
    expect(screen.getByText('Confirm once').hasAttribute('disabled')).toBe(
      false
    )
  );
  expect(window.history.state.usr.tx.psbt).toBe('synthetic-unsigned-psbt');
  expect(screen.queryByText('Unknown outcome')).toBeNull();
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
});

it('a memory-router safe failure accepts only its own restored unsigned state and permits retry', async () => {
  window.history.replaceState(null, '', '/');
  mockSend
    .mockRejectedValueOnce(
      Object.assign(new Error('Synthetic validation failure'), {
        transactionNotBroadcast: true,
      })
    )
    .mockResolvedValueOnce({ txid: 'synthetic-txid' });
  render(
    <MemoryRouter initialEntries={['/send/sys']}>
      <Routes>
        <Route path="/send/sys" element={<Draft />} />
        <Route path="/send/confirm" element={<Confirmation />} />
        <Route path="/home" element={<p>Wallet home</p>} />
      </Routes>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() =>
    expect(screen.getByText('Confirm once').hasAttribute('disabled')).toBe(
      false
    )
  );
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
});

it('a successful SDK retry clears the earlier pre-broadcast failure marker and keeps confirmation consumed', async () => {
  mockRetryWithinAction = true;
  mockSend
    .mockRejectedValueOnce(
      Object.assign(new Error('Synthetic validation failure'), {
        transactionNotBroadcast: true,
      })
    )
    .mockResolvedValueOnce({ txid: 'synthetic-txid' });
  mount();
  fireEvent.click(screen.getByText('Review draft'));
  fireEvent.click(screen.getByText('Confirm once'));
  await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
  expect(window.history.state.usr).toEqual({
    submissionStarted: true,
    walletScope: SCOPE,
  });
  expect(screen.getByText('Confirm once').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Confirm once'));
  expect(mockSend).toHaveBeenCalledTimes(2);
});

it.each(['key', 'hash'])(
  'native %s departure before React commits prevents a prepared broadcast',
  async (change) => {
    let finishPreparation!: () => void;
    mockPreparation = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    mount();
    fireEvent.click(screen.getByText('Review draft'));
    fireEvent.click(screen.getByText('Confirm once'));
    await act(async () => {
      await Promise.resolve();
    });
    if (change === 'key')
      window.history.replaceState(
        { key: 'foreign-native-entry' },
        '',
        '/send/sys'
      );
    else
      window.history.replaceState(
        window.history.state,
        '',
        '/app.html#/send/sys'
      );
    await act(async () => finishPreparation());
    expect(mockSend).not.toHaveBeenCalled();
  }
);
