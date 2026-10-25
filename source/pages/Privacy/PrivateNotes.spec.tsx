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
import userEvent from '@testing-library/user-event';
import React from 'react';

import en from '../../assets/locales/en.json';
import { PRIVACY_POOLS } from '../../utils/privacy/registry';

import Privacy from './Privacy';
import PrivateNotes from './PrivateNotes';
import { readPrivateNote } from './usePrivateNotes';

const mockEmitter = jest.fn();
const mockCopy = jest.fn();
let mockState: any;
let mockStatus: any;
const mockTranslate = (key: string, values: any = {}) => {
  const value = key
    .split('.')
    .reduce((current: any, part) => current?.[part], en);
  return String(value || key).replace(/{{(\w+)}}/g, (_, name) =>
    String(values[name])
  );
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockStatus }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('./usePrivacyIndex', () => ({
  usePrivacyIndex: () => ({ status: { phase: 'idle' }, run: jest.fn() }),
}));
jest.mock('components/Button', () => ({
  Button: jest
    .requireActual('react')
    .forwardRef(
      ({ children, fullWidth, loading, variant, ...props }: any, ref: any) => (
        <button
          {...props}
          ref={ref}
          data-full-width={fullWidth}
          data-variant={variant}
          aria-busy={loading || undefined}
        >
          {children}
        </button>
      )
    ),
}));

const note = {
  id: 'test-note-id',
  poolId: 'eth-0.1',
  amount: '0.1',
  createdAt: 1234,
  phase: 'verified',
  blockNumber: 22000000,
};
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let visibility = 'visible';
const originalMatchMedia = window.matchMedia;
const originalMessageChannel = globalThis.MessageChannel;
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  delete (document as any).visibilityState;
  delete (navigator as any).clipboard;
});
beforeEach(() => {
  visibility = 'visible';
  mockState = {
    vault: {
      activeNetwork: { chainId: 1, kind: 'ethereum', url: 'https://rpc.test' },
      isBitcoinBased: false,
      activeAccount: { type: 'Imported', id: 0 },
      accounts: {
        Imported: {
          0: { address: 'account-a', xpub: 'public-a' },
          1: { address: 'account-b', xpub: 'public-b' },
        },
      },
    },
    vaultGlobal: { lastLogin: 1, activeSlip44: 60 },
  };
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockCopy.mockReset();
  mockEmitter.mockReset().mockImplementation(async ([, method]) => {
    if (method === 'getNotes') return { notes: [note] };
    if (method === 'importNote') return note;
    if (method === 'revealNote') return 'synthetic-private-note';
    throw new Error('Unexpected call');
  });
});
afterEach(() => jest.useRealTimers());

async function openImport() {
  fireEvent.click(
    await screen.findByRole('button', { name: en.privacy.importNote })
  );
  return screen.getByRole('textbox', { name: en.privacy.noteLabel });
}
async function beginReveal() {
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Reveal 0.1 ETH note for backup',
    })
  );
  return screen.getByLabelText(en.privacy.revealPassword);
}

const depositNoteId = '00000000-0000-4000-8000-000000000001';
const depositIntentId = '00000000-0000-4000-8000-000000000002';
const depositHash = '0x' + 'ab'.repeat(32);
function depositReview() {
  return {
    intentId: depositIntentId,
    noteId: depositNoteId,
    poolId: 'eth-0.1',
    amount: '0.1',
    poolAddress: PRIVACY_POOLS[0].address,
    chainId: 1,
    account: { id: 0, type: 'Imported', address: '0x' + '11'.repeat(20) },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
    valueWei: '100000000000000000',
    gasLimit: '100000',
    nonce: '7',
    feeMode: 'legacy',
    gasPrice: '30000000000',
    maxNetworkFeeWei: '3000000000000000',
    maxTotalWei: '103000000000000000',
  };
}

it('keeps the deposit review mounted during password backup, then refreshes notes after submit', async () => {
  let submitted = false;
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getNotes')
      return {
        notes: submitted
          ? [{ ...note, id: depositNoteId, phase: 'waiting' }]
          : [],
      };
    if (method === 'prepareDeposit') return depositReview();
    if (method === 'revealNote') return 'synthetic-deposit-backup';
    if (method === 'submitDeposit') {
      submitted = true;
      return {
        intentId: depositIntentId,
        noteId: depositNoteId,
        phase: 'submitted',
        transactionHash: depositHash,
      };
    }
    if (method === 'discardDeposit') return undefined;
    throw new Error('Unexpected call');
  });
  render(<PrivateNotes />);
  await screen.findByText(en.privacy.noNotes);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.title })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.continue })
  );
  await screen.findByLabelText(en.privacy.deposit.backupAck);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.backup })
  );
  expect(
    screen.getByRole('dialog', { name: en.privacy.revealNote })
  ).toBeVisible();
  expect(
    screen.getByRole('heading', {
      name: en.privacy.deposit.review,
      hidden: true,
    })
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(en.privacy.revealPassword), {
    target: { value: 'correct-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  expect(
    await screen.findByDisplayValue('synthetic-deposit-backup')
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: en.privacy.hideNote }));
  expect(
    screen.queryByDisplayValue('synthetic-deposit-backup')
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: en.privacy.deposit.review })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'prepareDeposit')
  ).toHaveLength(1);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'discardDeposit')
  ).toHaveLength(0);
  fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  );
  await screen.findByRole('heading', { name: en.privacy.deposit.submitted });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.done })
  );
  expect(await screen.findByText(en.privacy.notePhase.waiting)).toBeVisible();
  expect(screen.getByText('Verified balance: 0 ETH')).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'getNotes')
  ).toHaveLength(2);
  expect(mockCopy).not.toHaveBeenCalled();
});

it('refreshes saved prepared notes on cancel without sending a transaction', async () => {
  let prepared = false;
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getNotes')
      return {
        notes: prepared
          ? [
              {
                ...note,
                id: depositNoteId,
                phase: 'prepared',
                blockNumber: undefined,
              },
            ]
          : [],
      };
    if (method === 'prepareDeposit') {
      prepared = true;
      return depositReview();
    }
    if (method === 'discardDeposit') return undefined;
    throw new Error('Unexpected call');
  });
  render(<PrivateNotes />);
  await screen.findByText(en.privacy.noNotes);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.title })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.continue })
  );
  await screen.findByLabelText(en.privacy.deposit.backupAck);
  fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
  expect(await screen.findByText(en.privacy.notePhase.prepared)).toBeVisible();
  expect(screen.getByText('Verified balance: 0 ETH')).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'submitDeposit')
  ).toHaveLength(0);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'discardDeposit')
  ).toHaveLength(1);
});

it('offers a clear network requirement from the deposit entry and preserves local notes', async () => {
  mockState.vault.activeNetwork.chainId = 57;
  render(<PrivateNotes />);
  await screen.findByText(en.privacy.notePhase.verified);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.title })
  );
  expect(screen.getByText(en.privacy.deposit.unavailable)).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[0] === 'privacyTransactions')
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
});

it('opens withdrawal only from a verified note with an empty recipient and refreshes on return', async () => {
  render(<PrivateNotes />);
  fireEvent.click(
    await screen.findByRole('button', { name: en.privacy.withdrawal.open })
  );
  expect(screen.getByLabelText(en.privacy.withdrawal.recipient)).toHaveValue(
    ''
  );
  expect(screen.getByText(en.privacy.withdrawal.directWarning)).toBeVisible();
  expect(
    mockEmitter.mock.calls.some(([path]) => path[0] === 'privacyWithdrawals')
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'getNotes')
  ).toHaveLength(2);
});

it('keeps a reserved withdrawal out of balance and checks a saved relay job only on request', async () => {
  const saved = {
    ...note,
    withdrawal: {
      mode: 'relayed',
      phase: 'submitted',
      jobId: depositIntentId,
      endpoint: 'must-not-display',
      proof: 'must-not-display',
    },
  };
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getNotes') return { notes: [saved] };
    if (method === 'statusByNote')
      return {
        noteId: note.id,
        phase: 'submitted',
        claimedStatus: 'CONFIRMED',
        proof: 'must-not-display',
      };
    throw new Error('Unexpected call');
  });
  render(<PrivateNotes />);
  expect(
    await screen.findByText(en.privacy.withdrawal.statusPending)
  ).toBeVisible();
  expect(screen.getByText('Verified balance: 0 ETH')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: en.privacy.withdrawal.open })
  ).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.some(([path]) => path[1] === 'statusByNote')
  ).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.checkStatus })
  );
  expect(
    await screen.findByText(
      en.privacy.withdrawal.reportedStatus.replace('{{status}}', 'CONFIRMED')
    )
  ).toBeVisible();
  expect(screen.queryByText('must-not-display')).not.toBeInTheDocument();
  expect(
    screen.queryByText(en.privacy.notePhase.spent)
  ).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'statusByNote')
  ).toEqual([
    [['privacyWithdrawals', 'statusByNote'], [note.id], 30000, false],
  ]);
});

it('projects only public withdrawal metadata and validates its hash and job ID', () => {
  const value = {
    ...note,
    withdrawal: {
      mode: 'relayed',
      phase: 'submitted',
      jobId: depositIntentId,
      transactionHash: depositHash,
      endpoint: 'secret-endpoint',
      nullifierHash: 'secret-nullifier',
    },
  };
  expect(readPrivateNote(value)).toEqual({
    ...note,
    phase: 'waiting',
    withdrawal: {
      mode: 'relayed',
      phase: 'submitted',
      jobId: depositIntentId,
      transactionHash: depositHash,
    },
  });
  expect(() =>
    readPrivateNote({
      ...value,
      withdrawal: { ...value.withdrawal, transactionHash: 'bad' },
    })
  ).toThrow();
  expect(() =>
    readPrivateNote({
      ...value,
      withdrawal: { ...value.withdrawal, jobId: '../bad' },
    })
  ).toThrow();
});

it('lists safe metadata with as-of status, independent of the active account', async () => {
  const view = render(<PrivateNotes />);
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
  expect(screen.getByText('As of block 22000000')).toBeVisible();
  expect(screen.getByText(en.privacy.notesLocal)).toBeVisible();
  expect(mockEmitter.mock.calls).toEqual([
    [['privateVault', 'getNotes'], [], 10000, false],
  ]);
  expect(mockCopy).not.toHaveBeenCalled();
  mockState.vault.activeAccount.id = 1;
  view.rerender(<PrivateNotes />);
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
  expect(mockEmitter.mock.calls[1]).toEqual([
    ['privateVault', 'getNotes'],
    [],
    10000,
    false,
  ]);
});

it('integrates the notes section while preserving the public-pool availability notice', async () => {
  render(<Privacy />);
  expect(
    screen.getByRole('heading', { name: en.privacy.prepare })
  ).toBeVisible();
  expect(screen.getByText(en.privacy.scopeNotice)).toBeVisible();
  expect(
    screen.getByRole('heading', { name: en.privacy.yourNotes })
  ).toBeVisible();
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
});

it.each(['prepared', 'spent', 'waiting', 'not-found'] as const)(
  'uses careful %s wording',
  async (phase) => {
    mockEmitter.mockResolvedValue({ notes: [{ ...note, phase }] });
    render(<PrivateNotes />);
    expect(await screen.findByText(en.privacy.notePhase[phase])).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /withdraw/i })
    ).not.toBeInTheDocument();
  }
);

it('keeps prepared notes unfunded and outside verified deposit rows', async () => {
  mockEmitter.mockResolvedValue({
    notes: [{ ...note, phase: 'prepared', blockNumber: undefined }],
  });
  render(<PrivateNotes />);
  expect(await screen.findByText(en.privacy.notePhase.prepared)).toBeVisible();
  expect(screen.getByText('0.1 ETH')).toBeVisible();
  expect(screen.queryAllByText(en.privacy.notePhase.verified)).toHaveLength(0);
  expect(screen.getByText('Verified balance: 0 ETH')).toBeVisible();
  expect(screen.queryByText('As of block 22000000')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /withdraw/i })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.title })
  ).toBeVisible();
  expect(mockEmitter.mock.calls).toEqual([
    [['privateVault', 'getNotes'], [], 10000, false],
  ]);
});

it('adds no prepared denomination to the verified deposit rows', async () => {
  mockEmitter.mockResolvedValue({
    notes: [
      note,
      {
        ...note,
        id: 'prepared-note',
        poolId: 'eth-1',
        amount: '1',
        phase: 'prepared',
        blockNumber: undefined,
      },
    ],
  });
  render(<PrivateNotes />);
  await screen.findByText(en.privacy.notePhase.prepared);
  const verifiedRows = screen
    .getAllByRole('listitem')
    .filter((row) => within(row).queryByText(en.privacy.notePhase.verified));
  expect(verifiedRows).toHaveLength(1);
  expect(within(verifiedRows[0]).getByText('0.1 ETH')).toBeVisible();
  expect(within(verifiedRows[0]).queryByText('1 ETH')).not.toBeInTheDocument();
  expect(screen.getByText('Verified balance: 0.1 ETH')).toBeVisible();
});

it('shows an exact verified balance and flags notes whose verification is pending', async () => {
  const verified = [0, 1, 2].map((index) => ({
    ...note,
    id: `verified-${index}`,
  }));
  const excluded = ['prepared', 'spent', 'waiting', 'not-found'].map(
    (phase) => ({ ...note, id: phase, phase, poolId: 'eth-100', amount: '100' })
  );
  mockEmitter.mockResolvedValue({ notes: [...verified, ...excluded] });
  render(<PrivateNotes />);
  expect(await screen.findByText('Verified balance: 0.3 ETH')).toBeVisible();
  expect(screen.getByText(en.privacy.balancePending)).toBeVisible();
  expect(mockEmitter.mock.calls).toEqual([
    [['privateVault', 'getNotes'], [], 10000, false],
  ]);
});

it.each(['waiting', 'not-found'])(
  'qualifies a zero verified balance for %s notes',
  async (phase) => {
    mockEmitter.mockResolvedValue({ notes: [{ ...note, phase }] });
    render(<PrivateNotes />);
    expect(await screen.findByText('Verified balance: 0 ETH')).toBeVisible();
    expect(screen.getByText(en.privacy.balancePending)).toBeVisible();
  }
);

it('does not present a zero balance before the initial local read finishes or fails', async () => {
  const request = deferred();
  mockEmitter.mockReturnValue(request.promise);
  render(<PrivateNotes />);
  expect(screen.queryByText('Verified balance: 0 ETH')).not.toBeInTheDocument();
  await act(async () => request.resolve({ notes: null }));
  expect(screen.getByText(en.privacy.notesUnavailable)).toBeVisible();
  expect(screen.queryByText('Verified balance: 0 ETH')).not.toBeInTheDocument();
});

it('reveals an unfunded prepared note for backup only after password confirmation', async () => {
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getNotes')
      return {
        notes: [{ ...note, phase: 'prepared', blockNumber: undefined }],
      };
    if (method === 'revealNote') return 'synthetic-prepared-note';
    throw new Error('Unexpected call');
  });
  render(<PrivateNotes />);
  expect(await screen.findByText(en.privacy.notePhase.prepared)).toBeVisible();
  fireEvent.change(await beginReveal(), {
    target: { value: 'correct-password' },
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  expect(
    await screen.findByRole('textbox', { name: en.privacy.privateNote })
  ).toHaveValue('synthetic-prepared-note');
  expect(screen.queryAllByText(en.privacy.notePhase.verified)).toHaveLength(0);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'revealNote'],
    [note.id, 'correct-password'],
    30000,
    false
  );
  expect(mockCopy).not.toHaveBeenCalled();
});

it('imports on explicit submit, clears the text, and never copies a note', async () => {
  mockEmitter.mockImplementation(async ([, method]) =>
    method === 'getNotes' ? { notes: [] } : note
  );
  render(<PrivateNotes />);
  const input = await openImport();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'typed-private-note' } });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: en.privacy.importNote }));
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'importNote'],
    ['typed-private-note'],
    30000,
    false
  );
  expect(
    screen.queryByDisplayValue('typed-private-note')
  ).not.toBeInTheDocument();
  expect(mockCopy).not.toHaveBeenCalled();
});

it.each([
  ['privacy_note_invalid', 'noteInvalid'],
  ['privacy_note_not_found', 'noteNotFound'],
  ['privacy_verification_pending', 'notePending'],
  ['privacy_note_duplicate', 'noteDuplicate'],
  ['privacy_note_limit', 'noteLimit'],
  ['unexpected secret-bearing error', 'noteImportFailed'],
])('shows a safe import error for %s', async (code, key) => {
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'getNotes') return { notes: [] };
    throw new Error(code);
  });
  render(<PrivateNotes />);
  fireEvent.change(await openImport(), {
    target: { value: 'typed-private-note' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.privacy.importNote }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    (en.privacy as any)[key]
  );
  expect(screen.queryByText(code)).not.toBeInTheDocument();
});

it('reveals only after explicit password confirmation and hides the backup', async () => {
  render(<PrivateNotes />);
  const password = await beginReveal();
  fireEvent.change(password, { target: { value: 'correct-password' } });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  expect(
    await screen.findByRole('textbox', { name: en.privacy.privateNote })
  ).toHaveValue('synthetic-private-note');
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'revealNote'],
    [note.id, 'correct-password'],
    30000,
    false
  );
  expect(
    screen.queryByDisplayValue('correct-password')
  ).not.toBeInTheDocument();
  expect(mockCopy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: en.privacy.hideNote }));
  expect(
    screen.queryByDisplayValue('synthetic-private-note')
  ).not.toBeInTheDocument();
  expect(await beginReveal()).toHaveValue('');
});

it('keeps delayed reveal results hidden after Hide and a new reveal form', async () => {
  const request = deferred();
  mockEmitter.mockImplementation(async ([, method]) =>
    method === 'getNotes' ? { notes: [note] } : request.promise
  );
  render(<PrivateNotes />);
  fireEvent.change(await beginReveal(), {
    target: { value: 'correct-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  fireEvent.click(screen.getByRole('button', { name: en.privacy.hideNote }));
  expect(await beginReveal()).toHaveValue('');
  await act(async () => request.resolve('late-private-note'));
  expect(
    screen.queryByDisplayValue('late-private-note')
  ).not.toBeInTheDocument();
});

it('sanitizes reveal errors before the shared password input logs them', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    mockEmitter.mockImplementation(async ([, method]) => {
      if (method === 'getNotes') return { notes: [note] };
      throw new Error(
        'controller accidentally included private-note and password'
      );
    });
    render(<PrivateNotes />);
    const password = await beginReveal();
    await userEvent.type(password, 'private-password');
    await userEvent.click(
      screen.getByRole('button', { name: en.buttons.confirm })
    );
    expect(
      await screen.findAllByText(en.privacy.noteRevealFailed)
    ).toHaveLength(1);
    await waitFor(() => {
      expect(password).toHaveAttribute('aria-invalid', 'true');
      const ids = password.getAttribute('aria-describedby')?.split(/\s+/) || [];
      expect(
        ids.map((id) => document.getElementById(id)?.textContent).join(' ')
      ).toContain(en.privacy.noteRevealFailed);
      expect(screen.getAllByText(en.privacy.noteRevealFailed)).toHaveLength(1);
    });
    const logged = log.mock.calls
      .map((args) => args.map(String).join(' '))
      .join(' ');
    expect(logged).toContain('privacy_note_reveal_failed');
    expect(logged).not.toContain('private-note');
    expect(logged).not.toContain('private-password');
  } finally {
    log.mockRestore();
  }
});

it.each(['account', 'profile', 'lock', 'hidden'])(
  'clears a displayed backup after %s changes',
  async (change) => {
    const view = render(<PrivateNotes />);
    fireEvent.change(await beginReveal(), {
      target: { value: 'correct-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
    expect(
      await screen.findByDisplayValue('synthetic-private-note')
    ).toBeVisible();
    if (change === 'account') mockState.vault.activeAccount.id = 1;
    if (change === 'profile') mockState.vaultGlobal.lastLogin = 2;
    if (change === 'lock') mockStatus.isUnlocked = false;
    if (change === 'hidden') {
      visibility = 'hidden';
      fireEvent(document, new Event('visibilitychange'));
    }
    view.rerender(<PrivateNotes />);
    expect(
      screen.queryByDisplayValue('synthetic-private-note')
    ).not.toBeInTheDocument();
    if (change === 'account' || change === 'profile') {
      expect(
        await screen.findByText(en.privacy.notePhase.verified)
      ).toBeVisible();
    }
  }
);

it('discards a reveal made stale by a password edit', async () => {
  const request = deferred();
  mockEmitter.mockImplementation(async ([, method]) =>
    method === 'getNotes' ? { notes: [note] } : request.promise
  );
  render(<PrivateNotes />);
  const password = await beginReveal();
  fireEvent.change(password, { target: { value: 'old-password' } });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  fireEvent.change(password, { target: { value: 'new-password' } });
  await act(async () => request.resolve('late-private-note'));
  expect(
    screen.queryByDisplayValue('late-private-note')
  ).not.toBeInTheDocument();
  expect(password).toHaveValue('new-password');
});

it.each(['hidden', 'pagehide', 'lock', 'account', 'profile', 'unmount'])(
  'clears secrets and ignores delayed import after %s',
  async (change) => {
    const request = deferred();
    mockEmitter.mockImplementation(async ([, method]) =>
      method === 'getNotes' ? { notes: [] } : request.promise
    );
    const view = render(<PrivateNotes />);
    fireEvent.change(await openImport(), {
      target: { value: 'typed-private-note' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.importNote })
    );
    if (change === 'hidden') {
      visibility = 'hidden';
      fireEvent(document, new Event('visibilitychange'));
    } else if (change === 'pagehide') {
      fireEvent(window, new Event('pagehide'));
    } else if (change === 'unmount') {
      view.unmount();
    } else {
      if (change === 'lock') mockStatus.isUnlocked = false;
      if (change === 'account') mockState.vault.activeAccount.id = 1;
      if (change === 'profile') mockState.vaultGlobal.lastLogin = 2;
      view.rerender(<PrivateNotes />);
    }
    await act(async () => request.resolve(note));
    expect(
      screen.queryByDisplayValue('typed-private-note')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(en.privacy.notePhase.verified)
    ).not.toBeInTheDocument();
    if (change === 'unmount') return;
    visibility = 'visible';
    mockStatus.isUnlocked = true;
    fireEvent(document, new Event('visibilitychange'));
    view.rerender(<PrivateNotes />);
    expect(await openImport()).toHaveValue('');
  }
);

it('drops a delayed reveal after the page is hidden, then requires reauthentication', async () => {
  const request = deferred();
  mockEmitter.mockImplementation(async ([, method]) =>
    method === 'getNotes' ? { notes: [note] } : request.promise
  );
  render(<PrivateNotes />);
  fireEvent.change(await beginReveal(), {
    target: { value: 'correct-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => request.resolve('late-private-note'));
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  expect(await beginReveal()).toHaveValue('');
  expect(
    screen.queryByDisplayValue('late-private-note')
  ).not.toBeInTheDocument();
});

it('supports keyboard cancellation and refreshes only safe metadata', async () => {
  const user = userEvent.setup();
  render(<PrivateNotes />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: en.privacy.refreshNotes })
    ).toBeEnabled()
  );
  await user.tab();
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.title })
  ).toHaveFocus();
  await user.tab();
  expect(
    screen.getByRole('button', { name: en.privacy.refreshNotes })
  ).toHaveFocus();
  fireEvent.change(await openImport(), {
    target: { value: 'typed-private-note' },
  });
  await user.keyboard('{Escape}');
  expect(
    screen.queryByDisplayValue('typed-private-note')
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.refreshNotes })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: en.privacy.refreshNotes })
    ).toBeEnabled()
  );
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'getNotes'],
    [],
    10000,
    false
  );
});

it('handles unavailable or malformed metadata without displaying controller fields', async () => {
  mockEmitter.mockResolvedValue({
    notes: [{ ...note, amount: '999', note: 'secret' }],
  });
  render(<PrivateNotes />);
  expect(await screen.findByText(en.privacy.notesUnavailable)).toBeVisible();
  expect(screen.queryByText('secret')).not.toBeInTheDocument();
  mockEmitter.mockResolvedValue({ notes: [note] });
  fireEvent.click(screen.getByRole('button', { name: en.privacy.retry }));
  expect(await screen.findByText(en.privacy.notePhase.verified)).toBeVisible();
});

it('projects only safe metadata fields and rejects invalid phases or blocks', () => {
  expect(
    readPrivateNote({ ...note, note: 'secret', password: 'secret' })
  ).toEqual(note);
  expect(() => readPrivateNote({ ...note, phase: 'spendable' })).toThrow();
  expect(() => readPrivateNote({ ...note, blockNumber: -1 })).toThrow();
  expect(() => readPrivateNote({ ...note, id: 'a'.repeat(129) })).toThrow();
  expect(
    readPrivateNote({ ...note, phase: 'prepared', blockNumber: undefined })
  ).toMatchObject({ phase: 'prepared', amount: '0.1' });
});

it('quietly polls saved-note status every 15 seconds without clearing displayed metadata', async () => {
  jest.useFakeTimers();
  render(<PrivateNotes />);
  await act(async () => undefined);
  expect(screen.getByText(en.privacy.notePhase.verified)).toBeVisible();
  const poll = deferred();
  mockEmitter.mockImplementationOnce(() => poll.promise);
  await act(async () => {
    jest.advanceTimersByTime(15000);
  });
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'getNotes'],
    [],
    10000,
    false
  );
  expect(screen.queryByText(en.privacy.checking)).not.toBeInTheDocument();
  expect(screen.getByText(en.privacy.notePhase.verified)).toBeVisible();
  await act(async () =>
    poll.resolve({
      notes: [{ ...note, phase: 'spent', blockNumber: 22000010 }],
    })
  );
  expect(screen.getByText(en.privacy.notePhase.spent)).toBeVisible();
  expect(screen.getByText('As of block 22000010')).toBeVisible();
  mockEmitter.mockResolvedValue({
    notes: [{ ...note, phase: 'waiting', blockNumber: undefined }],
  });
  await act(async () => {
    jest.advanceTimersByTime(15000);
  });
  expect(screen.getByText(en.privacy.notePhase.waiting)).toBeVisible();
});

it.each(['hidden', 'unmounted'])(
  'does not poll after the page is %s',
  async (mode) => {
    jest.useFakeTimers();
    const view = render(<PrivateNotes />);
    await act(async () => undefined);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    if (mode === 'hidden') {
      visibility = 'hidden';
      fireEvent(document, new Event('visibilitychange'));
    } else view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('does not poll an empty note vault', async () => {
  jest.useFakeTimers();
  mockEmitter.mockResolvedValue({ notes: [] });
  render(<PrivateNotes />);
  await act(async () => undefined);
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('ignores a poll older than a successful import and avoids overlapping polls', async () => {
  jest.useFakeTimers();
  render(<PrivateNotes />);
  await act(async () => undefined);
  const poll = deferred();
  mockEmitter.mockImplementationOnce(() => poll.promise);
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  const second = { ...note, id: 'second-note', poolId: 'eth-1', amount: '1' };
  mockEmitter.mockResolvedValueOnce(second);
  fireEvent.change(await openImport(), {
    target: { value: 'synthetic-second-note' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.privacy.importNote }));
  await act(async () => undefined);
  expect(screen.getByText('1 ETH')).toBeVisible();
  await act(async () => poll.resolve({ notes: [note] }));
  expect(screen.getByText('1 ETH')).toBeVisible();
  expect(screen.getAllByText(en.privacy.notePhase.verified)).toHaveLength(2);
});
