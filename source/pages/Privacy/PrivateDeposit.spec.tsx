/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';
import { PRIVACY_POOLS } from 'utils/privacy/registry';

import PrivateDeposit from './PrivateDeposit';

const mockEmitter = jest.fn();
const mockBack = jest.fn();
const mockBackup = jest.fn();
let mockState: any;
let mockStatus: any;
let visible = true;
const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const INTENT_ID = '00000000-0000-4000-8000-000000000002';
const HASH = '0x' + 'ab'.repeat(32);
const mockTranslate = (key: string, data: any = {}) =>
  String(
    key.split('.').reduce((value: any, part) => value?.[part], en) || key
  ).replace(/{{(\w+)}}/g, (_, name) => String(data[name]));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockStatus }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('components/Button', () => ({
  Button: ({ children, loading, fullWidth, variant, ...props }: any) => (
    <button
      {...props}
      aria-busy={loading || undefined}
      data-full-width={fullWidth}
      data-variant={variant}
    >
      {children}
    </button>
  ),
}));
function review(poolId = 'eth-0.1', intentId = INTENT_ID) {
  const pool = PRIVACY_POOLS.find(({ id }) => id === poolId)!;
  const value =
    poolId === 'eth-0.1'
      ? BigInt('100000000000000000')
      : BigInt(pool.amount) * BigInt('1000000000000000000');
  return {
    intentId,
    noteId: NOTE_ID,
    poolId,
    amount: pool.amount,
    chainId: 1,
    poolAddress: pool.address,
    account: { id: 0, type: 'HDAccount', address: '0x' + '11'.repeat(20) },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
    valueWei: String(value),
    gasLimit: '100000',
    nonce: '7',
    feeMode: 'eip1559',
    maxFeePerGas: '30000000000',
    maxPriorityFeePerGas: '1000000000',
    maxNetworkFeeWei: '3000000000000000',
    maxTotalWei: String(value + BigInt('3000000000000000')),
  };
}
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeAll(() =>
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
);
afterAll(() => {
  delete (document as any).visibilityState;
});
beforeEach(() => {
  visible = true;
  mockBack.mockReset();
  mockBackup.mockReset();
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: { 0: { address: '0x' + '11'.repeat(20), xpub: 'public' } },
      },
      activeNetwork: { kind: 'ethereum', chainId: 1, url: 'https://rpc.test' },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60, lastLogin: 1 },
  };
  mockEmitter.mockReset().mockImplementation(async ([, method], [input]) => {
    if (method === 'prepareDeposit') return review(input.poolId);
    if (method === 'submitDeposit')
      return {
        intentId: input,
        noteId: NOTE_ID,
        phase: 'submitted',
        transactionHash: HASH,
      };
    return undefined;
  });
});
afterEach(() => jest.useRealTimers());
const mount = () =>
  render(<PrivateDeposit onBack={mockBack} onBackup={mockBackup} />);
async function prepare() {
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.continue })
  );
  await screen.findByLabelText(en.privacy.deposit.backupAck);
}

it('shows four fixed amounts, captured review values and a mandatory backup warning', async () => {
  mount();
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual(
    ['0.1 ETH', '1 ETH', '10 ETH', '100 ETH']
  );
  expect(mockEmitter).not.toHaveBeenCalled();
  await prepare();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyTransactions', 'prepareDeposit'],
    [{ poolId: 'eth-0.1' }],
    90000,
    false
  );
  expect(screen.getByText('0x' + '11'.repeat(20))).toBeVisible();
  expect(screen.getByText('0.003 ETH')).toBeVisible();
  expect(screen.getByText('0.103 ETH')).toBeVisible();
  expect(screen.getByText(en.privacy.deposit.backupWarning)).toBeVisible();
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.backup })
  );
  expect(mockBackup).toHaveBeenCalledWith(NOTE_ID);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.includes('revealNote'))
  ).toHaveLength(0);
});

it('requires acknowledgement and performs one explicit submit before showing pending verification', async () => {
  mount();
  await prepare();
  fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  );
  expect(
    await screen.findByRole('heading', { name: en.privacy.deposit.submitted })
  ).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyTransactions', 'submitDeposit'],
    [INTENT_ID],
    120000,
    false
  );
  expect(screen.getByText(HASH)).toBeVisible();
  expect(screen.getByText(en.privacy.deposit.submittedHelp)).toBeVisible();
  expect(
    screen.queryByText(en.privacy.notePhase.verified)
  ).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.includes('submitDeposit'))
  ).toHaveLength(1);
});

it('expires without automatic requests and refreshes the same durable note only on click', async () => {
  jest.useFakeTimers({ now: 1700000000000 });
  mount();
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.deposit.continue })
    );
  });
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(screen.getByText(en.privacy.deposit.expired)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: en.privacy.deposit.confirm })
  ).not.toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.deposit.refresh })
    );
  });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyTransactions', 'prepareDeposit'],
    [{ poolId: 'eth-0.1', noteId: NOTE_ID }],
    90000,
    false
  );
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  ).toBeDisabled();
});

it('blocks duplicate confirm while a submit is pending', async () => {
  const pending = deferred();
  mockEmitter.mockImplementation(async ([, method], [input]) =>
    method === 'prepareDeposit' ? review(input.poolId) : pending.promise
  );
  mount();
  await prepare();
  fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
  const confirm = screen.getByRole('button', {
    name: en.privacy.deposit.confirm,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.submitting })
  ).toBeDisabled();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.includes('submitDeposit'))
  ).toHaveLength(1);
  await act(async () =>
    pending.resolve({
      intentId: INTENT_ID,
      noteId: NOTE_ID,
      phase: 'submitted',
      transactionHash: HASH,
    })
  );
});

it.each(['response', 'transport'])(
  'shows an unknown %s without offering resubmission',
  async (kind) => {
    mockEmitter.mockImplementation(async ([, method], [input]) => {
      if (method === 'prepareDeposit') return review(input.poolId);
      if (kind === 'transport') throw new Error('private internal error');
      return { intentId: INTENT_ID, noteId: NOTE_ID, phase: 'unknown' };
    });
    mount();
    await prepare();
    fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.deposit.confirm })
    );
    expect(
      await screen.findByRole('heading', { name: en.privacy.deposit.unknown })
    ).toBeVisible();
    expect(screen.getByText(en.privacy.deposit.unknownHelp)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: en.privacy.deposit.refresh })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: en.privacy.deposit.confirm })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('private internal error')
    ).not.toBeInTheDocument();
  }
);

it('requires an explicit new review after a proven not-broadcast response', async () => {
  mockEmitter.mockImplementation(async ([, method], [input]) => {
    if (method === 'prepareDeposit') return review(input.poolId);
    throw Object.assign(new Error('not sent'), {
      transactionNotBroadcast: true,
    });
  });
  mount();
  await prepare();
  fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.deposit.notBroadcast
  );
  expect(
    screen.getByRole('button', { name: en.privacy.deposit.refresh })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.includes('prepareDeposit'))
  ).toHaveLength(1);
});

it.each(['hidden', 'lock', 'account', 'unmount'])(
  'discards a late preparation after %s',
  async (change) => {
    const pending = deferred();
    mockEmitter.mockImplementation(async ([, method]) =>
      method === 'prepareDeposit' ? pending.promise : undefined
    );
    const view = mount();
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.deposit.continue })
    );
    if (change === 'hidden') {
      visible = false;
      fireEvent(document, new Event('visibilitychange'));
    } else if (change === 'unmount') view.unmount();
    else {
      if (change === 'lock') mockStatus.isUnlocked = false;
      else mockState.vault.activeAccount.id = 1;
      view.rerender(<PrivateDeposit onBack={mockBack} onBackup={mockBackup} />);
    }
    await act(async () => pending.resolve(review()));
    expect(
      screen.queryByLabelText(en.privacy.deposit.backupAck)
    ).not.toBeInTheDocument();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['privacyTransactions', 'discardDeposit'],
      [INTENT_ID],
      10000,
      false
    );
  }
);

it('does not revive a late submit after an account change', async () => {
  const pending = deferred();
  mockEmitter.mockImplementation(async ([, method], [input]) =>
    method === 'prepareDeposit' ? review(input.poolId) : pending.promise
  );
  const view = mount();
  await prepare();
  fireEvent.click(screen.getByLabelText(en.privacy.deposit.backupAck));
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.confirm })
  );
  mockState.vault.activeAccount.id = 1;
  view.rerender(<PrivateDeposit onBack={mockBack} onBackup={mockBackup} />);
  await act(async () =>
    pending.resolve({
      intentId: INTENT_ID,
      noteId: NOTE_ID,
      phase: 'submitted',
      transactionHash: HASH,
    })
  );
  expect(screen.queryByText(HASH)).not.toBeInTheDocument();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path.includes('submitDeposit'))
  ).toHaveLength(1);
});

it('rejects unsupported accounts before contacting the controller', () => {
  mockState.vault.activeAccount.type = 'Ledger';
  mount();
  expect(screen.getByText(en.privacy.deposit.unavailable)).toBeVisible();
  expect(mockEmitter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
  expect(mockBack).toHaveBeenCalled();
});

it('renders only a safe generic preparation error for malformed review data', async () => {
  mockEmitter.mockResolvedValue({
    ...review(),
    maxTotalWei: '1',
    rawNote: 'secret',
  });
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.continue })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.deposit.prepareFailed
  );
  expect(screen.queryByText('secret')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText(en.privacy.deposit.backupAck)
  ).not.toBeInTheDocument();
});

it('returns through onBack and discards an unsubmitted review', async () => {
  mount();
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyTransactions', 'discardDeposit'],
    [INTENT_ID],
    10000,
    false
  );
});

it('refuses an imported account with no private key before controller contact', () => {
  mockState.vault.activeAccount = { type: 'Imported', id: 0 };
  mockState.vault.accounts.Imported = {
    0: {
      address: '0x' + '11'.repeat(20),
      xpub: '0x' + '11'.repeat(20),
      xprv: '',
    },
  };
  mount();
  expect(screen.getByText(en.privacy.deposit.unavailable)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: en.privacy.deposit.continue })
  ).not.toBeInTheDocument();
  expect(mockEmitter).not.toHaveBeenCalled();
});
it('preserves imported software signer preparation', async () => {
  mockState.vault.activeAccount = { type: 'Imported', id: 0 };
  mockState.vault.accounts.Imported = {
    0: {
      address: '0x' + '11'.repeat(20),
      xpub: 'public',
      xprv: 'synthetic-private-key',
    },
  };
  mount();
  await prepare();
  expect(
    screen.getByLabelText(en.privacy.deposit.backupAck)
  ).toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyTransactions', 'prepareDeposit'],
    [{ poolId: 'eth-0.1' }],
    90000,
    false
  );
});
