/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';

import SmartAccountPolicy from './SmartAccountPolicy';

const NOW = new Date('2026-10-18T22:30:00Z');
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const GUARDIAN = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 57057;
const STORAGE_KEY = `pali-smart-account-recovery-replacement:${CHAIN_ID}:${ACCOUNT}`;
let mockVault: any;
let mockScope: string;
let mockChainTimestamp: number;
let mockLocale = 'en';
const mockDateAlert = jest.fn();
const mockEmitter = jest.fn();
const mockLocation = {
  hash: '',
  key: 'policy-entry',
  pathname: '/settings/account/smart-account-policy',
  search: '',
  state: {
    accountType: 'SmartAccount',
    id: 1,
    smartAccountPolicyView: 'recovery',
  },
};

jest.mock('antd', () => ({
  Form: { Item: ({ children }: any) => <div>{children}</div> },
  Input: 'input',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <span /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button').Button,
  ConfirmationModal: () => null,
  Icon: () => <span />,
}));
jest.mock('components/Loading', () => ({
  PqOperationStatus: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    connectionUnavailable: false,
    isLoading: false,
    isUnlocked: true,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: { error: mockDateAlert, success: jest.fn() },
    navigate: jest.fn(),
    useCopyClipboard: () => [null, jest.fn()],
  }),
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: mockVault, vaultGlobal: { activeSlip44: 60 } }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: mockLocale, language: mockLocale },
    t: (key: string, values?: { time?: string }) =>
      values?.time ? `${key}: ${values.time}` : key,
  }),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => mockScope,
}));

const storeRecovery = (readyAt: unknown) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      authenticator: {
        id: 'ecdsa',
        config: { owners: [OWNER], threshold: 1 },
      },
      kind: 'ecdsa',
      recoveryOperation: {
        account: ACCOUNT,
        chainId: CHAIN_ID,
        policyEpoch: '7',
        recoveryModule: getPaliModuleAddress(CHAIN_ID, 'guardian-recovery'),
        executionCalldata: '0x1234',
        mode: `0x${'00'.repeat(32)}`,
        readyAt,
        salt: `0x${'66'.repeat(32)}`,
      },
    })
  );
};
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const advance = async (milliseconds: number) => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
  });
};
const finalize = () =>
  screen.getByRole('button', {
    name: 'settings.smartAccountGuardianRecoveryFinalize',
  }) as HTMLButtonElement;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  mockLocale = 'en';
  localStorage.clear();
  mockScope = 'account:1-network:57057';
  mockChainTimestamp = NOW.getTime() / 1000;
  window.history.replaceState(
    { key: 'policy-entry' },
    '',
    '/#/settings/account/smart-account-policy'
  );
  const metadata = {
    auth: {
      data: '0x',
      module: 'ecdsa',
      validator: getPaliModuleAddress(CHAIN_ID, 'ecdsa'),
    },
    chainId: CHAIN_ID,
    isDeployed: true,
    installedModules: [
      {
        address: getPaliModuleAddress(CHAIN_ID, 'ecdsa'),
        config: { owners: [OWNER], threshold: 1 },
        id: 'ecdsa',
        type: 'validator',
      },
      {
        address: getPaliModuleAddress(CHAIN_ID, 'guardian-recovery'),
        config: { delaySeconds: 60, guardians: [GUARDIAN], threshold: 1 },
        id: 'guardian-recovery',
        type: 'executor',
      },
    ],
  };
  mockVault = {
    accounts: {
      [KeyringAccountType.HDAccount]: { 0: { address: OWNER, id: 0 } },
      [KeyringAccountType.SmartAccount]: {
        1: {
          address: ACCOUNT,
          id: 1,
          isSmartAccount: true,
          smartAccount: metadata,
        },
      },
    },
    activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
    activeNetwork: { chainId: CHAIN_ID, url: 'https://synthetic-rpc.invalid' },
  };
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getWalletSessionGeneration') return 7;
    if (method === 'getSLHDSASmartAccountSetupStatus') return null;
    if (method === 'getSmartAccountGuardianRecoveryStatus') {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const operationId = stored?.recoveryOperation
        ? getGuardianRecoveryOperationId(stored.recoveryOperation)
        : null;
      const pending = operationId
        ? {
            operationId,
            scheduledAt: NOW.getTime() / 1000,
            executableAt: NOW.getTime() / 1000 + 60,
            expiresAt: NOW.getTime() / 1000 + 60 + 604800,
            status:
              mockChainTimestamp >= NOW.getTime() / 1000 + 60
                ? 'ready'
                : 'pending',
          }
        : null;
      return {
        account: ACCOUNT,
        chainId: CHAIN_ID,
        moduleAddress: getPaliModuleAddress(CHAIN_ID, 'guardian-recovery'),
        policyEpoch: '7',
        observedBlock: {
          number: 1,
          hash: `0x${'aa'.repeat(32)}`,
          timestamp: mockChainTimestamp,
        },
        active: pending,
        pending,
        knownOperation: pending,
        delay: '60',
        exists: true,
        guardians: [GUARDIAN],
        threshold: 1,
      };
    }
    if (method === 'hydrateSmartAccount') return metadata;
    if (method === 'finalizeSmartAccountGuardianRecovery') return {};
    throw new Error(`Unexpected controller method ${method}`);
  });
  storeRecovery(Math.floor(NOW.getTime() / 1000) + 60);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('enables Finalize only after an explicit refresh observes the chain deadline', async () => {
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(true);
  const reads = () =>
    mockEmitter.mock.calls.filter(
      ([[, name]]) => name === 'getSmartAccountGuardianRecoveryStatus'
    ).length;
  const initialReads = reads();
  mockChainTimestamp += 60;
  await advance(30000);
  await settle();
  expect(finalize().disabled).toBe(true);
  expect(reads()).toBe(initialReads);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await settle();
  expect(reads()).toBe(initialReads + 1);
  expect(finalize().disabled).toBe(false);
  fireEvent.click(finalize());
  await settle();
  await settle();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'finalizeSmartAccountGuardianRecovery'],
    [expect.objectContaining({ account: ACCOUNT, chainId: CHAIN_ID })],
    300000
  );
});

it('keeps a pending chain recovery disabled after a large local clock jump', async () => {
  render(<SmartAccountPolicy />);
  await settle();
  jest.setSystemTime(NOW.getTime() + 8 * 86400000);
  await advance(30000);
  await settle();
  const initialReads = mockEmitter.mock.calls.filter(
    ([[, name]]) => name === 'getSmartAccountGuardianRecoveryStatus'
  ).length;
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await settle();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, name]]) => name === 'getSmartAccountGuardianRecoveryStatus'
    )
  ).toHaveLength(initialReads + 1);
  expect(finalize().disabled).toBe(true);
  expect(
    mockEmitter.mock.calls.some(
      ([[, name]]) => name === 'finalizeSmartAccountGuardianRecovery'
    )
  ).toBe(false);
});

it('allows a chain-ready recovery despite a backward local clock adjustment', async () => {
  mockChainTimestamp += 60;
  jest.setSystemTime(NOW.getTime() - 120000);
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(false);
});

it.each([null, '', -1, 'Infinity', 'NaN', 999999999999])(
  'uses chain readiness rather than the saved local readyAt estimate %s',
  async (readyAt) => {
    storeRecovery(readyAt);
    mockChainTimestamp += 60;
    render(<SmartAccountPolicy />);
    await settle();
    expect(finalize().disabled).toBe(false);
  }
);

it('rechecks current chain state before finalization and preserves credentials if no longer ready', async () => {
  mockChainTimestamp += 60;
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(false);
  const saved = localStorage.getItem(STORAGE_KEY);
  mockChainTimestamp -= 60;
  fireEvent.click(finalize());
  await settle();
  await settle();
  expect(
    mockEmitter.mock.calls.some(
      ([[, name]]) => name === 'finalizeSmartAccountGuardianRecovery'
    )
  ).toBe(false);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  expect(finalize().disabled).toBe(true);
});

it.each(['account', 'network', 'unmount'])(
  'retires old read-only refreshes after %s',
  async (change) => {
    const view = render(<SmartAccountPolicy />);
    await settle();
    if (change === 'account') {
      mockVault.accounts.SmartAccount[1] = {
        ...mockVault.accounts.SmartAccount[1],
        address: GUARDIAN,
      };
      view.rerender(<SmartAccountPolicy />);
    } else if (change === 'network') {
      mockScope = 'account:1-network:other';
      mockVault.activeNetwork = { ...mockVault.activeNetwork, chainId: 1 };
      view.rerender(<SmartAccountPolicy />);
    } else view.unmount();
    await settle();
    await advance(60000);
    await settle();
    expect(
      mockEmitter.mock.calls.some(
        ([[, name]]) => name === 'finalizeSmartAccountGuardianRecovery'
      )
    ).toBe(false);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  }
);

it('does not read hidden pages and refreshes on becoming visible', async () => {
  let visibility = 'hidden';
  jest
    .spyOn(document, 'visibilityState', 'get')
    .mockImplementation(() => visibility as DocumentVisibilityState);
  render(<SmartAccountPolicy />);
  await settle();
  await advance(60000);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, name]]) => name === 'getSmartAccountGuardianRecoveryStatus'
    )
  ).toHaveLength(0);
  mockChainTimestamp += 60;
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  await settle();
  expect(finalize().disabled).toBe(false);
});

it.each(['de', 'fr'])(
  'reformats observed guardian dates in %s without changing chain readiness or the local intent',
  async (locale) => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const view = render(<SmartAccountPolicy />);
    await settle();
    expect(finalize().disabled).toBe(true);
    mockLocale = locale;
    view.rerender(<SmartAccountPolicy />);
    await settle();
    for (const [key, seconds] of [
      [
        'settings.smartAccountGuardianRecoveryReadyAt',
        NOW.getTime() / 1000 + 60,
      ],
      [
        'settings.smartAccountGuardianExpiresAt',
        NOW.getTime() / 1000 + 60 + 604800,
      ],
      ['settings.smartAccountGuardianObservedAt', mockChainTimestamp],
    ] as const) {
      expect(
        screen.getByText(
          `${key}: ${new Date(seconds * 1000).toLocaleString(locale)}`
        )
      ).toBeTruthy();
    }
    expect(finalize().disabled).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
    expect(
      mockEmitter.mock.calls.some(
        ([[, method]]) => method === 'finalizeSmartAccountGuardianRecovery'
      )
    ).toBe(false);
  }
);

it.each(['de', 'fr'])(
  'formats the chain-not-ready error deadline in %s after a backward local clock change',
  async (locale) => {
    mockLocale = locale;
    mockChainTimestamp += 60;
    jest.setSystemTime(NOW.getTime() - 120000);
    const saved = localStorage.getItem(STORAGE_KEY);
    const read = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path, ...args) =>
      path[1] === 'finalizeSmartAccountGuardianRecovery'
        ? Promise.reject(new Error('PALI_GUARDIAN_RECOVERY_NOT_READY'))
        : read(path, ...args)
    );
    render(<SmartAccountPolicy />);
    await settle();
    expect(finalize().disabled).toBe(false);
    fireEvent.click(finalize());
    await settle();
    await settle();
    expect(mockDateAlert).toHaveBeenCalledWith(
      `settings.smartAccountGuardianRecoveryReadyAt: ${new Date(
        NOW.getTime() + 60000
      ).toLocaleString(locale)}`
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  }
);
