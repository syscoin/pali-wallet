/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import {
  acknowledgedGuardianRecoveryClaim,
  guardianRecoveryFixture,
  releasedGuardianRecoveryRecord,
} from 'tests/fixtures/guardianRecoveryClaim';

import {
  createPasskeyCredential,
  signP256WebAuthnActionHash,
  setActivePasskeyRecord,
  toP256WebAuthnRecoveryTarget,
} from 'utils/passkey';
import { encodeEcdsaValidatorInitData } from 'utils/smartAccount/account';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import {
  captureGuardianRecoveryClaim,
  guardianRecoveryReplacementApplied,
} from 'utils/smartAccount/guardianRecoveryClaim';
import { captureGuardianRecoveryIntent } from 'utils/smartAccount/guardianRecoveryIntent';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';
import { buildSmartAccountGuardianRecoveryOperation } from 'utils/smartAccount/recovery';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockVault: any;
let mockMetadata: any;
let mockScope: any;
let mockResponse: any;
let mockRead: () => Promise<any>;
let mockConnected = true;
const mockEmitter = jest.fn();
const mockControllerEmitter = async (
  path: string[],
  payload: any[] = [],
  ...rest: any[]
) => {
  const response = await mockEmitter(path, payload, ...rest);
  if (path[1] === 'prepareSmartAccountGuardianStartRecovery') {
    const claim = acknowledgedGuardianRecoveryClaim(payload[0], response);
    const metadata = mockVault.accounts.SmartAccount[1].smartAccount;
    if (
      (metadata.guardianRecoveryClaim?.intent.operation.hash ?? null) !==
      payload[0].expectedClaimHash
    )
      throw new Error('Guardian recovery claim changed');
    mockVault.accounts.SmartAccount[1].smartAccount = mockMetadata = {
      ...metadata,
      guardianRecoveryClaim: claim,
    };
    return { ...response, claim };
  }
  if (path[1] === 'retireSmartAccountGuardianRecovery') {
    const metadata = mockVault.accounts.SmartAccount[1].smartAccount;
    if (
      metadata.guardianRecoveryClaim?.intent.operation.hash ===
      payload[0].expectedClaimHash
    )
      mockVault.accounts.SmartAccount[1].smartAccount = mockMetadata = {
        ...metadata,
        guardianRecoveryClaim: undefined,
        guardianRecoveryReplacement: metadata.guardianRecoveryClaim.replacement,
      };
  }
  return response;
};
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
    controllerEmitter: mockControllerEmitter,
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
jest.mock('utils/passkey', () => ({
  ...jest.requireActual('utils/passkey'),
  createPasskeyCredential: jest.fn(),
  signP256WebAuthnActionHash: jest.fn(),
  setActivePasskeyRecord: jest.fn(() => true),
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
const local = () => {
  const record = releasedGuardianRecoveryRecord(
    guardianRecoveryFixture(ACCOUNT, OWNER, 57057, OP).claim
  );
  return {
    ...record,
    recoveryOperation: { ...record.recoveryOperation, readyAt: TIME + 999999 },
  };
};

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
    if (method === 'retireSmartAccountGuardianRecovery') return {};
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

test('entry and focus detect recovery without idle polling or overlapping a pending read', async () => {
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
  await act(async () => {
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
  });
  expect(statusCalls()).toHaveLength(1);
  await act(async () => release(observation()));
  mockRead = async () => ({
    ...observation(),
    active: pending(),
    pending: pending(),
  });
  await act(async () => jest.advanceTimersByTime(300000));
  expect(statusCalls()).toHaveLength(1);
  await act(async () => fireEvent.focus(window));
  expect(statusCalls()).toHaveLength(2);
  expect(screen.getByText(external)).not.toBeNull();
});

test('manual and visible-entry refreshes read once, while hidden pages make no request', async () => {
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  render(<SmartAccountPolicy />);
  await act(async () => undefined);
  expect(statusCalls()).toHaveLength(0);
  await act(async () => {
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
  });
  expect(statusCalls()).toHaveLength(0);
  visibility.mockReturnValue('visible');
  await act(async () => fireEvent(document, new Event('visibilitychange')));
  await screen.findByText(connected);
  expect(statusCalls()).toHaveLength(1);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRefreshStatus',
      })
    );
  });
  expect(statusCalls()).toHaveLength(2);
  visibility.mockReturnValue('hidden');
  await act(async () => {
    fireEvent.focus(window);
    fireEvent(document, new Event('visibilitychange'));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRefreshStatus',
      })
    );
  });
  expect(statusCalls()).toHaveLength(2);
  visibility.mockReturnValue('visible');
  await act(async () => fireEvent(document, new Event('visibilitychange')));
  expect(statusCalls()).toHaveLength(3);
});

test.each([
  'pending',
  'active without pending',
  'failed',
  'account',
  'chain',
  'module',
  'uninstalled',
  'threshold',
  'guardians',
  'zero guardian',
  'invalid delay',
])(
  'Start rejects a fresh %s observation before approval or passkey creation',
  async (kind) => {
    render(<SmartAccountPolicy />);
    await screen.findByText(connected);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryShowOptions',
      })
    );
    const next = observation();
    if (kind === 'pending') next.active = next.pending = pending() as any;
    if (kind === 'active without pending') next.active = pending() as any;
    if (kind === 'account') next.account = OWNER;
    if (kind === 'chain') next.chainId = 1;
    if (kind === 'module') next.moduleAddress = OWNER;
    if (kind === 'uninstalled') next.exists = false;
    if (kind === 'threshold') next.threshold = 2;
    if (kind === 'guardians') next.guardians = [OWNER, ACCOUNT];
    if (kind === 'zero guardian')
      next.guardians = ['0x0000000000000000000000000000000000000000'];
    if (kind === 'invalid delay') next.delay = 'NaN';
    mockRead = async () => {
      if (kind === 'failed') throw new Error('offline');
      return next;
    };
    mockEmitter.mockClear();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
    );
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
    expect(statusCalls()).toHaveLength(1);
    expect(
      mockEmitter.mock.calls.some(
        (call) => call[0][1] === 'getWalletSessionGeneration'
      )
    ).toBe(false);
    expect(
      mockEmitter.mock.calls.some((call) =>
        /^(prepare|submit|sign)/.test(call[0][1])
      )
    ).toBe(false);
    expect(createPasskeyCredential).not.toHaveBeenCalled();
    expect(signP256WebAuthnActionHash).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE)).toBeNull();
    if (kind === 'pending') expect(screen.getByText(external)).not.toBeNull();
    else if (kind === 'active without pending')
      expect(mockAlert.error).toHaveBeenCalledWith(
        'settings.smartAccountGuardianRecoveryAlreadyStarted'
      );
    else expect(screen.getByText(unavailable)).not.toBeNull();
  }
);

test('Start uses the freshly read guardian and delay instead of the displayed policy', async () => {
  render(<SmartAccountPolicy />);
  await screen.findByText(connected);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  );
  fireEvent.click(
    screen.getByRole('button', { name: /settings.ecdsaAuthenticator/ })
  );
  fireEvent.change(
    screen.getByPlaceholderText('settings.recoveryAuthenticatorEcdsaOwner'),
    { target: { value: OWNER } }
  );
  const freshGuardian = `0x${'44'.repeat(20)}`;
  mockRead = async () => ({
    ...observation(),
    guardians: [freshGuardian],
    delay: '7200',
    delaySeconds: 7200,
  });
  const original = mockEmitter.getMockImplementation()!;
  const operation = buildSmartAccountGuardianRecoveryOperation({
    account: ACCOUNT,
    chainId: 57057,
    policyEpoch: '7',
    recoveryModule: MODULE,
    salt: OP,
    target: {
      auth: {
        module: 'ecdsa',
        validator: getPaliModuleAddress(57057, 'ecdsa'),
        data: encodeEcdsaValidatorInitData([OWNER], 1),
      },
    },
  });
  mockEmitter.mockImplementation(async (path: string[], ...args: any[]) => {
    if (path[1] === 'prepareSmartAccountGuardianStartRecovery')
      return {
        approval: { guardian: freshGuardian, signature: '0x1234' },
        operation,
      };
    if (path[1] === 'submitPreparedSmartAccountGuardianStartRecovery')
      return { operation };
    return original(path, ...args);
  });
  mockEmitter.mockClear();
  const before = Math.floor(Date.now() / 1000);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryStart',
    })
  );
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.smartAccountGuardianRecoveryStarted'
    )
  );
  const methods = mockEmitter.mock.calls.map((call) => call[0][1]);
  expect(methods[0]).toBe('getSmartAccountGuardianRecoveryStatus');
  expect(methods[1]).toBe('getWalletSessionGeneration');
  for (const method of [
    'prepareSmartAccountGuardianStartRecovery',
    'submitPreparedSmartAccountGuardianStartRecovery',
  ]) {
    expect(
      mockEmitter.mock.calls.find((call) => call[0][1] === method)?.[1][0]
        .guardian
    ).toBe(freshGuardian);
  }
  const saved =
    mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim;
  expect(saved.readyAt).toBeGreaterThanOrEqual(before + 7200);
  expect(saved.readyAt).toBeLessThanOrEqual(
    Math.floor(Date.now() / 1000) + 7200
  );
  expect(createPasskeyCredential).not.toHaveBeenCalled();
});

test('Start ignores a fresh observation if the account changes while it is in flight', async () => {
  const view = render(<SmartAccountPolicy />);
  await screen.findByText(connected);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  );
  let release!: (value: any) => void;
  mockRead = () => new Promise((resolve) => (release = resolve));
  mockEmitter.mockClear();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryStart',
    })
  );
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  const completeStartRead = release;
  mockScope = { account: 'account:2', network: 'network:57057' };
  mockVault.accounts.SmartAccount[1].address = OWNER;
  view.rerender(<SmartAccountPolicy />);
  await act(async () => completeStartRead(observation()));
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'getWalletSessionGeneration'
    )
  ).toBe(false);
  expect(createPasskeyCredential).not.toHaveBeenCalled();
  expect(signP256WebAuthnActionHash).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE)).toBeNull();
});

test('owner disable remains available while the status read is unresolved', async () => {
  mockRead = () => new Promise(() => undefined);
  render(<SmartAccountPolicy />);
  await waitFor(() => expect(statusCalls()).toHaveLength(1));
  const disable = await screen.findByRole('button', {
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

const canonicalLocal = () => {
  const recoveryTarget = {
    auth: {
      module: 'ecdsa' as const,
      validator: getPaliModuleAddress(57057, 'ecdsa'),
      data: encodeEcdsaValidatorInitData([OWNER], 1),
    },
  };
  const intent = captureGuardianRecoveryIntent({
    operation: buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: 57057,
      policyEpoch: '7',
      recoveryModule: MODULE,
      salt: OP,
      target: recoveryTarget,
    }),
    target: recoveryTarget,
  });
  return {
    ...local(),
    guardian: OWNER,
    guardianApproval: 'ecdsa',
    recoveryTarget: intent.target,
    recoveryOperation: {
      ...intent.operation,
      readyAt: TIME + 600,
    },
  };
};
const showStart = async () => {
  await screen.findByText(connected);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  );
  fireEvent.click(
    screen.getByRole('button', { name: /settings.ecdsaAuthenticator/ })
  );
  fireEvent.change(
    screen.getByPlaceholderText('settings.recoveryAuthenticatorEcdsaOwner'),
    { target: { value: OWNER } }
  );
};
const showSaved = async () => {
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryContinue',
    })
  );
};
const installRecoveryTransport = (submit: (payload: any) => Promise<any>) => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(
    async (path: string[], payload: any[] = []) => {
      if (path[1] === 'prepareSmartAccountGuardianStartRecovery')
        return {
          approval: { guardian: OWNER, signature: '0x1234' },
          operation:
            payload[0].operation ??
            buildSmartAccountGuardianRecoveryOperation({
              account: ACCOUNT,
              chainId: 57057,
              policyEpoch: '7',
              recoveryModule: MODULE,
              salt: OP,
              target: payload[0].target,
            }),
        };
      if (path[1] === 'submitPreparedSmartAccountGuardianStartRecovery')
        return submit(payload[0]);
      if (path[1] === 'finalizeSmartAccountGuardianRecovery') return {};
      return original(path, payload);
    }
  );
};

test.each(['lost reply', 'popup closes'])(
  'persists before transport and resumes normal finalize after %s',
  async (failure) => {
    let entered = false;
    installRecoveryTransport(async ({ operation }) => {
      const saved =
        mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim;
      expect(saved.intent.operation).toMatchObject(operation);
      expect(saved.intent.target.auth.data).toBe(
        encodeEcdsaValidatorInitData([OWNER], 1)
      );
      expect(saved.replacement.authenticator.config.owners).toEqual([OWNER]);
      entered = true;
      if (failure === 'popup closes') return new Promise(() => undefined);
      throw new Error('Scheduling reply lost after acceptance');
    });
    const view = render(<SmartAccountPolicy />);
    await showStart();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
    );
    await waitFor(() => expect(entered).toBe(true));
    const saved =
      mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim;
    view.unmount();
    const id = getGuardianRecoveryOperationId(saved.intent.operation);
    mockResponse = {
      ...observation(),
      active: pending(id, 'ready'),
      pending: pending(id, 'ready'),
      knownOperation: pending(id, 'ready'),
      recoveryTransactionHash: null,
    };
    render(<SmartAccountPolicy />);
    await showSaved();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: FINALIZE }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: FINALIZE }));
    await waitFor(() =>
      expect(mockAlert.success).toHaveBeenCalledWith(
        'settings.smartAccountGuardianRecoveryFinalized'
      )
    );
    expect(
      mockEmitter.mock.calls.find(
        (call) => call[0][1] === 'finalizeSmartAccountGuardianRecovery'
      )![1][0]
    ).toMatchObject({ claim: saved });
    expect(
      mockEmitter.mock.calls.filter(
        (call) =>
          call[0][1] === 'submitPreparedSmartAccountGuardianStartRecovery'
      )
    ).toHaveLength(1);
    expect(createPasskeyCredential).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE)).toBeNull();
  }
);

test('safe unsent retry reuses the exact canonical intent and ignores operation fields in the reply', async () => {
  const saved = canonicalLocal();
  localStorage.setItem(STORAGE, JSON.stringify(saved));
  const id = getGuardianRecoveryOperationId(saved.recoveryOperation);
  mockResponse = {
    ...observation(),
    knownOperation: { ...pending(id), status: 'unknown' },
    recoveryTransactionHash: null,
  };
  installRecoveryTransport(async () => ({
    operation: {
      ...saved.recoveryOperation,
      account: OWNER,
      salt: `0x${'99'.repeat(32)}`,
    },
  }));
  render(<SmartAccountPolicy />);
  await showSaved();
  const start = screen.getByRole('button', {
    name: 'settings.smartAccountGuardianRecoveryStart',
  });
  await waitFor(() =>
    expect((start as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(start);
  await waitFor(() =>
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.smartAccountGuardianRecoveryStarted'
    )
  );
  const prepared = mockEmitter.mock.calls.find(
    (call) => call[0][1] === 'prepareSmartAccountGuardianStartRecovery'
  )![1][0];
  expect(prepared.operation).toEqual(
    captureGuardianRecoveryIntent({
      operation: saved.recoveryOperation,
      target: saved.recoveryTarget,
    }).operation
  );
  expect(prepared.target).toEqual(
    expect.objectContaining({
      auth: expect.objectContaining({ data: saved.recoveryTarget.auth.data }),
    })
  );
  expect(JSON.parse(localStorage.getItem(STORAGE)!)).toMatchObject(saved);
  expect(createPasskeyCredential).not.toHaveBeenCalled();
});

test('a retained unknown scheduling attempt cannot authorize a second send or finalize', async () => {
  const saved = canonicalLocal();
  localStorage.setItem(STORAGE, JSON.stringify(saved));
  const id = getGuardianRecoveryOperationId(saved.recoveryOperation);
  mockResponse = {
    ...observation(),
    active: pending(id, 'ready'),
    pending: pending(id, 'ready'),
    knownOperation: pending(id, 'ready'),
    recoveryTransactionHash: `0x${'88'.repeat(32)}`,
  };
  render(<SmartAccountPolicy />);
  await showSaved();
  await waitFor(() => expect(statusCalls().length).toBeGreaterThan(0));
  expect(
    (screen.getByRole('button', { name: FINALIZE }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  expect(localStorage.getItem(STORAGE)).toBe(JSON.stringify(saved));
  expect(
    mockEmitter.mock.calls.some((call) =>
      /^(prepare|submit|sign|finalize)/.test(call[0][1])
    )
  ).toBe(false);
});

test.each(['account', 'chain'])(
  'a restart in another %s cannot load or submit the saved intent',
  async (axis) => {
    const saved = JSON.stringify(canonicalLocal());
    localStorage.setItem(STORAGE, saved);
    if (axis === 'account') mockVault.accounts.SmartAccount[1].address = OWNER;
    else mockVault.activeNetwork.chainId = mockMetadata.chainId = 1;
    mockScope = {
      account: axis === 'account' ? 'account:2' : 'account:1',
      network: axis === 'chain' ? 'network:1' : 'network:57057',
    };
    mockResponse = {
      ...observation(),
      account: axis === 'account' ? OWNER : ACCOUNT,
      chainId: axis === 'chain' ? 1 : 57057,
    };
    render(<SmartAccountPolicy />);
    await waitFor(() => expect(statusCalls().length).toBeGreaterThan(0));
    expect(statusCalls().every((call) => call[1][0].intent === undefined)).toBe(
      true
    );
    expect(
      mockEmitter.mock.calls.some((call) =>
        /^(prepare|submit|sign|finalize)/.test(call[0][1])
      )
    ).toBe(false);
    expect(localStorage.getItem(STORAGE)).toBe(saved);
  }
);

test('failed intent persistence prevents scheduling transport', async () => {
  installRecoveryTransport(async () => {
    throw new Error('Must never dispatch');
  });
  render(<SmartAccountPolicy />);
  await showStart();
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path: string[], ...args: any[]) =>
    path[1] === 'prepareSmartAccountGuardianStartRecovery'
      ? Promise.reject(new Error('Claim persistence refused'))
      : original(path, ...args)
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryStart',
    })
  );
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(
    mockEmitter.mock.calls.some(
      (call) => call[0][1] === 'submitPreparedSmartAccountGuardianStartRecovery'
    )
  ).toBe(false);
});

test('retrying the saved passkey requires possession and retains the intent when that proof fails', async () => {
  const publicKey = {
    originHash: OP,
    originLength: 16,
    rpIdHash: OP,
    x: `0x${'55'.repeat(32)}`,
    y: `0x${'66'.repeat(32)}`,
  };
  const target = toP256WebAuthnRecoveryTarget({
    validator: getPaliModuleAddress(57057, 'p256-webauthn'),
    ...publicKey,
  });
  const intent = captureGuardianRecoveryIntent({
    operation: buildSmartAccountGuardianRecoveryOperation({
      account: ACCOUNT,
      chainId: 57057,
      policyEpoch: '7',
      recoveryModule: MODULE,
      salt: OP,
      target,
    }),
    target,
  });
  const saved = {
    kind: 'p256-webauthn',
    guardian: OWNER,
    guardianApproval: 'ecdsa',
    authenticator: {
      id: 'p256-webauthn',
      config: {
        publicKey,
        credentialId: 'stored-passkey',
        credentialIdHash: OP,
      },
    },
    credentialId: 'stored-passkey',
    credentialIdHash: OP,
    recoveryTarget: intent.target,
    recoveryOperation: { ...intent.operation, readyAt: TIME + 600 },
  };
  localStorage.setItem(STORAGE, JSON.stringify(saved));
  mockResponse = {
    ...observation(),
    knownOperation: {
      ...pending(getGuardianRecoveryOperationId(intent.operation)),
      status: 'unknown',
    },
    recoveryTransactionHash: null,
  };
  (signP256WebAuthnActionHash as jest.Mock).mockRejectedValueOnce(
    new Error('Credential unavailable')
  );
  render(<SmartAccountPolicy />);
  await showSaved();
  const start = screen.getByRole('button', {
    name: 'settings.smartAccountGuardianRecoveryStart',
  });
  await waitFor(() =>
    expect((start as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(start);
  await waitFor(() => expect(signP256WebAuthnActionHash).toHaveBeenCalled());
  expect(signP256WebAuthnActionHash).toHaveBeenCalledWith(
    expect.objectContaining({
      actionHash: intent.operation.hash,
      credentialId: 'stored-passkey',
      expectedPublicKey: publicKey,
    })
  );
  expect(createPasskeyCredential).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.some((call) => /^(prepare|submit)/.test(call[0][1]))
  ).toBe(false);
  expect(localStorage.getItem(STORAGE)).toBe(JSON.stringify(saved));
});

test('an unsent claim from an older policy epoch can be retired on reopen without losing its replacement', async () => {
  installRecoveryTransport(async () => {
    mockResponse = {
      ...observation(),
      policyEpoch: '8',
      recoveryTransactionHash: null,
      knownOperation: {
        ...pending(
          getGuardianRecoveryOperationId(
            mockVault.accounts.SmartAccount[1].smartAccount
              .guardianRecoveryClaim.intent.operation
          )
        ),
        status: 'unknown',
      },
    };
    throw new Error('PALI_GUARDIAN_RECOVERY_POLICY_CHANGED');
  });
  const view = render(<SmartAccountPolicy />);
  await showStart();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryStart',
    })
  );
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  const claim =
    mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim;
  expect(claim.intent.operation.policyEpoch).toBe('7');
  view.unmount();
  render(<SmartAccountPolicy />);
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'settings.smartAccountGuardianRecoveryStart',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  expect(
    mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim
      .replacement
  ).toEqual(claim.replacement);
});

test('two Settings views cannot replace the intent whose scheduling transaction was accepted', async () => {
  const original = mockEmitter.getMockImplementation()!;
  let releaseSecond!: (value: any) => void;
  let prepared = 0,
    accepted: any;
  mockEmitter.mockImplementation(
    async (path: string[], payload: any[] = []) => {
      if (path[1] === 'prepareSmartAccountGuardianStartRecovery') {
        const operation = buildSmartAccountGuardianRecoveryOperation({
          account: ACCOUNT,
          chainId: 57057,
          policyEpoch: '7',
          recoveryModule: MODULE,
          salt: `0x${(++prepared === 1 ? '71' : '72').repeat(32)}`,
          target: payload[0].target,
        });
        const response = {
          approval: { guardian: OWNER, signature: '0x1234' },
          operation,
        };
        if (prepared === 2)
          return new Promise((resolve) => {
            releaseSecond = resolve;
          }).then(() => response);
        return response;
      }
      if (path[1] === 'submitPreparedSmartAccountGuardianStartRecovery') {
        if (accepted)
          throw new Error('PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED');
        accepted = payload[0].operation;
        return { operation: accepted };
      }
      return original(path, payload);
    }
  );
  const first = render(<SmartAccountPolicy />),
    second = render(<SmartAccountPolicy />);
  const open = async (view: typeof first) => {
    const q = within(view.container);
    await waitFor(() =>
      expect(q.queryAllByText(connected).length).toBeGreaterThan(0)
    );
    fireEvent.click(
      q.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryShowOptions',
      })
    );
    fireEvent.click(
      q.getByRole('button', { name: /settings.ecdsaAuthenticator/ })
    );
    fireEvent.change(
      q.getByPlaceholderText('settings.recoveryAuthenticatorEcdsaOwner'),
      { target: { value: OWNER } }
    );
  };
  await open(first);
  await open(second);
  act(() => {
    fireEvent.click(
      within(first.container).getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
    );
    fireEvent.click(
      within(second.container).getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
    );
  });
  await waitFor(() => expect(accepted).toBeDefined());
  await act(async () => releaseSecond(undefined));
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(
    mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim.intent
      .operation.hash
  ).toBe(accepted.hash);
  expect(localStorage.getItem(STORAGE)).toBeNull();
});

const executedPasskeyClaim = () => {
  const publicKey = {
    originHash: OP,
    originLength: 16,
    rpIdHash: OP,
    x: `0x${'55'.repeat(32)}`,
    y: `0x${'66'.repeat(32)}`,
  };
  const target = toP256WebAuthnRecoveryTarget({
    validator: getPaliModuleAddress(57057, 'p256-webauthn'),
    ...publicKey,
  });
  const replacement = {
    kind: 'p256-webauthn' as const,
    credentialId: 'saved-recovery-passkey',
    credentialIdHash: OP,
    authenticator: {
      id: 'p256-webauthn' as const,
      config: {
        credentialId: 'saved-recovery-passkey',
        credentialIdHash: OP,
        passkeyName: 'Replacement',
        publicKey,
      },
    },
  };
  return captureGuardianRecoveryClaim({
    intent: {
      operation: buildSmartAccountGuardianRecoveryOperation({
        account: ACCOUNT,
        chainId: 57057,
        policyEpoch: '7',
        recoveryModule: MODULE,
        salt: OP,
        target,
      }),
      target,
    },
    guardian: { kind: 'ecdsa', guardian: OWNER },
    replacement,
    readyAt: TIME + 600,
  });
};

test.each(['replacement active', 'owner changed after execution'])(
  'lost finalize reply reopens an explicit local Finish action with %s',
  async (mode) => {
    const claim = executedPasskeyClaim(),
      id = getGuardianRecoveryOperationId(claim.intent.operation);
    mockVault.accounts.SmartAccount[1].smartAccount = mockMetadata = {
      ...mockMetadata,
      guardianRecoveryClaim: claim,
    };
    mockResponse = {
      ...observation(),
      pending: pending(id, 'ready'),
      active: pending(id, 'ready'),
      knownOperation: pending(id, 'ready'),
      recoveryTransactionHash: null,
    };
    const original = mockEmitter.getMockImplementation()!;
    let finalizeCalls = 0;
    mockEmitter.mockImplementation(
      async (path: string[], payload: any[] = []) => {
        if (path[1] === 'finalizeSmartAccountGuardianRecovery') {
          finalizeCalls++;
          mockResponse = {
            ...observation(),
            pending: null,
            active: null,
            knownOperation: { ...pending(id), status: 'executed' },
            recoveryTransactionHash: null,
          };
          throw new Error('Finalize reply lost after execution');
        }
        if (path[1] === 'reconcileSmartAccountGuardianRecovery') {
          expect(payload[0].expectedClaimHash).toBe(
            claim.intent.operation.hash
          );
          if (!guardianRecoveryReplacementApplied(claim, mockMetadata))
            throw new Error('Guardian recovery replacement is not active');
          return mockMetadata;
        }
        return original(path, payload);
      }
    );
    const view = render(<SmartAccountPolicy />);
    await showSaved();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: FINALIZE }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: FINALIZE }));
    await waitFor(() => expect(finalizeCalls).toBe(1));
    view.unmount();
    if (mode === 'replacement active') {
      mockMetadata = {
        ...mockMetadata,
        auth: claim.intent.target.auth,
        installedModules: [
          ...mockMetadata.installedModules,
          {
            id: 'p256-webauthn',
            type: 'validator',
            address: claim.intent.target.auth.validator,
          },
        ],
      };
      mockVault.accounts.SmartAccount[1].smartAccount = mockMetadata;
    }
    mockAlert.error.mockClear();
    render(<SmartAccountPolicy />);
    await showSaved();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: FINALIZE }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: FINALIZE }));
    if (mode === 'replacement active') {
      await waitFor(() =>
        expect(mockAlert.success).toHaveBeenCalledWith(
          'settings.smartAccountGuardianRecoveryFinalized'
        )
      );
      const retire = mockEmitter.mock.calls.find(
        (call) => call[0][1] === 'retireSmartAccountGuardianRecovery'
      )![1][0];
      const reconcile = mockEmitter.mock.calls.find(
        (call) => call[0][1] === 'reconcileSmartAccountGuardianRecovery'
      )![1][0];
      expect(retire.expectedContext).toEqual(reconcile.expectedContext);
      expect(retire.expectedContext.sessionGeneration).toBe(7);
      expect(setActivePasskeyRecord).toHaveBeenCalledWith(
        ACCOUNT,
        expect.objectContaining({
          credentialId: claim.replacement.credentialId,
          credentialIdHash: claim.replacement.credentialIdHash,
        })
      );
      expect(
        mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim
      ).toBeUndefined();
      expect(
        mockVault.accounts.SmartAccount[1].smartAccount
          .guardianRecoveryReplacement
      ).toEqual(claim.replacement);
    } else {
      await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
      expect(setActivePasskeyRecord).not.toHaveBeenCalled();
      expect(
        mockEmitter.mock.calls.some(
          (call) => call[0][1] === 'retireSmartAccountGuardianRecovery'
        )
      ).toBe(false);
      expect(
        mockVault.accounts.SmartAccount[1].smartAccount.guardianRecoveryClaim
      ).toEqual(claim);
    }
    expect(finalizeCalls).toBe(1);
    expect(
      mockEmitter.mock.calls.filter(
        (call) => call[0][1] === 'reconcileSmartAccountGuardianRecovery'
      )
    ).toHaveLength(1);
    expect(createPasskeyCredential).not.toHaveBeenCalled();
    expect(signP256WebAuthnActionHash).not.toHaveBeenCalled();
  }
);
