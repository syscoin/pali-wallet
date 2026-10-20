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
