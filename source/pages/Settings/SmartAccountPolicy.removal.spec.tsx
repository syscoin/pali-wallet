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

import { KeyringAccountType } from 'types/network';
import {
  getPaliModuleAddress,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockVault: any;
let mockLocation: any;
let mockScope: any;
let mockGeneration: number;
let mockMetadata: any;
let mockReadbackFails: boolean;
let mockModal: any;
const mockSubmit = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };

jest.mock('antd', () => ({
  Form: { Item: ({ children }: any) => <div>{children}</div> },
  Input: 'input',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <span /> }));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Icon: () => <span />,
  ConfirmationModal: (props: any) => {
    if (!props.show) return null;
    mockModal = props;
    return (
      <div role="dialog" aria-label={props.title}>
        <p>{props.description}</p>
        {props.children}
        <button disabled={props.isButtonLoading} onClick={props.onClick}>
          {props.buttonText}
        </button>
        <button disabled={props.isButtonLoading} onClick={props.onClose}>
          Close confirmation
        </button>
      </div>
    );
  },
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
    connectionUnavailable: false,
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
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  signAndSubmitSmartAccountExecutions: (params: any) => mockSubmit(params),
}));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const MODULE = '0x8888888888888888888888888888888888888888';
const SALT = `0x${'ab'.repeat(32)}`;
const REMOVE = 'settings.smartAccountGuardianRecoveryDisable';
const CONFIRM = 'settings.smartAccountGuardianRecoveryDisableConfirmTitle';
const CHECK = 'settings.smartAccountGuardianRecoveryCheckRemoval';
const PENDING = 'settings.smartAccountGuardianRecoveryDisableUnverified';
const DISABLED = 'settings.smartAccountGuardianRecoveryDisabled';
const storageKey = (account = ACCOUNT) =>
  `pali-smart-account-recovery-replacement:57057:${account}`;
const removalKey = `pali-smart-account-recovery-disable:57057:${ACCOUNT}`;

function metadata(chainId = 57057, installed = true) {
  return {
    chainId,
    isDeployed: true,
    auth: {
      data: '0x',
      module: 'ecdsa',
      validator: getPaliModuleAddress(chainId, 'ecdsa'),
    },
    installedModules: [
      {
        id: 'ecdsa',
        type: 'validator',
        address: getPaliModuleAddress(chainId, 'ecdsa'),
        config: { owners: [OWNER], threshold: 1 },
      },
      ...(installed
        ? [
            {
              id: 'guardian-recovery',
              type: 'executor',
              address: MODULE,
              config: { delaySeconds: 600, guardians: [OTHER], threshold: 1 },
            },
          ]
        : []),
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockModal = null;
  mockReadbackFails = false;
  mockGeneration = 7;
  mockScope = { account: 'account:1', network: 'network:57057' };
  mockLocation = {
    pathname: '/settings/account/smart-account-policy',
    search: '',
    hash: '',
    key: 'policy',
    state: { id: 1, accountType: KeyringAccountType.SmartAccount },
  };
  window.history.replaceState(
    { key: 'policy' },
    '',
    '/#/settings/account/smart-account-policy'
  );
  mockMetadata = metadata();
  mockVault = {
    accounts: {
      [KeyringAccountType.HDAccount]: { 0: { id: 0, address: OWNER } },
      [KeyringAccountType.SmartAccount]: {
        1: {
          id: 1,
          label: 'Savings',
          address: ACCOUNT,
          isSmartAccount: true,
          smartAccount: mockMetadata,
        },
      },
    },
    activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
    activeNetwork: {
      chainId: 57057,
      url: 'https://synthetic.invalid',
      label: 'zkTanenbaum',
    },
  };
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getWalletSessionGeneration') return mockGeneration;
    if (method === 'hydrateSmartAccount') {
      if (mockReadbackFails) throw new Error('RPC unavailable');
      return mockMetadata;
    }
    if (method === 'getSLHDSASmartAccountSetupStatus') return null;
    if (method === 'getSmartAccountGuardianRecoveryStatus')
      return {
        delay: '600',
        exists: true,
        guardians: [OTHER],
        threshold: 1,
        moduleAddress: MODULE,
      };
    if (method === 'getSmartAccountNativeGasStatus')
      return { hasNativeGas: true };
    throw new Error(`Unexpected method ${method}`);
  });
  mockSubmit.mockImplementation(async (params: any) => {
    params.onPrepared?.();
    await params.onBeforeSubmit?.();
    mockMetadata = metadata(57057, false);
    return { hash: `0x${'de'.repeat(32)}` };
  });
});
afterEach(cleanup);

async function openConfirmation() {
  fireEvent.click(await screen.findByRole('button', { name: REMOVE }));
  await screen.findByRole('dialog', { name: CONFIRM });
}
async function confirm() {
  fireEvent.click(screen.getByRole('dialog').querySelector('button')!);
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
}

test('requires explicit confirmation and freezes exact account, network and installed module', async () => {
  render(<SmartAccountPolicy />);
  await openConfirmation();
  expect(mockSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').textContent).toContain(ACCOUNT);
  expect(screen.getByRole('dialog').textContent).toContain('Savings');
  expect(screen.getByRole('dialog').textContent).toContain('zkTanenbaum');
  await confirm();
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledWith(DISABLED));
  const params = mockSubmit.mock.calls[0][0];
  expect(params.accountAddress).toBe(ACCOUNT);
  expect(params.expectedContext.account.id).toBe(1);
  expect(params.expectedContext.chainId).toBe(57057);
  expect(params.waitForConfirmation).toBe(true);
  expect(params.executions).toHaveLength(1);
  const execution = params.executions[0];
  expect(execution.target).toBe(ACCOUNT);
  const decoded = paliSmartAccountInterface.decodeFunctionData(
    'uninstallModule',
    execution.data
  );
  expect(String(decoded[0])).toBe('2');
  expect(decoded[1]).toBe(MODULE);
  expect(decoded[2]).toBe('0x');
});

test('is available for a legacy ten-minute mainnet policy and without a locally saved recovery', async () => {
  mockVault.activeNetwork.chainId = 1;
  mockMetadata = metadata(1);
  mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
    mockMetadata;
  render(<SmartAccountPolicy />);
  expect(await screen.findByRole('button', { name: REMOVE })).toHaveProperty(
    'disabled',
    false
  );
  await openConfirmation();
  expect(mockSubmit).not.toHaveBeenCalled();
});

test.each(['account', 'network', 'session'])(
  'rejects a stale confirmation after %s changes',
  async (change) => {
    const view = render(<SmartAccountPolicy />);
    await openConfirmation();
    const staleConfirm = mockModal.onClick;
    if (change === 'account') {
      mockScope = { ...mockScope, account: 'account:2' };
      mockVault.activeAccount.id = 2;
    }
    if (change === 'network') {
      mockScope = { ...mockScope, network: 'network:1' };
      mockVault.activeNetwork.chainId = 1;
    }
    if (change === 'session') mockGeneration += 1;
    view.rerender(<SmartAccountPolicy />);
    await act(async () => {
      await staleConfirm();
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  }
);

test('blocks duplicate confirmation callbacks while signing is in flight', async () => {
  let finish!: () => void;
  mockSubmit.mockImplementation(async (params: any) => {
    await params.onBeforeSubmit();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    mockMetadata = metadata(57057, false);
  });
  render(<SmartAccountPolicy />);
  await openConfirmation();
  const click = mockModal.onClick;
  let first: Promise<void>;
  await act(async () => {
    first = click();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  await act(async () => {
    await click();
  });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await first!;
  });
});

test('definite approval failure is retryable and does not clear recovery credentials', async () => {
  const stored = {
    kind: 'ecdsa',
    authenticator: { id: 'ecdsa', config: { owners: [OWNER], threshold: 1 } },
    recoveryOperation: {
      account: ACCOUNT,
      chainId: 57057,
      salt: SALT,
      readyAt: 1890000000,
    },
  };
  localStorage.setItem(storageKey(), JSON.stringify(stored));
  mockSubmit.mockRejectedValue(
    Object.assign(new Error('User rejected'), {
      transactionNotBroadcast: true,
      code: 4001,
    })
  );
  render(<SmartAccountPolicy />);
  await openConfirmation();
  await confirm();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: REMOVE })).toHaveProperty(
    'disabled',
    false
  );
  expect(localStorage.getItem(removalKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual(stored);
});

test('a confirmed reverted transaction is retryable without an unknown-submission marker', async () => {
  mockSubmit.mockImplementation(async (params: any) => {
    await params.onBeforeSubmit();
    throw Object.assign(new Error('Transaction reverted'), {
      receipt: { status: 0 },
    });
  });
  render(<SmartAccountPolicy />);
  await openConfirmation();
  await confirm();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(localStorage.getItem(removalKey)).toBeNull();
  expect(screen.getByRole('button', { name: REMOVE })).toHaveProperty(
    'disabled',
    false
  );
});

test('successful removal does not erase a newer local recovery record from another operation', async () => {
  const stored = {
    kind: 'ecdsa',
    authenticator: { id: 'ecdsa', config: { owners: [OWNER], threshold: 1 } },
    recoveryOperation: {
      account: ACCOUNT,
      chainId: 57057,
      salt: SALT,
      readyAt: 1890000000,
    },
  };
  localStorage.setItem(storageKey(), JSON.stringify(stored));
  render(<SmartAccountPolicy />);
  await openConfirmation();
  const newer = {
    ...stored,
    recoveryOperation: {
      ...stored.recoveryOperation,
      salt: `0x${'cd'.repeat(32)}`,
    },
  };
  localStorage.setItem(storageKey(), JSON.stringify(newer));
  await confirm();
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledWith(DISABLED));
  expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual(newer);
});

test('accepted submission without removal readback cannot claim success or sign again', async () => {
  mockSubmit.mockImplementation(async (params: any) => {
    await params.onBeforeSubmit();
    mockReadbackFails = true;
    return { hash: `0x${'de'.repeat(32)}` };
  });
  render(<SmartAccountPolicy />);
  await openConfirmation();
  const staleConfirm = mockModal.onClick;
  await confirm();
  await waitFor(() => expect(mockAlert.info).toHaveBeenCalledWith(PENDING));
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: CHECK })).not.toBeNull();
  expect(screen.queryByRole('button', { name: REMOVE })).toBeNull();
  const marker = JSON.parse(localStorage.getItem(removalKey)!);
  expect(marker).toEqual({
    accountAddress: ACCOUNT,
    chainId: 57057,
    moduleAddress: MODULE,
  });
  expect(localStorage.getItem(removalKey)).not.toContain('synthetic.invalid');
  await act(async () => {
    await staleConfirm();
  });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  mockReadbackFails = false;
  mockMetadata = metadata(57057, false);
  fireEvent.click(screen.getByRole('button', { name: CHECK }));
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledWith(DISABLED));
  expect(localStorage.getItem(removalKey)).toBeNull();
});

test('an uncertain broadcast is retained across remount and only the target pending operation is cleared after readback', async () => {
  const stored = {
    kind: 'ecdsa',
    authenticator: { id: 'ecdsa', config: { owners: [OWNER], threshold: 1 } },
    recoveryOperation: {
      account: ACCOUNT,
      chainId: 57057,
      salt: SALT,
      readyAt: 1890000000,
    },
  };
  localStorage.setItem(storageKey(), JSON.stringify(stored));
  localStorage.setItem(storageKey(OTHER), 'other account credential');
  mockSubmit.mockImplementation(async (params: any) => {
    await params.onBeforeSubmit();
    throw new Error('Connection lost after submission');
  });
  const view = render(<SmartAccountPolicy />);
  await openConfirmation();
  await confirm();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(localStorage.getItem(removalKey)).not.toBeNull();
  view.unmount();
  render(<SmartAccountPolicy />);
  await screen.findByRole('button', { name: CHECK });
  expect(screen.queryByRole('button', { name: REMOVE })).toBeNull();
  mockMetadata = metadata(57057, false);
  fireEvent.click(screen.getByRole('button', { name: CHECK }));
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledWith(DISABLED));
  expect(
    JSON.parse(localStorage.getItem(storageKey())!).recoveryOperation
  ).toBeUndefined();
  expect(JSON.parse(localStorage.getItem(storageKey())!).authenticator).toEqual(
    stored.authenticator
  );
  expect(localStorage.getItem(storageKey(OTHER))).toBe(
    'other account credential'
  );
});

test('an unknown dropped request has an explicit fresh-read retry path with another confirmation', async () => {
  mockSubmit.mockImplementationOnce(async (params: any) => {
    await params.onBeforeSubmit();
    throw new Error('Unknown send result');
  });
  render(<SmartAccountPolicy />);
  await openConfirmation();
  await confirm();
  await screen.findByRole('button', { name: CHECK });
  expect(
    screen.queryByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryRetryRemoval',
    })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: CHECK }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryRetryRemoval',
    })
  );
  await screen.findByRole('dialog', { name: CONFIRM });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog').textContent).toContain(
    'settings.smartAccountGuardianRecoveryRetryWarning'
  );
  fireEvent.click(screen.getByRole('dialog').querySelector('button')!);
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledWith(DISABLED));
});

test('a changed installed executor cannot be removed using an older confirmation', async () => {
  render(<SmartAccountPolicy />);
  await openConfirmation();
  mockMetadata = {
    ...mockMetadata,
    installedModules: mockMetadata.installedModules.map((module: any) =>
      module.id === 'guardian-recovery' ? { ...module, address: OTHER } : module
    ),
  };
  await act(async () => {
    await mockModal.onClick();
  });
  expect(mockSubmit).not.toHaveBeenCalled();
});

test('missing refreshed metadata is not reported as an already disabled guardian', async () => {
  render(<SmartAccountPolicy />);
  await screen.findByRole('button', { name: REMOVE });
  mockMetadata = null;
  fireEvent.click(screen.getByRole('button', { name: REMOVE }));
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.smartAccountGuardianRecoveryDisableFailed'
    )
  );
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockSubmit).not.toHaveBeenCalled();
});

test('a removal started in another window is noticed before a new request', async () => {
  render(<SmartAccountPolicy />);
  await screen.findByRole('button', { name: REMOVE });
  localStorage.setItem(
    removalKey,
    JSON.stringify({
      accountAddress: ACCOUNT,
      chainId: 57057,
      moduleAddress: MODULE,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: REMOVE }));
  await screen.findByRole('button', { name: CHECK });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockSubmit).not.toHaveBeenCalled();
});
