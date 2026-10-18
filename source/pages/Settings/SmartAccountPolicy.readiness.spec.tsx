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

import SmartAccountPolicy from './SmartAccountPolicy';

const NOW = new Date('2026-10-18T22:30:00Z');
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const GUARDIAN = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 57057;
const MAX_TIMER_DELAY = 2147483647;
const STORAGE_KEY = `pali-smart-account-recovery-replacement:${CHAIN_ID}:${ACCOUNT}`;
let mockVault: any;
let mockScope: string;
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
    alert: { error: jest.fn(), success: jest.fn() },
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
  useTranslation: () => ({ t: (key: string) => key }),
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
const suppressStatusPolling = () =>
  jest
    .spyOn(window, 'setInterval')
    .mockReturnValue(123 as unknown as ReturnType<typeof window.setInterval>);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  localStorage.clear();
  mockScope = 'account:1-network:57057';
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
    if (method === 'getSmartAccountGuardianRecoveryStatus')
      return {
        delay: '60',
        exists: true,
        guardians: [GUARDIAN],
        threshold: 1,
      };
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

it('enables Finalize at the deadline without a Redux update, never before it', async () => {
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(true);
  for (let tick = 0; tick < 19; tick++) await advance(3000);
  await advance(2999);
  expect(finalize().disabled).toBe(true);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, name]]) => name === 'getSLHDSASmartAccountSetupStatus'
    )
  ).toHaveLength(20);
  await advance(1);
  expect(finalize().disabled).toBe(false);
  fireEvent.click(finalize());
  await settle();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'finalizeSmartAccountGuardianRecovery'],
    [expect.objectContaining({ account: ACCOUNT, chainId: CHAIN_ID })],
    300000
  );
});

it('enables an already-ready recovery immediately without retaining a deadline timer', async () => {
  suppressStatusPolling();
  jest.setSystemTime(NOW.getTime() + 63000);
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('bounds distant deadline checks without enabling early or overflowing timers', async () => {
  suppressStatusPolling();
  const delay = MAX_TIMER_DELAY + 6353;
  storeRecovery((NOW.getTime() + delay) / 1000);
  render(<SmartAccountPolicy />);
  await settle();
  expect(jest.getTimerCount()).toBe(1);
  await advance(1000);
  expect(finalize().disabled).toBe(true);
  expect(jest.getTimerCount()).toBe(1);
  jest.setSystemTime(NOW.getTime() + delay - 1000);
  await advance(999);
  expect(finalize().disabled).toBe(true);
  await advance(1);
  expect(finalize().disabled).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('notices a forward wall-clock adjustment within one second without an unrelated render', async () => {
  suppressStatusPolling();
  storeRecovery(NOW.getTime() / 1000 + 7 * 86400);
  render(<SmartAccountPolicy />);
  await settle();
  expect(finalize().disabled).toBe(true);
  jest.setSystemTime(NOW.getTime() + 8 * 86400000);
  await advance(1000);
  expect(finalize().disabled).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('keeps recovery disabled until the deadline after a backward wall-clock adjustment', async () => {
  suppressStatusPolling();
  render(<SmartAccountPolicy />);
  await settle();
  jest.setSystemTime(NOW.getTime() - 120000);
  await advance(60000);
  expect(finalize().disabled).toBe(true);
  await advance(119999);
  expect(finalize().disabled).toBe(true);
  await advance(1);
  expect(finalize().disabled).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

it.each([null, '', -1, 'Infinity', 'NaN'])(
  'keeps invalid recovery deadline %s disabled without a timer',
  async (readyAt) => {
    suppressStatusPolling();
    storeRecovery(readyAt);
    render(<SmartAccountPolicy />);
    await settle();
    expect(finalize().disabled).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  }
);

it.each(['account', 'network', 'removal', 'unmount'])(
  'cleans the old deadline timer after %s',
  async (change) => {
    suppressStatusPolling();
    const view = render(<SmartAccountPolicy />);
    await settle();
    expect(jest.getTimerCount()).toBe(1);
    if (change === 'unmount') {
      view.unmount();
    } else {
      if (change === 'account') {
        mockVault.accounts.SmartAccount[1] = {
          ...mockVault.accounts.SmartAccount[1],
          address: GUARDIAN,
        };
      }
      if (change === 'network') {
        mockScope = 'account:1-network:other';
        mockVault.activeNetwork = {
          ...mockVault.activeNetwork,
          chainId: 1,
        };
      }
      if (change === 'removal') {
        localStorage.removeItem(STORAGE_KEY);
        // A remount represents reopening the recovery view after an accepted
        // finalization removed the persistent operation.
        view.unmount();
        render(<SmartAccountPolicy />);
      } else view.rerender(<SmartAccountPolicy />);
    }
    await settle();
    expect(jest.getTimerCount()).toBe(0);
    await advance(60000);
    expect(
      mockEmitter.mock.calls.some(
        ([[, name]]) => name === 'finalizeSmartAccountGuardianRecovery'
      )
    ).toBe(false);
  }
);
