/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';
import {
  createPasskeyCredential,
  setActivePasskeyRecord,
  signP256WebAuthnActionHash,
} from 'utils/passkey';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import { getGuardianRecoveryOperationId } from 'utils/smartAccount/guardianStatus';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockLocation: any;
let mockVault: any;
let mockScope: { account: string; network: string };
let mockStatus: any;
let mockGeneration: number;
const mockNavigate = jest.fn();
const mockEmitter = jest.fn();
const mockHandleLockedError = jest.fn();
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
  ConfirmationModal: ({ show, title }: any) =>
    show ? <div>{title}</div> : null,
  Icon: () => <span />,
}));
jest.mock('components/Loading', () => ({
  PqOperationStatus: () => null,
  PqSigningOverlay: ({ show }: any) =>
    show ? <div data-testid="signing-overlay" /> : null,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: mockHandleLockedError,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: mockNavigate,
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
jest.mock('utils/passkey', () => ({
  ...jest.requireActual('utils/passkey'),
  createPasskeyCredential: jest.fn(),
  setActivePasskeyRecord: jest.fn(() => true),
  signP256WebAuthnActionHash: jest.fn(),
}));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const GUARDIAN = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 57057;
const POLICY_ROUTE = '/settings/account/smart-account-policy';
const REPLACEMENT_KEY = `pali-smart-account-recovery-replacement:${CHAIN_ID}:${ACCOUNT}`;
const PUBLIC_KEY = {
  x: `0x${'11'.repeat(32)}`,
  y: `0x${'22'.repeat(32)}`,
  originHash: `0x${'33'.repeat(32)}`,
  rpIdHash: `0x${'44'.repeat(32)}`,
  originLength: 52,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, reject, resolve };
};

const metadata = (isDeployed = true) => ({
  auth: {
    data: '0x',
    module: 'ecdsa',
    validator: getPaliModuleAddress(CHAIN_ID, 'ecdsa'),
  },
  chainId: CHAIN_ID,
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
  isDeployed,
});

const setNativeEntry = (path = POLICY_ROUTE, key = 'policy-entry') => {
  window.history.replaceState({ key }, '', `/#${path}`);
};

describe('SmartAccountPolicy async UI lifetime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockScope = { account: 'account:1', network: 'network:57057' };
    mockStatus = {
      connectionUnavailable: false,
      isLoading: false,
      isUnlocked: true,
    };
    mockGeneration = 7;
    mockLocation = {
      hash: '',
      key: 'policy-entry',
      pathname: POLICY_ROUTE,
      search: '',
      state: {
        accountType: KeyringAccountType.SmartAccount,
        id: 1,
        returnContext: { returnRoute: '/home/smart-account' },
      },
    };
    setNativeEntry();
    mockVault = {
      accounts: {
        [KeyringAccountType.HDAccount]: { 0: { address: OWNER, id: 0 } },
        [KeyringAccountType.SmartAccount]: {
          1: {
            address: ACCOUNT,
            id: 1,
            isSmartAccount: true,
            smartAccount: metadata(),
          },
        },
      },
      activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
      activeNetwork: { chainId: CHAIN_ID, url: 'https://rpc.test' },
    };
    mockHandleLockedError.mockReturnValue(false);
    mockEmitter.mockImplementation(async ([, method]: string[]) => {
      if (method === 'getWalletSessionGeneration') return mockGeneration;
      if (method === 'getSLHDSASmartAccountSetupStatus') return null;
      if (method === 'getSmartAccountGuardianRecoveryStatus') {
        const local = JSON.parse(
          localStorage.getItem(REPLACEMENT_KEY) || 'null'
        )?.recoveryOperation;
        const pending = local?.policyEpoch
          ? {
              operationId: getGuardianRecoveryOperationId(local),
              status: 'ready',
              scheduledAt: Math.floor(Date.now() / 1000) - 120,
              executableAt: Math.floor(Date.now() / 1000) - 60,
              expiresAt: Math.floor(Date.now() / 1000) + 604800,
            }
          : null;
        return {
          account: ACCOUNT,
          chainId: CHAIN_ID,
          moduleAddress: getPaliModuleAddress(CHAIN_ID, 'guardian-recovery'),
          policyEpoch: '7',
          observedBlock: {
            number: 1,
            timestamp: Math.floor(Date.now() / 1000),
            hash: `0x${'ab'.repeat(32)}`,
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
      if (method === 'hydrateSmartAccount')
        return mockVault.accounts[KeyringAccountType.SmartAccount][
          mockLocation.state?.id ?? mockVault.activeAccount.id
        ]?.smartAccount;
      if (method === 'getSmartAccountNativeGasStatus')
        return { hasNativeGas: true };
      throw new Error(`Unexpected controller method ${method}`);
    });
  });

  const beginRecoveryFinalization = async () => {
    mockLocation.state.smartAccountPolicyView = 'recovery';
    localStorage.setItem(
      REPLACEMENT_KEY,
      JSON.stringify({
        authenticator: {
          config: { passkeyName: 'Replacement', publicKey: PUBLIC_KEY },
          id: 'p256-webauthn',
        },
        credentialId: 'cmVwbGFjZW1lbnQ',
        credentialIdHash: `0x${'55'.repeat(32)}`,
        kind: 'p256-webauthn',
        recoveryOperation: {
          account: ACCOUNT,
          chainId: CHAIN_ID,
          policyEpoch: '7',
          recoveryModule: getPaliModuleAddress(CHAIN_ID, 'guardian-recovery'),
          executionCalldata: '0x1234',
          mode: `0x${'00'.repeat(32)}`,
          readyAt: Math.floor(Date.now() / 1000) - 60,
          salt: `0x${'66'.repeat(32)}`,
        },
      })
    );
    const pending = deferred<unknown>();
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path: string[], ...args: any[]) =>
      path[1] === 'finalizeSmartAccountGuardianRecovery'
        ? pending.promise
        : original(path, ...args)
    );
    const view = render(<SmartAccountPolicy />);
    const button = await screen.findByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryFinalize',
    });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'finalizeSmartAccountGuardianRecovery'],
        [expect.objectContaining({ account: ACCOUNT, chainId: CHAIN_ID })],
        300000
      )
    );
    return { ...pending, view };
  };

  const depart = (reason: string, view: ReturnType<typeof render>) => {
    if (reason === 'unmount') view.unmount();
    if (reason === 'route') {
      mockLocation = { ...mockLocation, key: 'home-entry', pathname: '/home' };
      setNativeEntry('/home', 'home-entry');
      view.rerender(<SmartAccountPolicy />);
    }
    if (reason === 'native route') setNativeEntry('/home', 'home-entry');
    if (reason === 'native key')
      setNativeEntry(POLICY_ROUTE, 'new-policy-entry');
    if (reason === 'React key') {
      mockLocation = { ...mockLocation, key: 'replacement-entry' };
      view.rerender(<SmartAccountPolicy />);
    }
    if (reason === 'selected account') {
      mockVault.accounts[KeyringAccountType.SmartAccount][2] = {
        address: GUARDIAN,
        id: 2,
        isSmartAccount: true,
        smartAccount: metadata(),
      };
      mockLocation = {
        ...mockLocation,
        state: { ...mockLocation.state, id: 2 },
      };
      view.rerender(<SmartAccountPolicy />);
    }
    if (reason === 'account') {
      mockScope = { ...mockScope, account: 'account:2' };
      mockVault.activeAccount = {
        id: 2,
        type: KeyringAccountType.SmartAccount,
      };
      view.rerender(<SmartAccountPolicy />);
    }
    if (reason === 'network') {
      mockScope = { ...mockScope, network: 'network:1' };
      mockVault.activeNetwork = { chainId: 1 };
      view.rerender(<SmartAccountPolicy />);
    }
    if (reason === 'lock') mockStatus = { ...mockStatus, isUnlocked: false };
    if (reason === 'loading') mockStatus = { ...mockStatus, isLoading: true };
    if (reason === 'unavailable') {
      mockStatus = { ...mockStatus, connectionUnavailable: true };
    }
  };

  describe('SLH setup status polling', () => {
    it('keeps slow status reads single-flight and resumes polling after settlement', async () => {
      jest.useFakeTimers();
      const pending = deferred<unknown>();
      const original = mockEmitter.getMockImplementation()!;
      mockEmitter.mockImplementation((path: string[], ...args: any[]) =>
        path[1] === 'getSLHDSASmartAccountSetupStatus'
          ? pending.promise
          : original(path, ...args)
      );
      const statusCalls = () =>
        mockEmitter.mock.calls.filter(
          ([path]) => path[1] === 'getSLHDSASmartAccountSetupStatus'
        );
      const view = render(<SmartAccountPolicy />);
      try {
        await act(async () => undefined);
        await act(async () => jest.advanceTimersByTime(9000));
        expect(statusCalls()).toHaveLength(1);
        await act(async () => pending.resolve(null));
        await act(async () => jest.advanceTimersByTime(3000));
        expect(statusCalls()).toHaveLength(2);
        view.unmount();
        await act(async () => jest.advanceTimersByTime(9000));
        expect(statusCalls()).toHaveLength(2);
      } finally {
        view.unmount();
        jest.useRealTimers();
      }
    });

    it('retries a failed status read without waiting for page navigation', async () => {
      jest.useFakeTimers();
      const pending = deferred<unknown>();
      const original = mockEmitter.getMockImplementation()!;
      let reads = 0;
      mockEmitter.mockImplementation((path: string[], ...args: any[]) => {
        if (path[1] !== 'getSLHDSASmartAccountSetupStatus')
          return original(path, ...args);
        reads += 1;
        return reads === 1 ? pending.promise : Promise.resolve(null);
      });
      const view = render(<SmartAccountPolicy />);
      try {
        await act(async () => undefined);
        await act(async () => pending.reject(new Error('temporary failure')));
        await act(async () => jest.advanceTimersByTime(3000));
        expect(reads).toBe(2);
      } finally {
        view.unmount();
        jest.useRealTimers();
      }
    });

    it('restarts read-only setup and recovery status after reconnecting and ignores pre-outage results', async () => {
      const setupPending = deferred<unknown>();
      const recoveryPending = deferred<unknown>();
      const original = mockEmitter.getMockImplementation()!;
      let setupReads = 0;
      let recoveryReads = 0;
      mockEmitter.mockImplementation((path: string[], ...args: any[]) => {
        if (path[1] === 'getSLHDSASmartAccountSetupStatus') {
          setupReads += 1;
          return setupReads === 1
            ? setupPending.promise
            : Promise.resolve({
                accountId: 1,
                error: 'Fresh setup failure after reconnect',
                startedAt: Date.now(),
                status: 'failed',
                updatedAt: Date.now(),
              });
        }
        if (path[1] === 'getSmartAccountGuardianRecoveryStatus') {
          recoveryReads += 1;
          return recoveryReads === 1
            ? recoveryPending.promise
            : original(path, ...args);
        }
        return original(path, ...args);
      });
      const view = render(<SmartAccountPolicy />);
      await act(async () => undefined);
      expect(setupReads).toBe(1);
      expect(recoveryReads).toBe(1);
      expect(
        screen
          .getByRole('button', {
            name: 'settings.smartAccountGuardianRecoveryShowOptions',
          })
          .hasAttribute('disabled')
      ).toBe(false);
      mockStatus = { ...mockStatus, connectionUnavailable: true };
      view.rerender(<SmartAccountPolicy />);
      await act(async () => undefined);
      expect(setupReads).toBe(1);
      expect(recoveryReads).toBe(1);
      mockStatus = { ...mockStatus, connectionUnavailable: false };
      view.rerender(<SmartAccountPolicy />);
      await act(async () => undefined);
      expect(setupReads).toBe(2);
      expect(recoveryReads).toBe(2);
      expect(
        screen.getByText('Fresh setup failure after reconnect')
      ).toBeTruthy();
      expect(
        screen
          .getByRole('button', {
            name: 'settings.smartAccountGuardianRecoveryShowOptions',
          })
          .hasAttribute('disabled')
      ).toBe(false);
      await act(async () => {
        setupPending.resolve(null);
        recoveryPending.resolve(null);
      });
      expect(
        screen.getByText('Fresh setup failure after reconnect')
      ).toBeTruthy();
      expect(
        screen
          .getByRole('button', {
            name: 'settings.smartAccountGuardianRecoveryShowOptions',
          })
          .hasAttribute('disabled')
      ).toBe(false);
      view.unmount();
    });
  });

  describe('entry metadata verification', () => {
    const mountWithHydration = (pending: ReturnType<typeof deferred<any>>) => {
      void pending.promise.catch(() => undefined);
      const original = mockEmitter.getMockImplementation()!;
      let reads = 0;
      mockEmitter.mockImplementation((path: string[], ...args: any[]) =>
        path[1] === 'hydrateSmartAccount'
          ? ++reads === 1
            ? pending.promise
            : new Promise(() => undefined)
          : original(path, ...args)
      );
      return render(<SmartAccountPolicy />);
    };

    it('verifies recreated metadata before showing the deployed policy or allowing registration', async () => {
      mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
        metadata(false);
      const pending = deferred<any>();
      const view = mountWithHydration(pending);
      expect(
        screen.queryByRole('button', { name: 'settings.registerSmartAccount' })
      ).toBeNull();
      await waitFor(() =>
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'hydrateSmartAccount'],
          [1],
          300000
        )
      );
      await act(async () => pending.resolve(metadata(true)));
      expect(
        screen.getByText('settings.smartAccountCurrentApprovalMethod')
      ).toBeTruthy();
      expect(screen.getByTitle(OWNER)).toBeTruthy();
      view.rerender(<SmartAccountPolicy />);
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path[1] === 'hydrateSmartAccount'
        )
      ).toHaveLength(1);
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'registerSmartAccountOnChain'
        )
      ).toBe(false);
    });

    it('retains a genuine counterfactual registration after the chain read', async () => {
      mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
        metadata(false);
      const pending = deferred<any>();
      mountWithHydration(pending);
      await act(async () => pending.resolve(metadata(false)));
      expect(
        (
          screen.getByRole('button', {
            name: 'settings.registerSmartAccount',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path[1] === 'hydrateSmartAccount'
        )
      ).toHaveLength(1);
    });

    it('refreshes a populated but stale cached owner on every entry', async () => {
      const pending = deferred<any>();
      mountWithHydration(pending);
      expect(screen.queryByTitle(OWNER)).toBeNull();
      const refreshed = metadata(true);
      refreshed.installedModules[0].config.owners = [GUARDIAN];
      await act(async () => pending.resolve(refreshed));
      expect(screen.getByTitle(GUARDIAN)).toBeTruthy();
      expect(screen.queryByTitle(OWNER)).toBeNull();
    });

    it('allows verified read-only browsing of a nonselected smart account', async () => {
      mockVault.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
      const pending = deferred<any>();
      mountWithHydration(pending);
      await act(async () => pending.resolve(metadata(true)));
      expect(screen.getByTitle(OWNER)).toBeTruthy();
      expect(mockVault.activeAccount).toEqual({
        id: 0,
        type: KeyringAccountType.HDAccount,
      });
      expect(
        mockEmitter.mock.calls.some(([path]) =>
          /register|sign|submit/i.test(path[1])
        )
      ).toBe(false);
    });

    it('keeps failed entry verification closed until an explicit read-only retry', async () => {
      const pending = deferred<any>();
      mountWithHydration(pending);
      await act(async () => pending.reject(new Error('Network unavailable')));
      expect(
        screen.queryByText('settings.smartAccountCurrentApprovalMethod')
      ).toBeNull();
      const next = deferred<any>();
      mockEmitter.mockImplementation((path: string[]) =>
        path[1] === 'hydrateSmartAccount' ? next.promise : Promise.resolve(null)
      );
      const retry = screen.getByRole('button', {
        name: 'settings.smartAccountMetadataRetry',
      });
      act(() => {
        retry.click();
        retry.click();
      });
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path[1] === 'hydrateSmartAccount'
        )
      ).toHaveLength(2);
      expect(screen.queryByTitle(OWNER)).toBeNull();
      await act(async () => next.resolve(metadata(true)));
      expect(screen.getByTitle(OWNER)).toBeTruthy();
      expect(
        mockEmitter.mock.calls.some(([path]) =>
          /register|sign|submit/i.test(path[1])
        )
      ).toBe(false);
    });

    it.each(['unmount', 'native route', 'selected account', 'network'])(
      'does not apply stale entry metadata after %s',
      async (reason) => {
        const pending = deferred<any>();
        const view = mountWithHydration(pending);
        depart(reason, view);
        await act(async () => pending.resolve(metadata(true)));
        expect(screen.queryByTitle(OWNER)).toBeNull();
        expect(mockAlert.error).not.toHaveBeenCalled();
      }
    );

    it.each(['connectionUnavailable', 'isLoading'])(
      'starts one read-only hydration when an entry opened with %s recovers',
      async (flag) => {
        mockStatus = { ...mockStatus, [flag]: true };
        const pending = deferred<any>();
        const view = mountWithHydration(pending);
        expect(
          mockEmitter.mock.calls.some(
            ([path]) => path[1] === 'hydrateSmartAccount'
          )
        ).toBe(false);
        mockStatus = { ...mockStatus, [flag]: false };
        view.rerender(<SmartAccountPolicy />);
        await waitFor(() =>
          expect(
            mockEmitter.mock.calls.filter(
              ([path]) => path[1] === 'hydrateSmartAccount'
            )
          ).toHaveLength(1)
        );
        await act(async () => pending.resolve(metadata(true)));
        expect(screen.getByTitle(OWNER)).toBeTruthy();
        expect(
          mockEmitter.mock.calls.some(([path]) =>
            /register|sign|submit/i.test(path[1])
          )
        ).toBe(false);
      }
    );

    it('invalidates ready metadata during an outage and re-verifies on reconnection', async () => {
      const initial = deferred<any>();
      const view = mountWithHydration(initial);
      await act(async () => initial.resolve(metadata(true)));
      expect(screen.getByTitle(OWNER)).toBeTruthy();
      mockStatus = { ...mockStatus, connectionUnavailable: true };
      view.rerender(<SmartAccountPolicy />);
      expect(screen.queryByTitle(OWNER)).toBeNull();
      mockStatus = { ...mockStatus, connectionUnavailable: false };
      view.rerender(<SmartAccountPolicy />);
      await waitFor(() =>
        expect(
          mockEmitter.mock.calls.filter(
            ([path]) => path[1] === 'hydrateSmartAccount'
          )
        ).toHaveLength(2)
      );
      expect(screen.queryByTitle(OWNER)).toBeNull();
      expect(
        mockEmitter.mock.calls.some(([path]) =>
          /register|sign|submit/i.test(path[1])
        )
      ).toBe(false);
    });

    it('rejects a pre-outage result and issues a fresh read after reconnection', async () => {
      const initial = deferred<any>();
      const view = mountWithHydration(initial);
      mockStatus = { ...mockStatus, connectionUnavailable: true };
      view.rerender(<SmartAccountPolicy />);
      await act(async () => initial.resolve(metadata(true)));
      mockStatus = { ...mockStatus, connectionUnavailable: false };
      view.rerender(<SmartAccountPolicy />);
      await waitFor(() =>
        expect(
          mockEmitter.mock.calls.filter(
            ([path]) => path[1] === 'hydrateSmartAccount'
          )
        ).toHaveLength(2)
      );
      expect(screen.queryByTitle(OWNER)).toBeNull();
      expect(
        mockEmitter.mock.calls.some(([path]) =>
          /register|sign|submit/i.test(path[1])
        )
      ).toBe(false);
    });
  });

  it.each([
    'unmount',
    'route',
    'native route',
    'native key',
    'React key',
    'selected account',
    'account',
    'network',
    'lock',
    'loading',
    'unavailable',
  ])(
    'reconciles the original recovery without returning or toasting after %s',
    async (reason) => {
      const pending = await beginRecoveryFinalization();
      depart(reason, pending.view);
      await act(async () => pending.resolve({}));
      expect(setActivePasskeyRecord).toHaveBeenCalledWith(
        ACCOUNT,
        expect.objectContaining({
          credentialId: 'cmVwbGFjZW1lbnQ',
          publicKey: PUBLIC_KEY,
        })
      );
      expect(localStorage.getItem(REPLACEMENT_KEY)).toBeNull();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockAlert.success).not.toHaveBeenCalled();
      expect(mockAlert.error).not.toHaveBeenCalled();
    }
  );

  it('finishes recovery in the originating Settings entry and retains its parent', async () => {
    const pending = await beginRecoveryFinalization();
    await act(async () => pending.resolve({}));
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.smartAccountGuardianRecoveryFinalized'
    );
    expect(mockNavigate).toHaveBeenCalledWith(POLICY_ROUTE, {
      replace: true,
      state: expect.objectContaining({
        returnContext: { returnRoute: '/home/smart-account' },
      }),
    });
    expect(mockNavigate.mock.calls[0][1].state).not.toHaveProperty(
      'smartAccountPolicyView'
    );
  });

  it('does not let a departed recovery error invoke the shared lock redirect', async () => {
    const pending = await beginRecoveryFinalization();
    pending.view.unmount();
    await act(async () => pending.reject(new Error('Wallet is locked')));
    expect(mockHandleLockedError).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(localStorage.getItem(REPLACEMENT_KEY)).not.toBeNull();
  });

  it('still reconciles an expired originating recovery after leaving the page', async () => {
    const pending = await beginRecoveryFinalization();
    pending.view.unmount();
    await act(async () =>
      pending.reject(new Error('PALI_GUARDIAN_RECOVERY_EXPIRED'))
    );
    expect(
      JSON.parse(localStorage.getItem(REPLACEMENT_KEY)!)
    ).not.toHaveProperty('recoveryOperation');
    expect(mockHandleLockedError).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  const beginRegistration = async (hydrate?: Promise<unknown>) => {
    mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
      metadata(false);
    const pending = deferred<unknown>();
    const original = mockEmitter.getMockImplementation()!;
    let hydrationReads = 0;
    mockEmitter.mockImplementation((path: string[], ...args: any[]) => {
      if (path[1] === 'registerSmartAccountOnChain') return pending.promise;
      if (path[1] === 'hydrateSmartAccount') {
        if (++hydrationReads === 1) return Promise.resolve(metadata(false));
        if (hydrate) return hydrate;
        return Promise.resolve(metadata(true));
      }
      return original(path, ...args);
    });
    const view = render(<SmartAccountPolicy />);
    await act(async () => undefined);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'settings.registerSmartAccount',
      })
    );
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'registerSmartAccountOnChain'
        )
      ).toBe(true)
    );
    return { ...pending, view };
  };

  it.each(['account', 'network', 'native key', 'unmount'])(
    'ignores a late registration error after %s',
    async (reason) => {
      const pending = await beginRegistration();
      depart(reason, pending.view);
      await act(async () => pending.reject(new Error('Wallet is locked')));
      expect(mockHandleLockedError).not.toHaveBeenCalled();
      expect(mockAlert.error).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  );

  it('shows an ordinary registration error in place', async () => {
    const pending = await beginRegistration();
    await act(async () => pending.reject(new Error('Registration rejected')));
    expect(mockAlert.error).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'settings.registerSmartAccount',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('completes registration in place and retains the caller', async () => {
    const pending = await beginRegistration();
    await act(async () => pending.resolve({}));
    expect(mockAlert.success).toHaveBeenCalledWith(
      'settings.smartAccountRegistered'
    );
    expect(
      screen.queryByRole('button', { name: 'settings.registerSmartAccount' })
    ).toBeNull();
    expect(mockLocation.state.returnContext).toEqual({
      returnRoute: '/home/smart-account',
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not render old metadata or a success toast after a network switch during hydration', async () => {
    const hydration = deferred<unknown>();
    const pending = await beginRegistration(hydration.promise);
    await act(async () => pending.resolve({}));
    depart('network', pending.view);
    await act(async () => hydration.resolve(metadata(true)));
    expect(
      screen.queryByText('settings.smartAccountCurrentApprovalMethod')
    ).toBeNull();
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not open a recreate prompt after a departed passkey assertion fails', async () => {
    const p256 = getPaliModuleAddress(CHAIN_ID, 'p256-webauthn');
    const passkey = {
      address: p256,
      config: {
        credentialId: 'b2xk',
        credentialIdHash: `0x${'55'.repeat(32)}`,
        publicKey: PUBLIC_KEY,
      },
      id: 'p256-webauthn',
      type: 'validator',
    };
    mockVault.accounts[
      KeyringAccountType.SmartAccount
    ][1].smartAccount.installedModules.push(passkey);
    const assertion = deferred<any>();
    (signP256WebAuthnActionHash as jest.Mock).mockReturnValue(
      assertion.promise
    );
    const view = render(<SmartAccountPolicy />);
    await act(async () => undefined);
    const passkeyCard = screen
      .getByText('settings.passkeyAuthenticator')
      .closest('div.rounded-2xl')!;
    fireEvent.click(passkeyCard.querySelector('button')!);
    await waitFor(() => expect(signP256WebAuthnActionHash).toHaveBeenCalled());
    setNativeEntry('/home', 'home-entry');
    await act(async () => assertion.reject(new Error('Prompt cancelled')));
    expect(
      screen.queryByText('settings.smartAccountPasskeyRecreateConfirmTitle')
    ).toBeNull();
    expect(mockHandleLockedError).not.toHaveBeenCalled();
    view.unmount();
  });

  describe('policy approval lifetime before signing', () => {
    const prepared = (executions: unknown) => ({
      actionHash: `0x${'77'.repeat(32)}`,
      executionContextId: 'policy-operation',
      executions,
      smartAccount: metadata(),
    });
    const install = async (slow: 'gas' | 'prepare' | 'none') => {
      const pending = deferred<any>();
      const original = mockEmitter.getMockImplementation()!;
      (createPasskeyCredential as jest.Mock).mockResolvedValue({
        ...PUBLIC_KEY,
        rawId: 'bmV3',
        credentialId: 'bmV3',
        credentialIdHash: `0x${'66'.repeat(32)}`,
        userHandle: 'ZnJlc2g',
      });
      mockEmitter.mockImplementation((path: string[], params: any[]) => {
        if (path[1] === 'getWalletSessionGeneration')
          return Promise.resolve(mockGeneration);
        if (path[1] === 'getSmartAccountNativeGasStatus' && slow === 'gas')
          return pending.promise;
        if (path[1] === 'prepareSmartAccountExecutions')
          return slow === 'prepare'
            ? pending.promise
            : Promise.resolve(prepared(params[0]));
        if (path[1] === 'assertSmartAccountExecutionContext')
          return mockGeneration === 7
            ? Promise.resolve()
            : Promise.reject(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'));
        if (path[1] === 'signSmartAccountActionDigestInternal')
          return Promise.resolve(`0x${'88'.repeat(65)}`);
        if (path[1] === 'submitSmartAccountExecution')
          return Promise.resolve({ hash: `0x${'99'.repeat(32)}` });
        return original(path, params);
      });
      const view = render(<SmartAccountPolicy />);
      await act(async () => undefined);
      const card = screen
        .getByText('settings.passkeyAuthenticator')
        .closest('div.rounded-2xl')!;
      fireEvent.click(card.querySelector('button')!);
      const method =
        slow === 'prepare'
          ? 'prepareSmartAccountExecutions'
          : 'getSmartAccountNativeGasStatus';
      await waitFor(() =>
        expect(
          mockEmitter.mock.calls.some(([path]) => path[1] === method)
        ).toBe(true)
      );
      return { pending, view };
    };

    it('retains ordinary current-context signing as a control', async () => {
      const { view } = await install('none');
      await waitFor(() =>
        expect(
          mockEmitter.mock.calls.some(
            ([path]) => path[1] === 'signSmartAccountActionDigestInternal'
          )
        ).toBe(true)
      );
      expect(createPasskeyCredential).toHaveBeenCalledTimes(1);
      const preparation = mockEmitter.mock.calls.find(
        ([path]) => path[1] === 'prepareSmartAccountExecutions'
      )!;
      expect(preparation[1][2].expectedContext).toEqual({
        account: {
          address: ACCOUNT,
          id: 1,
          type: KeyringAccountType.SmartAccount,
        },
        chainId: CHAIN_ID,
        rpcUrl: 'https://rpc.test',
        slip44: 60,
        sessionGeneration: 7,
      });
      view.unmount();
    });

    it('does not create credentials or sign after departing during the gas check', async () => {
      const { pending, view } = await install('gas');
      depart('native route', view);
      await act(async () => pending.resolve({ hasNativeGas: true }));
      expect(createPasskeyCredential).not.toHaveBeenCalled();
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'signSmartAccountActionDigestInternal'
        )
      ).toBe(false);
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'submitSmartAccountExecution'
        )
      ).toBe(false);
      view.unmount();
    });

    it('does not resume a prior signing action after an outage and reconnection', async () => {
      const { pending, view } = await install('gas');
      mockStatus = { ...mockStatus, connectionUnavailable: true };
      view.rerender(<SmartAccountPolicy />);
      mockStatus = { ...mockStatus, connectionUnavailable: false };
      view.rerender(<SmartAccountPolicy />);
      await act(async () => pending.resolve({ hasNativeGas: true }));
      expect(createPasskeyCredential).not.toHaveBeenCalled();
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'signSmartAccountActionDigestInternal'
        )
      ).toBe(false);
    });

    it('does not sign after departing while execution preparation is pending', async () => {
      const { pending, view } = await install('prepare');
      const call = mockEmitter.mock.calls.find(
        ([path]) => path[1] === 'prepareSmartAccountExecutions'
      )!;
      depart('native route', view);
      await act(async () => pending.resolve(prepared(call[1][0])));
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'signSmartAccountActionDigestInternal'
        )
      ).toBe(false);
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'submitSmartAccountExecution'
        )
      ).toBe(false);
      view.unmount();
    });

    it.each(['account', 'network', 'native key', 'unmount', 'session'])(
      'does not create a credential after %s changes during gas lookup',
      async (axis) => {
        const { pending, view } = await install('gas');
        if (axis === 'session') mockGeneration++;
        else depart(axis, view);
        await act(async () => pending.resolve({ hasNativeGas: true }));
        expect(createPasskeyCredential).not.toHaveBeenCalled();
        expect(
          mockEmitter.mock.calls.some(
            ([path]) => path[1] === 'prepareSmartAccountExecutions'
          )
        ).toBe(false);
      }
    );

    it('keeps a nonselected policy browsable but refuses mutations', async () => {
      mockVault.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
      const view = render(<SmartAccountPolicy />);
      await act(async () => undefined);
      const card = screen
        .getByText('settings.passkeyAuthenticator')
        .closest('div.rounded-2xl')!;
      fireEvent.click(card.querySelector('button')!);
      await waitFor(() =>
        expect(mockAlert.error).toHaveBeenCalledWith(
          'settings.selectSmartAccountBeforePolicyChange'
        )
      );
      expect(createPasskeyCredential).not.toHaveBeenCalled();
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path[1] === 'getSmartAccountNativeGasStatus'
        )
      ).toBe(false);
      view.unmount();
    });
  });
});
