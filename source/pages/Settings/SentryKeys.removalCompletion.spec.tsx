/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { webcrypto } from 'crypto';
import React from 'react';

import english from 'assets/locales/en.json';
import { SentryController } from 'scripts/Background/controllers/sentry';
import { getSentryVaultId } from 'utils/sentry/keyStore';

import SentryKeys from './SentryKeys';

let mockState: any;
const mockEmitter = jest.fn();
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split('.').reduce((value: any, part) => value?.[part], english) ||
      key,
  }),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children, error }: any) => (
    <footer>
      {error && <p role="alert">{error}</p>}
      {children}
    </footer>
  ),
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let records: Record<string, any>;
let key: string;
let settingsKey: string;
let currentIdentity: string;
let controller: SentryController;
let failRead: boolean;
let failUiRefresh: boolean;
let failWrite: boolean;
let writes: number;
let postcommitReads: number;
let settingReads: number;
let holdWrite: (() => void) | undefined;
let enteredWrite: (() => void) | undefined;

const makeController = () =>
  new SentryController({
    captureScope: () => ({
      identity: currentIdentity,
      rootPublicIdentity: 'synthetic-public-root',
      network: mockState.vault.activeNetwork,
    }),
    getSeed: async (password) => {
      if (password !== 'synthetic') throw new Error('Invalid password');
      return 'synthetic seed: unused for removal';
    },
  });
const summary = (id: string, label: string, publicByte: string) => ({
  id,
  label,
  network: 'testnet',
  role: 'operator',
  scheme: 'bls-basic',
  publicKey: publicByte.repeat(48),
});

beforeEach(async () => {
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const vaultId = await getSentryVaultId('synthetic-public-root');
  key = `sentry-operator-v1:${vaultId}:testnet`;
  settingsKey = `sentry-settings-v1:${vaultId}:testnet`;
  currentIdentity = 'synthetic-wallet-session';
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'syscoin',
        chainId: 5700,
        url: 'https://test.invalid',
        label: 'Testnet',
      },
      accounts: { HDAccount: { 0: { xpub: 'synthetic-public-root' } } },
    },
    vaultGlobal: { activeSlip44: 1 },
  };
  records = {
    [key]: {
      version: 1,
      vaultId,
      network: 'testnet',
      keys: [
        {
          iv: '00',
          ciphertext: '00',
          summary: summary(ID, 'Selected key', '12'),
        },
        {
          iv: '00',
          ciphertext: '00',
          summary: summary(OTHER_ID, 'Other key', '34'),
        },
      ],
    },
  };
  failRead = false;
  failUiRefresh = false;
  failWrite = false;
  writes = 0;
  postcommitReads = 0;
  settingReads = 0;
  holdWrite = undefined;
  enteredWrite = undefined;
  (chrome.runtime as any).lastError = undefined;
  (chrome.storage.local.get as jest.Mock).mockImplementation((keys, cb) => {
    const names = Array.isArray(keys) ? keys : [keys];
    if (names.includes(settingsKey)) {
      settingReads += 1;
      if (records[key].keys.length === 1) postcommitReads += 1;
      if (failRead) {
        failRead = false;
        (chrome.runtime as any).lastError = {
          message: 'Synthetic settings read failed',
        };
        cb({});
        (chrome.runtime as any).lastError = undefined;
        return;
      }
    }
    cb(
      Object.fromEntries(
        names
          .filter((name: string) => name in records)
          .map((name: string) => [name, clone(records[name])])
      )
    );
  });
  (chrome.storage.local.set as jest.Mock).mockImplementation((items, cb) => {
    writes += 1;
    const finish = () => {
      if (failWrite) {
        failWrite = false;
        (chrome.runtime as any).lastError = {
          message: 'Synthetic native write failed',
        };
        cb();
        (chrome.runtime as any).lastError = undefined;
      } else {
        Object.assign(records, clone(items));
        cb();
      }
    };
    if (enteredWrite) {
      holdWrite = finish;
      enteredWrite();
      enteredWrite = undefined;
    } else finish();
  });
  controller = makeController();
  mockEmitter.mockReset().mockImplementation((methods, params) => {
    if (methods[1] === 'getSentrySettings') {
      if (failUiRefresh && records[key].keys.length === 1) {
        failUiRefresh = false;
        failRead = true;
      }
      return controller.getSettings();
    }
    if (methods[1] === 'removeSentryKey')
      return controller.removeKey(params[0]);
    throw new Error('Unexpected controller method');
  });
});

const remove = async () => {
  fireEvent.click(
    (await screen.findAllByRole('button', { name: 'Remove local key' }))[0]
  );
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic' },
  });
  fireEvent.click(screen.getByRole('button', { name: english.buttons.remove }));
};
const removedNotice =
  english.sentry.localOperatorKeyRemovedRegisteredCollateralRemainsProtected;

it('returns an exact durable receipt without a fallible postcommit settings read', async () => {
  failRead = true;
  await expect(
    controller.removeKey({ id: ID, password: 'synthetic' })
  ).resolves.toEqual({ removedKeyId: ID });
  expect(postcommitReads).toBe(0);
  expect(records[key].keys.map((entry: any) => entry.summary.id)).toEqual([
    OTHER_ID,
  ]);
  await expect(controller.getSettings()).rejects.toMatchObject({
    message: 'Synthetic settings read failed',
  });
  expect(
    (await makeController().getSettings()).keys.map((entry) => entry.id)
  ).toEqual([OTHER_ID]);
});

it('keeps native write failure distinct and retries the same selected key successfully', async () => {
  failWrite = true;
  await expect(
    controller.removeKey({ id: ID, password: 'synthetic' })
  ).rejects.toMatchObject({ message: 'Synthetic native write failed' });
  expect(records[key].keys).toHaveLength(2);
  await expect(
    controller.removeKey({ id: ID, password: 'synthetic' })
  ).resolves.toEqual({ removedKeyId: ID });
  expect(
    (await makeController().getSettings()).keys.map((entry) => entry.id)
  ).toEqual([OTHER_ID]);
});

it('does not acknowledge a missing key or failed password and performs no write', async () => {
  await expect(
    controller.removeKey({ id: 'missing', password: 'synthetic' })
  ).rejects.toThrow('not found');
  await expect(
    controller.removeKey({ id: ID, password: 'wrong' })
  ).rejects.toThrow('Invalid password');
  expect(writes).toBe(0);
  expect(records[key].keys).toHaveLength(2);
});

it('does not return a receipt after its wallet scope changes during a held native write', async () => {
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  enteredWrite = entered;
  const result = controller.removeKey({ id: ID, password: 'synthetic' });
  const rejected = expect(result).rejects.toThrow('session changed');
  await waiting;
  currentIdentity = 'replacement-session';
  holdWrite!();
  await rejected;
});

it('shows committed removal separately from its failed UI refresh and retries only the read', async () => {
  render(<SentryKeys />);
  await screen.findByText('Selected key');
  // The initial load succeeds. Only the UI follow-up read after the durable
  // mutation is refused; the actual controller and native writer still run.
  failUiRefresh = true;
  await remove();
  await screen.findByText(removedNotice);
  expect(
    screen.getByText(english.sentry.unableToLoadSentrySettings)
  ).toBeVisible();
  expect(screen.queryByText('Selected key')).toBeNull();
  expect(screen.getByText('Other key')).toBeVisible();
  expect(screen.queryByLabelText('Wallet password')).toBeNull();
  const removals = () =>
    mockEmitter.mock.calls.filter(
      ([method]) => method[1] === 'removeSentryKey'
    );
  expect(removals()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: english.receive.retry }));
  await screen.findByText('Other key');
  expect(
    screen.queryByText(english.sentry.unableToLoadSentrySettings)
  ).toBeNull();
  expect(screen.queryByText('Selected key')).toBeNull();
  expect(removals()).toHaveLength(1);
  expect(writes).toBe(1);
  expect(settingReads).toBe(3);
  expect(
    (await makeController().getSettings()).keys.map((entry) => entry.id)
  ).toEqual([OTHER_ID]);
});

it('keeps the selected removal form after native refusal and allows the same action retry', async () => {
  render(<SentryKeys />);
  failWrite = true;
  await remove();
  await screen.findByText('Synthetic native write failed');
  expect(screen.getByText('Selected key')).toBeVisible();
  expect(screen.queryByText(removedNotice)).toBeNull();
  expect(records[key].keys).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Wallet password'), {
    target: { value: 'synthetic' },
  });
  fireEvent.click(screen.getByRole('button', { name: english.buttons.remove }));
  await screen.findByText(removedNotice);
  expect(screen.queryByText('Selected key')).toBeNull();
  expect(screen.getByText('Other key')).toBeVisible();
  expect(writes).toBe(2);
});

it('rejects a malformed completion instead of hiding an unremoved key', async () => {
  mockEmitter.mockImplementation((methods) =>
    methods[1] === 'getSentrySettings'
      ? controller.getSettings()
      : Promise.resolve({ removedKeyId: OTHER_ID })
  );
  render(<SentryKeys />);
  await remove();
  await screen.findByText(english.sentry.unableToCompleteSentryOperation);
  expect(screen.queryByText(removedNotice)).toBeNull();
  expect(screen.getByText('Selected key')).toBeVisible();
  expect(writes).toBe(0);
});

it('does not deliver an old completion into a changed account view', async () => {
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  enteredWrite = entered;
  const view = render(<SentryKeys />);
  await remove();
  await waiting;
  currentIdentity = 'replacement-session';
  mockState.vault.activeAccount = { type: 'HDAccount', id: 1 };
  view.rerender(<SentryKeys />);
  await act(async () => holdWrite!());
  await waitFor(() =>
    expect(screen.queryByLabelText('Wallet password')).toBeNull()
  );
  expect(screen.queryByText(removedNotice)).toBeNull();
  expect(screen.queryByText(/session changed/)).toBeNull();
});

it('preserves the exact key-summary DOM in the list and final removal review', async () => {
  render(<SentryKeys />);
  const heading = await screen.findByText('Selected key');
  const list = heading.closest('section')!;
  const details = Array.from(list.children).slice(0, 3);
  expect(details.map((element) => element.tagName)).toEqual(['H3', 'P', 'P']);
  expect(details.map((element) => element.className)).toEqual([
    'break-words font-medium',
    'mt-1 text-xs text-brand-gray200',
    'mt-3 break-all font-mono text-xs',
  ]);
  expect(list.className).toBe(
    'min-w-0 rounded-xl border border-brand-blue600 p-4'
  );
  const originalMarkup = details.map((element) => element.outerHTML);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Remove local key' })[0]
  );
  const review = screen.getByText('Selected key').closest('section')!;
  expect(review.className).toBe(
    'min-w-0 rounded-xl border border-warning-error p-4'
  );
  expect(
    Array.from(review.children).map((element) => element.outerHTML)
  ).toEqual(originalMarkup);
  expect(review.children).toHaveLength(3);
});

it('preserves import-field attributes, focus, controlled values and backup invalidation', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Import Sentry key' })
  );
  const label = screen.getByLabelText('Key label') as HTMLInputElement;
  const secret = screen.getByLabelText(
    'Sentry private key (hex)'
  ) as HTMLInputElement;
  const password = screen.getByLabelText('Wallet password') as HTMLInputElement;
  for (const input of [label, secret, password]) {
    expect(input.parentElement?.tagName).toBe('LABEL');
    expect(input.parentElement?.className).toBe('text-sm');
    expect(input.className).toBe(
      'mt-2 w-full min-w-0 min-h-11 rounded-xl border border-fields-input-border bg-bkg-1 p-3 text-sm text-white focus:border-fields-input-borderfocus'
    );
    expect(input).not.toBeDisabled();
  }
  expect(label.maxLength).toBe(80);
  expect(secret.type).toBe('password');
  expect(secret.autocomplete).toBe('new-password');
  expect(secret).toHaveAttribute('spellcheck', 'false');
  expect(secret.maxLength).toBe(130);
  expect(password.type).toBe('password');
  expect(password.autocomplete).toBe('current-password');
  label.focus();
  fireEvent.change(label, { target: { value: 'New public label' } });
  expect(screen.getByLabelText('Key label')).toBe(label);
  expect(label).toHaveFocus();
  fireEvent.change(secret, { target: { value: '12'.repeat(32) } });
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
  fireEvent.change(label, { target: { value: 'Updated public label' } });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(label.value).toBe('Updated public label');
  expect(secret.value).toBe('12'.repeat(32));
});

it('preserves service inputs and disables the same removal password node during native IO', async () => {
  render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Trusted data service' })
  );
  const service = screen.getByLabelText(
    'Trusted HTTPS service origin'
  ) as HTMLInputElement;
  const fee = screen.getByLabelText(
    'Maximum transaction fee (satoshis)'
  ) as HTMLInputElement;
  expect(service.type).toBe('url');
  expect(service.placeholder).toBe('https://sysnode.info');
  expect(fee.getAttribute('inputmode')).toBe('numeric');
  expect(fee.getAttribute('type')).toBeNull();
  fireEvent.change(service, {
    target: { value: 'https://service.synthetic.invalid' },
  });
  fireEvent.change(fee, { target: { value: '200000' } });
  expect(screen.getByLabelText('Trusted HTTPS service origin')).toBe(service);
  expect(service.value).toBe('https://service.synthetic.invalid');
  expect(fee.value).toBe('200000');
  fireEvent.click(screen.getByRole('button', { name: english.buttons.cancel }));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Remove local key' })[0]
  );
  const password = screen.getByLabelText('Wallet password');
  fireEvent.change(password, { target: { value: 'synthetic' } });
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  enteredWrite = entered;
  failWrite = true;
  fireEvent.click(screen.getByRole('button', { name: english.buttons.remove }));
  await waiting;
  expect(screen.getByLabelText('Wallet password')).toBe(password);
  expect(password).toBeDisabled();
  await act(async () => holdWrite!());
  await screen.findByText('Synthetic native write failed');
  expect(screen.getByLabelText('Wallet password')).toBe(password);
  expect(password).not.toBeDisabled();
  expect(password).toHaveValue('');
});
