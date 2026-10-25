/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import en from 'assets/locales/en.json';
import { PRIVACY_POOLS } from 'utils/privacy/registry';

import PrivateWithdrawal from './PrivateWithdrawal';

const mockEmitter = jest.fn(),
  mockBack = jest.fn();
let mockState: any,
  mockStatus: any,
  visible = true;
const NOTE_ID = '00000000-0000-4000-8000-000000000001',
  INTENT_ID = '00000000-0000-4000-8000-000000000002';
const ADDRESS = '0x' + '11'.repeat(20),
  RECIPIENT = '0x' + '22'.repeat(20),
  RELAYER_ID = '0x' + '33'.repeat(32),
  HASH = '0x' + 'ab'.repeat(32);
const note = {
  id: NOTE_ID,
  poolId: 'eth-1' as const,
  amount: '1',
  createdAt: 1,
  phase: 'verified' as const,
};
const mockTranslate = (key: string, values: any = {}) =>
  String(
    key.split('.').reduce((value: any, part) => value?.[part], en) || key
  ).replace(/{{(\w+)}}/g, (_, name) => String(values[name]));
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
function review(mode: 'direct' | 'relayed' = 'direct') {
  return {
    intentId: INTENT_ID,
    noteId: NOTE_ID,
    poolId: 'eth-1',
    amount: '1',
    poolAddress: PRIVACY_POOLS[1].address,
    chainId: 1,
    account: { id: 0, type: 'HDAccount', address: ADDRESS },
    expiresAt: Date.now() + 60000,
    mode,
    recipient: RECIPIENT,
    gasLimit: '650000',
    maxNetworkFeeWei: '65000000000000000',
    feeWei: mode === 'direct' ? '0' : '75000000000000000',
    receiveWei:
      mode === 'direct' ? '1000000000000000000' : '925000000000000000',
    serviceFeeWei: mode === 'direct' ? '0' : '10000000000000000',
    ...(mode === 'relayed'
      ? {
          relayerId: RELAYER_ID,
          relayerName: 'example.eth',
          relayerEndpoint: 'https://relay.example',
        }
      : {}),
  };
}
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
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
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { address: ADDRESS, xpub: 'public' },
          1: { address: RECIPIENT, xpub: 'other' },
        },
      },
      activeNetwork: { kind: 'ethereum', chainId: 1, url: 'https://rpc.test' },
      isBitcoinBased: false,
    },
    vaultGlobal: { activeSlip44: 60, lastLogin: 1 },
  };
  mockEmitter
    .mockReset()
    .mockImplementation(async ([, method], [input] = []) => {
      if (method === 'prepareWithdrawal') return review(input.mode);
      if (method === 'submitWithdrawal')
        return {
          intentId: INTENT_ID,
          noteId: NOTE_ID,
          phase: 'submitted',
          transactionHash: HASH,
        };
      if (method === 'getRelayers')
        return [
          {
            id: RELAYER_ID,
            name: 'example.eth',
            feePercent: '1',
            health: 'reported-healthy',
            supportedPools: ['eth-1'],
          },
        ];
      return undefined;
    });
});
afterEach(() => jest.useRealTimers());
const mount = () => render(<PrivateWithdrawal note={note} onBack={mockBack} />);
async function prepare() {
  fireEvent.change(screen.getByLabelText(en.privacy.withdrawal.recipient), {
    target: { value: RECIPIENT },
  });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.continue })
  );
  await screen.findByRole('heading', { name: en.privacy.withdrawal.review });
}

it('starts direct with an empty recipient and no controller or directory call', () => {
  mount();
  expect(screen.getByLabelText(en.privacy.withdrawal.recipient)).toHaveValue(
    ''
  );
  expect(screen.getByLabelText(en.privacy.withdrawal.direct)).toBeChecked();
  expect(screen.getByText(en.privacy.withdrawal.directWarning)).toBeVisible();
  expect(
    screen.getByRole('button', { name: en.privacy.withdrawal.continue })
  ).toBeDisabled();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('reviews the exact recipient, gas payer and receive amount, then submits once explicitly', async () => {
  mount();
  await prepare();
  expect(screen.getByText(RECIPIENT)).toBeVisible();
  expect(screen.getByText(ADDRESS)).toBeVisible();
  expect(screen.getByText('0.065 ETH')).toBeVisible();
  expect(screen.getAllByText('1 ETH')).toHaveLength(2);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyWithdrawals', 'prepareWithdrawal'],
    [{ noteId: NOTE_ID, recipient: RECIPIENT, mode: 'direct' }],
    120000,
    false
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.confirm })
  );
  expect(await screen.findByText(HASH)).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'submitWithdrawal')
  ).toHaveLength(1);
  expect(
    mockEmitter.mock.calls.some(([path]) => path[1] === 'getRelayers')
  ).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.deposit.done })
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('loads relayers only after selection, filters pool support and waits for an explicit choice', async () => {
  mount();
  fireEvent.click(screen.getByLabelText(en.privacy.withdrawal.relayed));
  const select = await screen.findByRole('combobox', {
    name: en.privacy.withdrawal.relayer,
  });
  expect(select).toHaveValue('');
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyWithdrawals', 'getRelayers'],
    [],
    20000,
    false
  );
  fireEvent.change(select, { target: { value: RELAYER_ID } });
  await prepare();
  expect(screen.getByText(/https:\/\/relay\.example/)).toBeVisible();
  expect(screen.getByText('0.01 ETH')).toBeVisible();
  expect(screen.getByText('0.075 ETH')).toBeVisible();
  expect(screen.getByText('0.925 ETH')).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privacyWithdrawals', 'prepareWithdrawal'],
    [
      {
        noteId: NOTE_ID,
        recipient: RECIPIENT,
        mode: 'relayed',
        relayerId: RELAYER_ID,
      },
    ],
    120000,
    false
  );
});

it('calls a relay job accepted without claiming it is mined', async () => {
  mockEmitter.mockImplementation(async ([, method], [input] = []) => {
    if (method === 'getRelayers')
      return [
        {
          id: RELAYER_ID,
          name: 'example.eth',
          health: 'reported-healthy',
          supportedPools: ['eth-1'],
        },
      ];
    if (method === 'prepareWithdrawal') return review(input.mode);
    if (method === 'submitWithdrawal')
      return {
        intentId: INTENT_ID,
        noteId: NOTE_ID,
        phase: 'submitted',
        jobId: INTENT_ID,
      };
    return undefined;
  });
  mount();
  fireEvent.click(screen.getByLabelText(en.privacy.withdrawal.relayed));
  fireEvent.change(
    await screen.findByRole('combobox', {
      name: en.privacy.withdrawal.relayer,
    }),
    { target: { value: RELAYER_ID } }
  );
  await prepare();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.confirm })
  );
  expect(
    await screen.findByRole('heading', { name: en.privacy.withdrawal.accepted })
  ).toBeVisible();
  expect(screen.getByText(en.privacy.withdrawal.acceptedHelp)).toBeVisible();
  expect(screen.getByText(INTENT_ID)).toBeVisible();
});

it('expires the review without sending and requires explicit re-preparation', async () => {
  jest.useFakeTimers();
  mount();
  await prepare();
  await act(async () => jest.advanceTimersByTime(60001));
  expect(screen.getByText(en.privacy.withdrawal.expired)).toBeVisible();
  expect(
    mockEmitter.mock.calls.some(([path]) => path[1] === 'submitWithdrawal')
  ).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.refresh })
  );
  await act(async () => undefined);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'prepareWithdrawal')
  ).toHaveLength(2);
});

it.each(['cancel', 'hidden', 'account', 'lock', 'unmount'])(
  'cancels preparation and ignores a delayed result after %s',
  async (change) => {
    const pending = deferred();
    mockEmitter.mockImplementation(async ([, method]) =>
      method === 'prepareWithdrawal' ? pending.promise : undefined
    );
    const view = mount();
    fireEvent.change(screen.getByLabelText(en.privacy.withdrawal.recipient), {
      target: { value: RECIPIENT },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.privacy.withdrawal.continue })
    );
    expect(screen.getByText(en.privacy.withdrawal.proving)).toBeVisible();
    if (change === 'cancel') {
      fireEvent.click(screen.getByRole('button', { name: en.buttons.cancel }));
      view.unmount();
    }
    if (change === 'hidden') {
      visible = false;
      fireEvent(document, new Event('visibilitychange'));
    }
    if (change === 'account') {
      mockState.vault.activeAccount.id = 1;
      view.rerender(<PrivateWithdrawal note={note} onBack={mockBack} />);
    }
    if (change === 'lock') {
      mockStatus.isUnlocked = false;
      view.rerender(<PrivateWithdrawal note={note} onBack={mockBack} />);
    }
    if (change === 'unmount') view.unmount();
    await act(async () => pending.resolve(review()));
    expect(
      screen.queryByRole('heading', { name: en.privacy.withdrawal.review })
    ).not.toBeInTheDocument();
    expect(
      mockEmitter.mock.calls.filter(([path]) => path[1] === 'cancelPreparation')
    ).toHaveLength(1);
    expect(
      mockEmitter.mock.calls.some(([path]) => path[1] === 'discardWithdrawal')
    ).toBe(true);
  }
);

it('treats an ambiguous send failure as unknown without a retry action', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, ...rest) =>
    path[1] === 'submitWithdrawal'
      ? Promise.reject(new Error('secret provider detail'))
      : original(path, ...rest)
  );
  mount();
  await prepare();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.confirm })
  );
  expect(
    await screen.findByRole('heading', { name: en.privacy.withdrawal.unknown })
  ).toBeVisible();
  expect(screen.getByText(en.privacy.withdrawal.unknownHelp)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: en.privacy.withdrawal.refresh })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('secret provider detail')).not.toBeInTheDocument();
});

it('requires refreshing after a proven unbroadcast failure', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, ...rest) =>
    path[1] === 'submitWithdrawal'
      ? Promise.reject(
          Object.assign(new Error('blocked'), { transactionNotBroadcast: true })
        )
      : original(path, ...rest)
  );
  mount();
  await prepare();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.confirm })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.withdrawal.notBroadcast
  );
  expect(
    screen.getByRole('button', { name: en.privacy.withdrawal.refresh })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'submitWithdrawal')
  ).toHaveLength(1);
});

it('rejects a malformed public review instead of showing secret fields or a submit action', async () => {
  mockEmitter.mockResolvedValue({
    ...review(),
    feeWei: '1',
    proof: 'secret-proof',
    note: 'secret-note',
  });
  mount();
  fireEvent.change(screen.getByLabelText(en.privacy.withdrawal.recipient), {
    target: { value: RECIPIENT },
  });
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.continue })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.withdrawal.prepareFailed
  );
  expect(screen.queryByText('secret-proof')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: en.privacy.withdrawal.confirm })
  ).not.toBeInTheDocument();
});

it('rejects malformed relay directory data without rendering extra fields', async () => {
  mockEmitter.mockResolvedValue([
    {
      id: 'bad-id',
      name: 'secret-data',
      health: 'reported-healthy',
      supportedPools: ['eth-1'],
    },
  ]);
  mount();
  fireEvent.click(screen.getByLabelText(en.privacy.withdrawal.relayed));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    en.privacy.withdrawal.directoryFailed
  );
  expect(screen.queryByText('secret-data')).not.toBeInTheDocument();
});

it('prevents duplicate confirmation and drops a late submission after the account changes', async () => {
  const pending = deferred(),
    original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, ...rest) =>
    path[1] === 'submitWithdrawal' ? pending.promise : original(path, ...rest)
  );
  const view = mount();
  await prepare();
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.confirm })
  );
  fireEvent.click(
    screen.getByRole('button', { name: en.privacy.withdrawal.submitting })
  );
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'submitWithdrawal')
  ).toHaveLength(1);
  mockState.vault.activeAccount.id = 1;
  view.rerender(<PrivateWithdrawal note={note} onBack={mockBack} />);
  await act(async () =>
    pending.resolve({
      intentId: INTENT_ID,
      noteId: NOTE_ID,
      phase: 'submitted',
      transactionHash: HASH,
    })
  );
  expect(screen.queryByText(HASH)).not.toBeInTheDocument();
  expect(screen.getByLabelText(en.privacy.withdrawal.recipient)).toHaveValue(
    ''
  );
});
