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

const originalCrypto = Object.getOwnPropertyDescriptor(global, 'crypto');
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const OLD = {
  serviceUrl: 'https://sysnode.info',
  maxFeeSatoshis: '100000',
};
const NEXT = {
  serviceUrl: 'https://settings-probe.invalid',
  maxFeeSatoshis: '120000',
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let records: Record<string, any>;
let settingsKey: string;
let controller: SentryController;
let currentIdentity: string;
let refuseWrite: boolean;
let refuseSettingsRead: boolean;
let committed: boolean;
let writes: number;
let failedReads: number;
let settingsReads: number;
let writeBarrier: ReturnType<typeof deferred> | undefined;
const makeController = () =>
  new SentryController({
    captureScope: () => ({
      identity: currentIdentity,
      rootPublicIdentity: 'synthetic-public-root',
      network: mockState.vault.activeNetwork,
    }),
    // Only authentication is stubbed. This real settings path never derives,
    // exports or uses seed bytes, and performs no signing or remote IO.
    getSeed: async (password) => {
      if (password !== 'synthetic') throw new Error('Invalid password');
      return 'unused synthetic authentication result';
    },
  });

beforeEach(async () => {
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const vaultId = await getSentryVaultId('synthetic-public-root');
  settingsKey = `sentry-settings-v1:${vaultId}:testnet`;
  currentIdentity = 'synthetic-session';
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
    [settingsKey]: clone(OLD),
    [`sentry-operator-v1:${vaultId}:testnet`]: {
      version: 1,
      vaultId,
      network: 'testnet',
      keys: [
        {
          iv: '00',
          ciphertext: '00',
          summary: {
            id: '11111111-1111-4111-8111-111111111111',
            label: 'Unrelated public key',
            network: 'testnet',
            role: 'operator',
            scheme: 'bls-basic',
            publicKey: '12'.repeat(48),
          },
        },
      ],
    },
  };
  refuseWrite = false;
  refuseSettingsRead = false;
  committed = false;
  writes = 0;
  failedReads = 0;
  settingsReads = 0;
  writeBarrier = undefined;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest
    .spyOn(chrome.storage.local, 'get')
    .mockImplementation((keys, callback) => {
      const names = Array.isArray(keys) ? keys : [keys];
      if (names.includes(settingsKey)) {
        settingsReads += 1;
        if (committed && refuseSettingsRead) {
          refuseSettingsRead = false;
          failedReads += 1;
          (chrome.runtime as any).lastError = {
            message: 'Synthetic postcommit settings read failed',
          };
          callback({});
          (chrome.runtime as any).lastError = undefined;
          return;
        }
      }
      callback(
        Object.fromEntries(
          names
            .filter((key) => key in records)
            .map((key) => [key, clone(records[key])])
        )
      );
    });
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      writes += 1;
      const finish = () => {
        if (refuseWrite) {
          refuseWrite = false;
          (chrome.runtime as any).lastError = {
            message: 'Synthetic native settings write failed',
          };
          callback();
          (chrome.runtime as any).lastError = undefined;
          return;
        }
        Object.assign(records, clone(items));
        committed = true;
        callback();
      };
      if (writeBarrier) void writeBarrier.promise.then(finish);
      else finish();
    });
  controller = makeController();
  mockEmitter.mockReset().mockImplementation((path, args = []) => {
    if (path[1] === 'saveSentrySettings')
      return controller.saveSettings(args[0]);
    if (path[1] === 'getSentrySettings') return controller.getSettings();
    throw new Error(`Unexpected method ${path[1]}`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  (chrome.runtime as any).lastError = undefined;
  if (originalCrypto) Object.defineProperty(global, 'crypto', originalCrypto);
});

const openServiceForm = async () => {
  const view = render(<SentryKeys />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: english.sentry.trustedDataService,
    })
  );
  fireEvent.change(
    screen.getByLabelText(english.sentry.trustedHTTPSServiceOrigin),
    { target: { value: `${NEXT.serviceUrl}/` } }
  );
  fireEvent.change(
    screen.getByLabelText(english.sentry.maximumTransactionFeeSatoshis),
    { target: { value: NEXT.maxFeeSatoshis } }
  );
  fireEvent.change(screen.getByLabelText(english.sentry.walletPassword), {
    target: { value: 'synthetic' },
  });
  return view;
};
const clickSave = () =>
  fireEvent.click(screen.getByRole('button', { name: english.buttons.save }));
const save = () =>
  controller.saveSettings({
    ...NEXT,
    serviceUrl: `${NEXT.serviceUrl}/`,
    password: 'synthetic',
  });

it('returns normalized durable preferences without a fallible postcommit read', async () => {
  refuseSettingsRead = true;
  await expect(save()).resolves.toEqual(NEXT);
  expect(records[settingsKey]).toEqual(NEXT);
  expect(settingsReads).toBe(0);
  expect(writes).toBe(1);
  await expect(controller.getSettings()).rejects.toMatchObject({
    message: 'Synthetic postcommit settings read failed',
  });
  expect(failedReads).toBe(1);
  // This is fresh-controller restoration through a native API adapter, not a
  // claim about physical disk or a real browser worker restart.
  expect(await makeController().getSettings()).toMatchObject(NEXT);
});

it('shows committed preferences beside a failed refresh and retries only the read', async () => {
  await openServiceForm();
  refuseSettingsRead = true;
  clickSave();
  await screen.findByText(english.sentry.trustedServiceSettingsSaved);
  expect(screen.getByRole('alert')).toHaveTextContent(
    english.sentry.unableToLoadSentrySettings
  );
  expect(screen.getByText('Unrelated public key')).toBeInTheDocument();
  expect(records[settingsKey]).toEqual(NEXT);
  expect(writes).toBe(1);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'saveSentrySettings')
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: english.receive.retry }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: english.sentry.trustedDataService,
    })
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByLabelText(english.sentry.trustedHTTPSServiceOrigin)
  ).toHaveValue(NEXT.serviceUrl);
  expect(
    screen.getByLabelText(english.sentry.maximumTransactionFeeSatoshis)
  ).toHaveValue(NEXT.maxFeeSatoshis);
  expect(writes).toBe(1);
  expect(
    mockEmitter.mock.calls.filter(([path]) => path[1] === 'saveSentrySettings')
  ).toHaveLength(1);
});

it('preserves acknowledged preferences and unrelated keys when revisiting before retry', async () => {
  await openServiceForm();
  refuseSettingsRead = true;
  clickSave();
  await screen.findByText(english.sentry.trustedServiceSettingsSaved);
  fireEvent.click(
    screen.getByRole('button', { name: english.sentry.trustedDataService })
  );
  expect(
    screen.getByLabelText(english.sentry.trustedHTTPSServiceOrigin)
  ).toHaveValue(NEXT.serviceUrl);
  expect(
    screen.getByLabelText(english.sentry.maximumTransactionFeeSatoshis)
  ).toHaveValue(NEXT.maxFeeSatoshis);
  expect(writes).toBe(1);
});

it('does not publish unexpected receipt fields over the latest settings', async () => {
  await openServiceForm();
  const actual = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    const result = await actual(path, args);
    if (path[1] !== 'saveSentrySettings') return result;
    // The native controller still returns exactly the two preference fields.
    // Extra bridge data must not replace unrelated cached settings.
    expect(result).toEqual(NEXT);
    return { ...result, keys: [], network: 'mainnet' };
  });
  refuseSettingsRead = true;
  clickSave();
  await screen.findByText(english.sentry.trustedServiceSettingsSaved);
  expect(screen.getByRole('alert')).toHaveTextContent(
    english.sentry.unableToLoadSentrySettings
  );
  expect(screen.getByText('Unrelated public key')).toBeInTheDocument();
  expect(records[settingsKey]).toEqual(NEXT);
  expect(writes).toBe(1);
});

it('acknowledges a healthy native write and restores settings with a fresh controller', async () => {
  await openServiceForm();
  clickSave();
  await screen.findByText(english.sentry.trustedServiceSettingsSaved);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(records[settingsKey]).toEqual(NEXT);
  expect(await makeController().getSettings()).toMatchObject(NEXT);
  expect(writes).toBe(1);
});

it('preserves native failure and retries the same draft after password re-entry', async () => {
  await openServiceForm();
  refuseWrite = true;
  clickSave();
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Synthetic native settings write failed'
    )
  );
  expect(records[settingsKey]).toEqual(OLD);
  expect(await makeController().getSettings()).toMatchObject(OLD);
  expect(
    screen.queryByText(english.sentry.trustedServiceSettingsSaved)
  ).toBeNull();
  expect(screen.getByLabelText(english.sentry.walletPassword)).toHaveValue('');
  fireEvent.change(screen.getByLabelText(english.sentry.walletPassword), {
    target: { value: 'synthetic' },
  });
  clickSave();
  await screen.findByText(english.sentry.trustedServiceSettingsSaved);
  expect(records[settingsKey]).toEqual(NEXT);
  expect(writes).toBe(2);
});

it.each([
  undefined,
  null,
  false,
  0,
  '',
  {},
  { serviceUrl: 7, maxFeeSatoshis: '120000' },
  { serviceUrl: NEXT.serviceUrl, maxFeeSatoshis: 120000 },
  { serviceUrl: '', maxFeeSatoshis: '120000' },
  { serviceUrl: NEXT.serviceUrl, maxFeeSatoshis: '' },
])(
  'refuses a malformed acknowledgement without claiming durable success (%j)',
  async (receipt) => {
    await openServiceForm();
    const actual = mockEmitter.getMockImplementation()!;
    // Deliberately malformed protocol control, not a simulated successful write.
    mockEmitter.mockImplementation((path, args) =>
      path[1] === 'saveSentrySettings'
        ? Promise.resolve(receipt)
        : actual(path, args)
    );
    clickSave();
    await screen.findByRole('alert');
    expect(
      screen.queryByText(english.sentry.trustedServiceSettingsSaved)
    ).toBeNull();
    expect(records[settingsKey]).toEqual(OLD);
    expect(writes).toBe(0);
    expect(screen.getByLabelText(english.sentry.walletPassword)).toHaveValue(
      ''
    );
  }
);

it('rejects a wrong password before any native settings write', async () => {
  await expect(
    controller.saveSettings({ ...NEXT, password: 'wrong' })
  ).rejects.toThrow('Invalid password');
  expect(records[settingsKey]).toEqual(OLD);
  expect(writes).toBe(0);
});

it('keeps the receipt pending until native storage accepts it', async () => {
  writeBarrier = deferred();
  let complete = false;
  const result = save().then((receipt) => {
    complete = true;
    return receipt;
  });
  await waitFor(() => expect(writes).toBe(1));
  expect(complete).toBe(false);
  expect(records[settingsKey]).toEqual(OLD);
  writeBarrier.resolve();
  await expect(result).resolves.toEqual(NEXT);
});

it('does not acknowledge a held write after its captured session changes', async () => {
  writeBarrier = deferred();
  const result = save();
  const rejected = expect(result).rejects.toThrow('session changed');
  await waitFor(() => expect(writes).toBe(1));
  currentIdentity = 'replacement-session';
  writeBarrier.resolve();
  await rejected;
});

it.each([false, true])(
  'ignores a late successful reply after view retirement (unmount=%s)',
  async (unmount) => {
    const view = await openServiceForm();
    writeBarrier = deferred();
    clickSave();
    await waitFor(() => expect(writes).toBe(1));
    if (unmount) view.unmount();
    else {
      mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
      view.rerender(<SentryKeys />);
      await screen.findByRole('button', {
        name: english.sentry.trustedDataService,
      });
    }
    await act(async () => {
      writeBarrier!.resolve();
    });
    expect(records[settingsKey]).toEqual(NEXT);
    expect(
      screen.queryByText(english.sentry.trustedServiceSettingsSaved)
    ).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(writes).toBe(1);
  }
);
