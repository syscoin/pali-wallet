/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockVault: any;
let mockMetadata: any;
let mockScope: any;
let mockResponse: any;
let mockRead: () => Promise<any>;
let mockConnected = true;
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
jest.mock('antd', () => ({
  Form: { Item: ({ children }: any) => <div>{children}</div> },
  Input: 'input',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <span /> }));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Icon: () => <span />,
  ConfirmationModal: () => null,
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
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: !mockConnected,
  }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: jest.fn(),
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('react-redux', () => ({
  useSelector: (fn: any) =>
    fn({ vault: mockVault, vaultGlobal: { activeSlip44: 60 } }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/settings/account/smart-account-policy',
    search: '',
    hash: '',
    key: 'policy',
    state: { id: 1, accountType: 'SmartAccount' },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => mockScope,
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const OWNER = `0x${'22'.repeat(20)}`;
const MODULE = getPaliModuleAddress(57057, 'guardian-recovery');
const OP = `0x${'33'.repeat(32)}`;
const TIME = Math.floor(Date.now() / 1000);
const STORAGE = `pali-smart-account-recovery-replacement:57057:${ACCOUNT}`;
const FINALIZE = 'settings.smartAccountGuardianRecoveryFinalize';
const connected = 'settings.smartAccountGuardianRecoveryConnectedStatus';
const external = 'settings.smartAccountGuardianExternalPending';
const unavailable = 'settings.smartAccountGuardianStatusUnavailable';
const statusCalls = () =>
  mockEmitter.mock.calls.filter(
    (call) => call[0][1] === 'getSmartAccountGuardianRecoveryStatus'
  );
const observation = () => ({
  account: ACCOUNT,
  chainId: 57057,
  moduleAddress: MODULE,
  exists: true,
  delay: '600',
  delaySeconds: 600,
  expirationSeconds: 604800,
  guardianCount: '1',
  guardians: [OWNER],
  threshold: 1,
  policyEpoch: '7',
  observedBlock: { number: 100, hash: OP, timestamp: TIME },
  active: null,
  pending: null,
  knownOperation: null,
});
const pending = (operationId = OP, status = 'pending') => ({
  operationId,
  status,
  scheduledAt: TIME - 100,
  executableAt: TIME + 500,
  expiresAt: TIME + 605300,
});
const local = () => ({
  kind: 'ecdsa',
  authenticator: { id: 'ecdsa', config: { owners: [OWNER], threshold: 1 } },
  recoveryOperation: {
    account: ACCOUNT,
    chainId: 57057,
    recoveryModule: MODULE,
    policyEpoch: '7',
    salt: OP,
    mode: `0x${'00'.repeat(32)}`,
    executionCalldata: '0x1234',
    readyAt: TIME + 999999,
  },
});

beforeEach(() => {
  mockConnected = true;
  jest.clearAllMocks();
  localStorage.clear();
  mockScope = { account: 'account:1', network: 'network:57057' };
  mockMetadata = {
    chainId: 57057,
    isDeployed: true,
    auth: {
      data: '0x',
      module: 'ecdsa',
      validator: getPaliModuleAddress(57057, 'ecdsa'),
    },
    installedModules: [
      {
        id: 'ecdsa',
        type: 'validator',
        address: getPaliModuleAddress(57057, 'ecdsa'),
        config: { owners: [OWNER], threshold: 1 },
      },
      {
        id: 'guardian-recovery',
        type: 'executor',
        address: MODULE,
        config: { guardians: [OWNER], threshold: 1, delaySeconds: 600 },
      },
    ],
  };
  mockVault = {
    accounts: {
      HDAccount: { 0: { id: 0, address: OWNER } },
      SmartAccount: {
        1: {
          id: 1,
          address: ACCOUNT,
          isSmartAccount: true,
          smartAccount: mockMetadata,
        },
      },
    },
    activeAccount: { id: 1, type: 'SmartAccount' },
    activeNetwork: {
      chainId: 57057,
      url: 'https://fixture.invalid',
      label: 'Testnet',
    },
  };
  mockResponse = observation();
  mockRead = async () => mockResponse;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'hydrateSmartAccount') return mockMetadata;
    if (method === 'getWalletSessionGeneration') return 7;
    if (method === 'getSLHDSASmartAccountSetupStatus') return null;
    if (method === 'getSmartAccountGuardianRecoveryStatus') return mockRead();
    if (method === 'getSmartAccountNativeGasStatus')
      return { hasNativeGas: true };
    throw new Error(`Unexpected mutation or method ${method}`);
  });
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('external pending is visible without local credentials and cannot be finalized locally', async () => {
  mockResponse.active = mockResponse.pending = pending();
  render(<SmartAccountPolicy />);
  await screen.findByText(external);
  expect(
    screen.getByText(/smartAccountGuardianRecoveryReadyAt/).textContent
  ).toContain(new Date((TIME + 500) * 1000).toLocaleString());
  expect(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryDisable',
    })
  ).not.toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryContinue',
    })
  );
  expect(
    screen.getByRole('button', { name: FINALIZE }).hasAttribute('disabled')
  ).toBe(true);
  expect(
    screen
      .getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
      .hasAttribute('disabled')
  ).toBe(true);
  expect(localStorage.getItem(STORAGE)).toBeNull();
});

test('failed or unresolved reads never show Connected and have an explicit read-only retry', async () => {
  mockRead = async () => {
    throw new Error('offline');
  };
  render(<SmartAccountPolicy />);
  await waitFor(() =>
    expect(screen.queryAllByText(unavailable).length).toBeGreaterThan(0)
  );
  expect(screen.queryByText(connected)).toBeNull();
  mockRead = async () => observation();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await waitFor(() =>
    expect(screen.queryAllByText(connected).length).toBeGreaterThan(0)
  );
  expect(
    mockEmitter.mock.calls.every((call) => /^(hydrate|get)/.test(call[0][1]))
  ).toBe(true);
});

test.each(['unknown', 'canceled', 'executed', 'inactive', 'expired'])(
  'keeps the exact saved credential and intent for local %s',
  async (status) => {
    const credential = local();
    const saved = JSON.stringify(credential);
    localStorage.setItem(STORAGE, saved);
    mockResponse.knownOperation = {
      ...pending(getGuardianRecoveryOperationId(credential.recoveryOperation)),
      status,
    };
    render(<SmartAccountPolicy />);
    await screen.findByText(
      status === 'unknown'
        ? 'settings.smartAccountGuardianLocalUnresolved'
        : 'settings.smartAccountGuardianLocalResolved'
    );
    expect(localStorage.getItem(STORAGE)).toBe(saved);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getSmartAccountGuardianRecoveryStatus'],
      [
        {
          account: ACCOUNT,
          knownOperationId: getGuardianRecoveryOperationId(
            credential.recoveryOperation
          ),
        },
      ],
      30000
    );
  }
);

test.each(['matching', 'wrong epoch', 'different active'])(
  'finalization uses fresh chain readiness and %s local identity',
  async (kind) => {
    const credential = local();
    localStorage.setItem(STORAGE, JSON.stringify(credential));
    const id = getGuardianRecoveryOperationId(credential.recoveryOperation);
    mockResponse.active = mockResponse.pending = pending(
      kind === 'different active' ? OP : id,
      'ready'
    );
    mockResponse.knownOperation = pending(id, 'ready');
    if (kind === 'wrong epoch') mockResponse.policyEpoch = '8';
    render(<SmartAccountPolicy />);
    await waitFor(() =>
      expect(
        screen.queryAllByText('settings.smartAccountGuardianRecoveryPending')
          .length
      ).toBeGreaterThan(0)
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryContinue',
      })
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: FINALIZE }).hasAttribute('disabled')
      ).toBe(kind !== 'matching')
    );
  }
);

test('retires an old-scope response after changing networks', async () => {
  let release!: (value: any) => void;
  mockRead = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const view = render(<SmartAccountPolicy />);
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  const old = { ...observation(), pending: pending(), active: pending() };
  mockScope = { account: 'account:1', network: 'network:1' };
  mockVault.activeNetwork = { ...mockVault.activeNetwork, chainId: 1 };
  mockMetadata = { ...mockMetadata, chainId: 1 };
  mockVault.accounts.SmartAccount[1].smartAccount = mockMetadata;
  mockRead = async () => ({ ...observation(), chainId: 1 });
  view.rerender(<SmartAccountPolicy />);
  await act(async () => release(old));
  await waitFor(() => expect(statusCalls().length).toBeGreaterThan(1));
  expect(screen.queryByText(external)).toBeNull();
});

test('visible polling detects later recovery without overlapping a pending read', async () => {
  jest.useFakeTimers();
  let release!: (value: any) => void;
  mockRead = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  render(<SmartAccountPolicy />);
  await act(async () => undefined);
  expect(statusCalls()).toHaveLength(1);
  await act(async () => jest.advanceTimersByTime(60000));
  expect(statusCalls()).toHaveLength(1);
  await act(async () => release(observation()));
  mockRead = async () => ({
    ...observation(),
    active: pending(),
    pending: pending(),
  });
  await act(async () => jest.advanceTimersByTime(30000));
  expect(screen.getByText(external)).not.toBeNull();
});

test('owner disable remains available while the status read is unresolved', async () => {
  mockRead = () => new Promise(() => undefined);
  render(<SmartAccountPolicy />);
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  const disable = screen.getByRole('button', {
    name: 'settings.smartAccountGuardianRecoveryDisable',
  });
  expect(disable.hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(connected)).toBeNull();
});

test('a failed refresh retains a last-known-pending warning without trusting it for finalization', async () => {
  mockResponse.active = mockResponse.pending = pending();
  render(<SmartAccountPolicy />);
  await screen.findByText(external);
  mockRead = async () => {
    throw new Error('offline');
  };
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await screen.findByText('settings.smartAccountGuardianLastKnownPending');
  expect(screen.queryByText(connected)).toBeNull();
  expect(screen.queryByText(external)).toBeNull();
  expect(
    screen
      .getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryDisable',
      })
      .hasAttribute('disabled')
  ).toBe(false);
});

test('a held retry never restores Connected from a snapshot whose refresh failed', async () => {
  render(<SmartAccountPolicy />);
  await screen.findByText(connected);
  mockRead = async () => {
    throw new Error('offline');
  };
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await screen.findByText(unavailable);
  let release!: (value: any) => void;
  mockRead = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRefreshStatus',
    })
  );
  await waitFor(() => expect(statusCalls()).toHaveLength(3));
  expect(screen.queryByText(connected)).toBeNull();
  expect(screen.getByText(unavailable)).not.toBeNull();
  await act(async () => release(observation()));
  await screen.findByText(connected);
});

test.each(['RPC', 'session'])(
  'hides a prior same-account observation synchronously after %s changes',
  async (axis) => {
    mockResponse.active = mockResponse.pending = pending();
    const view = render(<SmartAccountPolicy />);
    await screen.findByText(external);
    let release!: (value: any) => void;
    mockRead = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    if (axis === 'RPC') mockVault.activeNetwork.url = 'https://changed.invalid';
    else mockConnected = false;
    view.rerender(<SmartAccountPolicy />);
    expect(screen.queryByText(external)).toBeNull();
    if (axis === 'session') {
      mockConnected = true;
      view.rerender(<SmartAccountPolicy />);
      expect(screen.queryByText(external)).toBeNull();
    }
    await waitFor(() => expect(statusCalls().length).toBeGreaterThan(1));
    await act(async () => release(observation()));
    expect(screen.queryByText(external)).toBeNull();
  }
);
