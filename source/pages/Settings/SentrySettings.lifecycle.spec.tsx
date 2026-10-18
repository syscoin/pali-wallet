/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import mockEnglish from 'assets/locales/en.json';

import SentryKeys from './SentryKeys';

const mockEmitter = jest.fn();
let mockState: any;
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split('.').reduce((value: any, part) => value?.[part], mockEnglish) ||
      key,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children, error }: any) => (
    <div>
      {error && <p role="alert">{error}</p>}
      {children}
    </div>
  ),
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
const SETTINGS = {
  network: 'testnet',
  serviceUrl: 'https://nodes.invalid',
  maxFeeSatoshis: '100000',
  keys: [
    {
      id: 'synthetic-key',
      label: 'Existing operator',
      role: 'operator',
      scheme: 'bls-basic',
      publicKey: 'aa'.repeat(48),
    },
  ],
  collateral: [{ txid: 'bb'.repeat(32), vout: 1 }],
};
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: { HDAccount: { 0: { xpub: 'synthetic-public-root' } } },
      activeNetwork: {
        kind: 'syscoin',
        chainId: 5700,
        label: 'Syscoin Testnet',
      },
    },
    vaultGlobal: { activeSlip44: 1 },
  };
  mockEmitter.mockReset().mockResolvedValue(SETTINGS);
});

it('does not describe unread Sentry keys and collateral as empty after an initial settings failure', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic local settings read failed')
  );
  render(<SentryKeys />);
  await screen.findByRole('alert');
  expect(
    screen.queryByText(mockEnglish.sentry.noSentryKeysImportedOnThisNetwork)
  ).toBeNull();
  expect(
    screen.queryByText(mockEnglish.sentry.noLinkedCollateralInThisWallet)
  ).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('can explicitly retry a failed settings read and recover the actual existing registry without leaving the page', async () => {
  const retry = deferred();
  mockEmitter
    .mockRejectedValueOnce(new Error('Synthetic local settings read failed'))
    .mockReturnValueOnce(retry.promise);
  render(<SentryKeys />);
  await screen.findByRole('alert');
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.receive.retry })
  );
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
  expect(
    mockEmitter.mock.calls.every(
      ([methods]) =>
        methods[0] === 'wallet' && methods[1] === 'getSentrySettings'
    )
  ).toBe(true);
  await act(async () => retry.resolve(SETTINGS));
  await screen.findByText('Existing operator');
  expect(screen.getByText(`${'bb'.repeat(32)}:1`)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows genuine empty keys and collateral only after a successful empty settings read', async () => {
  mockEmitter.mockResolvedValue({ ...SETTINGS, keys: [], collateral: [] });
  render(<SentryKeys />);
  await screen.findByText(mockEnglish.sentry.noSentryKeysImportedOnThisNetwork);
  expect(
    screen.getByText(mockEnglish.sentry.noLinkedCollateralInThisWallet)
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('settles a failed explicit Retry without a read loop and permits a later recovery', async () => {
  mockEmitter
    .mockRejectedValueOnce(new Error('First read unavailable'))
    .mockRejectedValueOnce(new Error('Retry read unavailable'))
    .mockResolvedValueOnce(SETTINGS);
  render(<SentryKeys />);
  await screen.findByText('First read unavailable');
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.receive.retry })
  );
  await screen.findByText('Retry read unavailable');
  await act(async () => Promise.resolve());
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByText(mockEnglish.sentry.noSentryKeysImportedOnThisNetwork)
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.receive.retry })
  );
  await screen.findByText('Existing operator');
  expect(mockEmitter).toHaveBeenCalledTimes(3);
});

it.each(['resolve', 'reject'])(
  'retires a pending Retry %s when the actual wallet settings scope changes',
  async (outcome) => {
    const retry = deferred();
    const replacement = {
      ...SETTINGS,
      keys: [{ ...SETTINGS.keys[0], label: 'Replacement wallet operator' }],
    };
    mockEmitter
      .mockRejectedValueOnce(new Error('Read unavailable'))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce(replacement);
    const view = render(<SentryKeys />);
    await screen.findByRole('alert');
    fireEvent.click(
      screen.getByRole('button', {
        name: mockEnglish.receive.retry,
      })
    );
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole('button', {
        name: mockEnglish.receive.retry,
      })
    ).toBeNull();
    expect(
      screen.queryByText(mockEnglish.sentry.noLinkedCollateralInThisWallet)
    ).toBeNull();
    mockState.vault.accounts.HDAccount[0].xpub = 'replacement-public-root';
    view.rerender(<SentryKeys />);
    await screen.findByText('Replacement wallet operator');
    await act(async () => {
      if (outcome === 'resolve') retry.resolve(SETTINGS);
      else retry.reject(new Error('Retired settings read failure'));
    });
    expect(screen.getByText('Replacement wallet operator')).toBeTruthy();
    expect(screen.queryByText('Existing operator')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockEmitter).toHaveBeenCalledTimes(3);
  }
);

it('discards explicitly cancelled trusted-service URL and fee edits instead of reopening an unsaved policy', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: mockEnglish.sentry.trustedDataService,
    })
  );
  fireEvent.change(
    screen.getByLabelText(mockEnglish.sentry.trustedHTTPSServiceOrigin),
    { target: { value: 'https://discarded.invalid' } }
  );
  fireEvent.change(
    screen.getByLabelText(mockEnglish.sentry.maximumTransactionFeeSatoshis),
    { target: { value: '250000' } }
  );
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.buttons.cancel })
  );
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.sentry.trustedDataService })
  );
  expect(
    (
      screen.getByLabelText(
        mockEnglish.sentry.trustedHTTPSServiceOrigin
      ) as HTMLInputElement
    ).value
  ).toBe(SETTINGS.serviceUrl);
  expect(
    (
      screen.getByLabelText(
        mockEnglish.sentry.maximumTransactionFeeSatoshis
      ) as HTMLInputElement
    ).value
  ).toBe(SETTINGS.maxFeeSatoshis);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('saves an explicitly submitted trusted-service draft through the ordinary controller contract', async () => {
  let saved = { ...SETTINGS };
  mockEmitter.mockImplementation(async (methods, params) => {
    if (methods[1] === 'saveSentrySettings') {
      saved = {
        ...SETTINGS,
        serviceUrl: params[0].serviceUrl,
        maxFeeSatoshis: params[0].maxFeeSatoshis,
      };
    }
    return saved;
  });
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: mockEnglish.sentry.trustedDataService,
    })
  );
  fireEvent.change(
    screen.getByLabelText(mockEnglish.sentry.trustedHTTPSServiceOrigin),
    { target: { value: 'https://saved.invalid' } }
  );
  fireEvent.change(
    screen.getByLabelText(mockEnglish.sentry.maximumTransactionFeeSatoshis),
    { target: { value: '250000' } }
  );
  fireEvent.change(screen.getByLabelText(mockEnglish.sentry.walletPassword), {
    target: { value: 'Synthetic-only-password' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.buttons.save })
  );
  await screen.findByText(mockEnglish.sentry.trustedServiceSettingsSaved);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'saveSentrySettings'],
    [
      {
        serviceUrl: 'https://saved.invalid',
        maxFeeSatoshis: '250000',
        password: 'Synthetic-only-password',
      },
    ],
    30000,
    false
  );
  fireEvent.click(
    screen.getByRole('button', { name: mockEnglish.sentry.trustedDataService })
  );
  expect(
    (
      screen.getByLabelText(
        mockEnglish.sentry.trustedHTTPSServiceOrigin
      ) as HTMLInputElement
    ).value
  ).toBe('https://saved.invalid');
  expect(
    (
      screen.getByLabelText(
        mockEnglish.sentry.maximumTransactionFeeSatoshis
      ) as HTMLInputElement
    ).value
  ).toBe('250000');
});
