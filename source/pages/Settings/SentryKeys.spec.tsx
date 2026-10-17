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
      key.startsWith('sentry.')
        ? key
            .split('.')
            .reduce((value: any, part: string) => value?.[part], mockEnglish) ||
          key
        : key,
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
const settings = {
  network: 'testnet',
  serviceUrl: 'https://nodes.test',
  maxFeeSatoshis: '100000',
  keys: [],
};
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'syscoin',
        chainId: 5700,
        label: 'Syscoin Testnet',
      },
    },
    vaultGlobal: { activeSlip44: 1 },
  };
  mockEmitter.mockResolvedValue(settings);
});
it('requires explicit backup acknowledgement and local reauthentication for a key import', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Key label'), {
    target: { value: 'Local operator' },
  });
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '11'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  expect(
    screen
      .getByRole('button', { name: 'buttons.import' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importSentryKey'],
      [
        {
          role: 'operator',
          scheme: 'bls-basic',
          label: 'Local operator',
          secretKey: '11'.repeat(32),
          password: 'synthetic-password',
        },
      ],
      180000,
      false
    )
  );
  await screen.findByText('Operator key imported securely.');
  expect(screen.queryByDisplayValue('synthetic-password')).toBeNull();
  expect(screen.queryByDisplayValue('11'.repeat(32))).toBeNull();
});
it('does not leak or reuse secret draft when wallet account/network scope changes', async () => {
  const view = render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '22'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-secret' },
  });
  mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
  view.rerender(<SentryKeys />);
  await screen.findByRole('button', { name: 'Import Sentry key' });
  expect(screen.queryByDisplayValue('synthetic-secret')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Import Sentry key' }));
  expect(
    (screen.getByLabelText('Sentry private key (hex)') as HTMLInputElement)
      .value
  ).toBe('');
});
it('clears secret drafts when replacing a wallet with the same account id and network', async () => {
  mockState.vault.accounts = { HDAccount: { 0: { xpub: 'first-vault' } } };
  const view = render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '22'.repeat(32) },
  });
  mockState.vault.accounts.HDAccount[0].xpub = 'second-vault';
  view.rerender(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  expect(
    (screen.getByLabelText('Sentry private key (hex)') as HTMLInputElement)
      .value
  ).toBe('');
});

it('keeps removal local and shows that registration/collateral are not removed', async () => {
  mockEmitter.mockResolvedValue({
    ...settings,
    keys: [
      {
        id: 'key-1',
        label: 'Node one',
        scheme: 'bls-basic',
        publicKey: 'aa'.repeat(48),
      },
    ],
  });
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Remove local key' })
  );
  expect(
    screen.getByText(
      /does not revoke the operator on-chain or release collateral/
    )
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.remove' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'removeSentryKey'],
      [{ id: 'key-1', password: 'synthetic-password' }],
      30000,
      false
    )
  );
});
it('never loads Sentry settings on an EVM chain sharing the testnet chain id', async () => {
  mockState.vault.activeNetwork.kind = 'ethereum';
  render(<SentryKeys />);
  await act(async () => undefined);
  expect(screen.getByText(/Switch to Syscoin/)).toBeTruthy();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('retires a pending old-account import without disabling the new account form', async () => {
  let finishOld!: () => void;
  const delayed = new Promise<void>((resolve) => {
    finishOld = resolve;
  });
  mockEmitter.mockImplementation((methods) =>
    methods[1] === 'importSentryKey' ? delayed : Promise.resolve(settings)
  );
  const view = render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Key label'), {
    target: { value: 'Old node' },
  });
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '11'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'old-password' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  expect(
    screen
      .getByRole('button', { name: 'buttons.import' })
      .hasAttribute('disabled')
  ).toBe(true);
  mockState.vault.activeAccount = { id: 2, type: 'HDAccount' };
  view.rerender(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  expect(
    (screen.getByLabelText('Wallet password') as HTMLInputElement).disabled
  ).toBe(false);
  await act(async () => finishOld());
  expect(screen.queryByText('Operator key imported securely.')).toBeNull();
  expect(
    (screen.getByLabelText('Wallet password') as HTMLInputElement).value
  ).toBe('');
});

it('keeps owner and operator key schemes distinct', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Key role'), {
    target: { value: 'owner' },
  });
  expect((screen.getByLabelText('Key type') as HTMLSelectElement).value).toBe(
    'secp256k1'
  );
  expect(
    screen.queryByRole('option', { name: 'Legacy BLS (basic)' })
  ).toBeNull();
  fireEvent.change(screen.getByLabelText('Key role'), {
    target: { value: 'operator' },
  });
  expect((screen.getByLabelText('Key type') as HTMLSelectElement).value).toBe(
    'bls-basic'
  );
});

it('requires explicit stop-node acknowledgement and password before releasing only selected collateral', async () => {
  const reservation = {
    txid: 'ab'.repeat(32),
    vout: 1,
    proTxHash: 'cd'.repeat(32),
  };
  mockEmitter.mockResolvedValue({ ...settings, collateral: [reservation] });
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Unlock collateral' })
  );
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  expect(
    screen
      .getByRole('button', { name: 'Unlock collateral' })
      .hasAttribute('disabled')
  ).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Unlock collateral' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'releaseSentryCollateral'],
      [
        {
          reservation,
          password: 'synthetic-password',
          acknowledgeNodeStops: true,
        },
      ],
      30000,
      false
    )
  );
});
