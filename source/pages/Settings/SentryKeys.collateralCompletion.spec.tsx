/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'crypto';
import React from 'react';

import english from 'assets/locales/en.json';
import { SentryController } from 'scripts/Background/controllers/sentry';
import { getSentryVaultId } from 'utils/sentry/keyStore';
import { SENTRY_NETWORKS } from 'utils/sentry/network';

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
jest.mock('utils/sentry/workerClient', () => ({
  runSentryCrypto: () => {
    throw new Error('Crypto/signing is denied in this public-record probe');
  },
}));

const ROOT = 'synthetic-public-wallet-root';
const RESERVATION = {
  txid: 'bb'.repeat(32),
  vout: 1,
  proTxHash: 'cc'.repeat(32),
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
let records: Record<string, any>;
let settingsKey: string;
let collateralKey: string;
let controller: SentryController;
let settingReads: number;
let failSettingsRead: number;
let failWrite: boolean;
let writes: number;
let authenticate: jest.Mock;
const originalFetch = globalThis.fetch;

beforeEach(async () => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  globalThis.fetch = jest.fn(() =>
    Promise.reject(new Error('Public network is denied'))
  ) as any;
  const vaultId = await getSentryVaultId(ROOT);
  settingsKey = `sentry-settings-v1:${vaultId}:testnet`;
  collateralKey = `sentry-collateral-v1:${vaultId}:${SENTRY_NETWORKS.testnet.genesisHash}`;
  records = { [collateralKey]: [clone(RESERVATION)] };
  settingReads = 0;
  failSettingsRead = 0;
  failWrite = false;
  writes = 0;
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'syscoin',
        chainId: 5700,
        url: 'https://test.invalid',
        label: 'Testnet',
      },
      accounts: { HDAccount: { 0: { xpub: ROOT } } },
    },
    vaultGlobal: { activeSlip44: 1 },
  };
  (chrome.runtime as any).lastError = undefined;
  (chrome.storage.local.get as jest.Mock).mockImplementation(
    (keys, callback) => {
      const names = Array.isArray(keys) ? keys : [keys];
      if (names.includes(settingsKey)) {
        settingReads += 1;
        if (settingReads === failSettingsRead) {
          (chrome.runtime as any).lastError = {
            message: 'Synthetic settings read failed',
          };
          callback({});
          (chrome.runtime as any).lastError = undefined;
          return;
        }
      }
      callback(
        Object.fromEntries(
          names
            .filter((key: string) => key in records)
            .map((key: string) => [key, clone(records[key])])
        )
      );
    }
  );
  (chrome.storage.local.set as jest.Mock).mockImplementation(
    (items, callback) => {
      writes += 1;
      if (failWrite) {
        (chrome.runtime as any).lastError = {
          message: 'Synthetic native write failed',
        };
        callback();
        (chrome.runtime as any).lastError = undefined;
        return;
      }
      Object.assign(records, clone(items));
      callback();
    }
  );
  authenticate = jest.fn(async (password) => {
    if (password !== 'synthetic-password') throw new Error('Invalid password');
    return 'synthetic-unused-authentication-result';
  });
  controller = new SentryController({
    captureScope: () => ({
      identity: 'synthetic-current-wallet',
      rootPublicIdentity: ROOT,
      network: mockState.vault.activeNetwork,
    }),
    getSeed: authenticate,
  });
  mockEmitter.mockReset().mockImplementation((method, params) => {
    if (method[1] === 'getSentrySettings') return controller.getSettings();
    if (method[1] === 'releaseSentryCollateral')
      return controller.releaseCollateral(params[0]);
    throw new Error(`Unexpected method: ${String(method)}`);
  });
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  globalThis.fetch = originalFetch;
});

const releaseForm = async () => {
  await screen.findByText(`${RESERVATION.txid}:1`);
  fireEvent.click(
    screen.getByRole('button', { name: english.sentry.unlockCollateral })
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText(english.sentry.walletPassword), {
    target: { value: 'synthetic-password' },
  });
};
const submitRelease = () =>
  fireEvent.click(
    screen.getByRole('button', { name: english.sentry.unlockCollateral })
  );
const notice =
  english.sentry.collateralProtectionRemovedSpendingThisOutputWillStop;

it('healthy: releases exactly the selected public reservation and displays success', async () => {
  render(<SentryKeys />);
  await releaseForm();
  submitRelease();
  await screen.findByText(notice);
  expect(records[collateralKey]).toEqual([]);
  expect(screen.queryByText(`${RESERVATION.txid}:1`)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes).toBe(1);
  expect(authenticate).toHaveBeenCalledTimes(1);
});

it('healthy: Cancel preserves protection and does not authenticate or write', async () => {
  render(<SentryKeys />);
  await releaseForm();
  fireEvent.click(screen.getByRole('button', { name: english.buttons.cancel }));
  await screen.findByText(`${RESERVATION.txid}:1`);
  expect(records[collateralKey]).toEqual([RESERVATION]);
  expect(authenticate).not.toHaveBeenCalled();
  expect(writes).toBe(0);
  expect(screen.queryByLabelText(english.sentry.walletPassword)).toBeNull();
});

it('healthy: a genuine native write refusal leaves collateral protected and no success notice', async () => {
  failWrite = true;
  render(<SentryKeys />);
  await releaseForm();
  submitRelease();
  await screen.findByText('Synthetic native write failed');
  expect(records[collateralKey]).toEqual([RESERVATION]);
  expect(screen.queryByText(notice)).toBeNull();
  expect(screen.getByLabelText(english.sentry.walletPassword)).toBeVisible();
  expect(writes).toBe(1);
});

it('healthy: reopening after a successful release reads the persisted empty protection list', async () => {
  const view = render(<SentryKeys />);
  await releaseForm();
  submitRelease();
  await screen.findByText(notice);
  view.unmount();
  render(<SentryKeys />);
  await screen.findByText(english.sentry.noLinkedCollateralInThisWallet);
  expect(screen.queryByText(`${RESERVATION.txid}:1`)).toBeNull();
  expect(writes).toBe(1);
});

it('returns an exact durable release receipt without a fallible postcommit settings read', async () => {
  failSettingsRead = 1;
  await expect(
    controller.releaseCollateral({
      reservation: {
        ...RESERVATION,
        ignoredMetadata: 'not returned',
      } as typeof RESERVATION,
      password: 'synthetic-password',
      acknowledgeNodeStops: true,
    })
  ).resolves.toEqual({ releasedReservation: RESERVATION });
  expect(settingReads).toBe(0);
  expect(records[collateralKey]).toEqual([]);
  expect(writes).toBe(1);
  await expect(controller.getSettings()).rejects.toMatchObject({
    message: 'Synthetic settings read failed',
  });
});

it('keeps a committed release distinct from a failed UI refresh and Retry only reloads settings', async () => {
  failSettingsRead = 2;
  render(<SentryKeys />);
  await releaseForm();
  submitRelease();
  await screen.findByText(notice);
  expect(
    screen.getByText(english.sentry.unableToLoadSentrySettings)
  ).toBeVisible();
  expect(records[collateralKey]).toEqual([]);
  expect(screen.queryByText(`${RESERVATION.txid}:1`)).toBeNull();
  expect(screen.queryByLabelText(english.sentry.walletPassword)).toBeNull();
  expect(writes).toBe(1);
  const releases = () =>
    mockEmitter.mock.calls.filter(
      ([method]) => method[1] === 'releaseSentryCollateral'
    );
  expect(releases()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: english.receive.retry }));
  await screen.findByText(english.sentry.noLinkedCollateralInThisWallet);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(releases()).toHaveLength(1);
  expect(writes).toBe(1);
  expect(authenticate).toHaveBeenCalledTimes(1);
});

it.each([undefined, { ...RESERVATION, vout: 2 }])(
  'does not remove displayed protection after a missing or mismatched receipt',
  async (receipt) => {
    mockEmitter.mockImplementation((method) =>
      method[1] === 'getSentrySettings'
        ? controller.getSettings()
        : Promise.resolve({ releasedReservation: receipt })
    );
    render(<SentryKeys />);
    await releaseForm();
    submitRelease();
    await screen.findByText(english.sentry.unableToCompleteSentryOperation);
    expect(screen.getByText(`${RESERVATION.txid}:1`)).toBeVisible();
    expect(screen.queryByText(notice)).toBeNull();
    expect(records[collateralKey]).toEqual([RESERVATION]);
    expect(writes).toBe(0);
  }
);

it('does not acknowledge release after a wrong password', async () => {
  render(<SentryKeys />);
  await releaseForm();
  fireEvent.change(screen.getByLabelText(english.sentry.walletPassword), {
    target: { value: 'wrong' },
  });
  submitRelease();
  await screen.findByText('Invalid password');
  expect(records[collateralKey]).toEqual([RESERVATION]);
  expect(screen.queryByText(notice)).toBeNull();
  expect(writes).toBe(0);
});
