/** @jest-environment jsdom */
import '@testing-library/jest-dom';
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

it('imports one reviewed batch with optional labels and one explicit backup acknowledgement', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Batch import' }));
  const text = `First node | ${'11'.repeat(32)}\nSecond node | ${'22'.repeat(
    32
  )}`;
  fireEvent.change(screen.getByLabelText('Sentry keys (one per line)'), {
    target: { value: text },
  });
  expect(screen.queryByLabelText('Sentry private key (hex)')).toBeNull();
  expect(screen.getByText('1. First node')).toBeInTheDocument();
  expect(screen.getByText('2. Second node')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  expect(screen.getByRole('button', { name: 'buttons.import' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importSentryKeys'],
      [
        {
          role: 'operator',
          scheme: 'bls-basic',
          password: 'synthetic-password',
          entries: [
            { label: 'First node', secretKey: '11'.repeat(32) },
            { label: 'Second node', secretKey: '22'.repeat(32) },
          ],
        },
      ],
      180000,
      false
    )
  );
  await waitFor(() => expect(screen.queryByDisplayValue(text)).toBeNull());
  expect(screen.queryByDisplayValue('synthetic-password')).toBeNull();
});

it('invalidates the whole-batch acknowledgement on edits and never submits invalid lines', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Batch import' }));
  const input = screen.getByLabelText('Sentry keys (one per line)');
  fireEvent.change(input, { target: { value: '11'.repeat(32) } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.change(input, {
    target: { value: `${'11'.repeat(32)}\nBad | invalid-secret` },
  });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('alert')).toHaveTextContent('enter a complete key');
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'buttons.import' })).toBeDisabled();
  expect(
    mockEmitter.mock.calls.some(([method]) => method[1] === 'importSentryKeys')
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Single key' }));
  expect(screen.queryByDisplayValue('invalid-secret')).toBeNull();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('keeps an uncommitted batch editable after a rejected key and requires fresh approval', async () => {
  let imports = 0;
  mockEmitter.mockImplementation((methods) => {
    if (methods[1] === 'importSentryKeys' && ++imports === 1)
      return Promise.reject(new Error('Key 2: invalid key'));
    return Promise.resolve(settings);
  });
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Batch import' }));
  const text = `First | ${'11'.repeat(32)}\nSecond | ${'00'.repeat(32)}`;
  const input = screen.getByLabelText('Sentry keys (one per line)');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Show private keys' }));
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await screen.findByText('Key 2: invalid key');
  expect(input).toHaveValue(text);
  expect(screen.getByLabelText('Wallet password')).toHaveValue('');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Show private keys' })
  ).toBeVisible();
  fireEvent.change(input, {
    target: { value: text.replace('00'.repeat(32), '22'.repeat(32)) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'pw' },
  });
  expect(screen.getByRole('button', { name: 'buttons.import' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await waitFor(() =>
    expect(screen.queryByLabelText('Sentry keys (one per line)')).toBeNull()
  );
  expect(imports).toBe(2);
});

it('clears a committed batch even when the following settings refresh fails', async () => {
  let loads = 0;
  mockEmitter.mockImplementation((methods) => {
    if (methods[1] === 'getSentrySettings' && ++loads > 1)
      return Promise.reject(new Error('Refresh failed'));
    return Promise.resolve(settings);
  });
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Batch import' }));
  fireEvent.change(screen.getByLabelText('Sentry keys (one per line)'), {
    target: { value: '11'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await screen.findByText(mockEnglish.sentry.unableToLoadSentrySettings);
  expect(screen.getByText(mockEnglish.sentry.batchImported)).toBeVisible();
  expect(screen.queryByLabelText('Sentry keys (one per line)')).toBeNull();
  expect(screen.queryByLabelText('Wallet password')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Import Sentry key' })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(
      ([method]) => method[1] === 'importSentryKeys'
    )
  ).toHaveLength(1);
});

it('invalidates single-key backup acknowledgement when its label changes', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Key label'), {
    target: { value: 'Changed label' },
  });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it.each(['same-row', 'cross-row'])(
  'hides private keys misplaced in %s preview labels until corrected',
  async (kind) => {
    render(<SentryKeys />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Import Sentry key' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Batch import' }));
    const first = '11'.repeat(32);
    const second = '22'.repeat(32);
    const input = screen.getByLabelText('Sentry keys (one per line)');
    fireEvent.change(input, {
      target: {
        value: `${
          kind === 'same-row' ? first : second
        } | ${first}\nBeta | ${second}`,
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('private keys');
    const preview = screen
      .queryAllByRole('listitem')
      .map((item) => item.textContent)
      .join(' ');
    expect(preview).not.toContain(first);
    expect(preview).not.toContain(second);
    expect(input.className).toContain('[-webkit-text-security:disc]');
    fireEvent.change(screen.getByLabelText('Wallet password'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      screen.getByRole('button', { name: 'buttons.import' })
    ).toBeDisabled();
    expect(
      mockEmitter.mock.calls.some(
        ([method]) => method[1] === 'importSentryKeys'
      )
    ).toBe(false);
    fireEvent.change(input, {
      target: { value: `Alpha | ${first}\nBeta | ${second}` },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(
      screen.getByRole('button', { name: 'buttons.import' })
    ).toBeEnabled();
  }
);
it('requires a fresh backup acknowledgement for each consecutive import', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Key label'), {
    target: { value: 'First operator' },
  });
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '11'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await screen.findByText('Operator key imported securely.');

  fireEvent.click(screen.getByRole('button', { name: 'Import Sentry key' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
  fireEvent.change(screen.getByLabelText('Key label'), {
    target: { value: 'Second operator' },
  });
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '22'.repeat(32) },
  });
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  expect(screen.getByRole('button', { name: 'buttons.import' })).toBeDisabled();
  expect(
    mockEmitter.mock.calls.filter(([method]) => method[1] === 'importSentryKey')
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.import' }));
  await waitFor(() =>
    expect(
      mockEmitter.mock.calls.filter(
        ([method]) => method[1] === 'importSentryKey'
      )
    ).toHaveLength(2)
  );
});

it('invalidates backup acknowledgement when the private key changes', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '11'.repeat(32) },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '22'.repeat(32) },
  });
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
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
        role: 'operator',
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
it('identifies the exact selected key beside the final removal password', async () => {
  const firstPublicKey = 'aa'.repeat(48);
  const secondPublicKey = '02' + 'bb'.repeat(32);
  mockEmitter.mockResolvedValue({
    ...settings,
    keys: [
      {
        id: 'key-one',
        label: 'Other operator',
        role: 'operator',
        scheme: 'bls-basic',
        publicKey: firstPublicKey,
      },
      {
        id: 'key-two',
        label: 'Voting key to remove',
        role: 'voting',
        scheme: 'secp256k1',
        publicKey: secondPublicKey,
      },
    ],
  });
  render(<SentryKeys />);
  fireEvent.click(
    (await screen.findAllByRole('button', { name: 'Remove local key' }))[1]
  );
  expect(screen.getByText('Voting key to remove')).toBeVisible();
  expect(screen.getByText(/secp256k1.*Voting/)).toBeVisible();
  expect(screen.getByText(secondPublicKey)).toBeVisible();
  expect(screen.queryByText(firstPublicKey)).toBeNull();
  expect(screen.getByLabelText('Wallet password')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.remove' }));
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'removeSentryKey'],
      [{ id: 'key-two', password: 'synthetic-password' }],
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
  fireEvent.change(screen.getByLabelText('Sentry private key (hex)'), {
    target: { value: '22'.repeat(32) },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => finishOld());
  expect(screen.queryByText('Operator key imported securely.')).toBeNull();
  expect(
    (screen.getByLabelText('Wallet password') as HTMLInputElement).value
  ).toBe('');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(
    (screen.getByLabelText('Sentry private key (hex)') as HTMLInputElement)
      .value
  ).toBe('22'.repeat(32));
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
    screen.queryByRole('option', { name: 'BLS (Basic scheme)' })
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
