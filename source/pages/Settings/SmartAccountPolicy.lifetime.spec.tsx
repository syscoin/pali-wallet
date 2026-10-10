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
  setActivePasskeyRecord,
  signP256WebAuthnActionHash,
} from 'utils/passkey';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockLocation: any;
let mockVault: any;
let mockScope: { account: string; network: string };
let mockStatus: any;
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
  useSelector: (selector: any) => selector({ vault: mockVault }),
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
      activeNetwork: { chainId: CHAIN_ID },
    };
    mockHandleLockedError.mockReturnValue(false);
    mockEmitter.mockImplementation(async ([, method]: string[]) => {
      if (method === 'getSLHDSASmartAccountSetupStatus') return null;
      if (method === 'getSmartAccountGuardianRecoveryStatus') {
        return {
          delay: '60',
          exists: true,
          guardians: [GUARDIAN],
          threshold: 1,
        };
      }
      if (method === 'hydrateSmartAccount') return metadata();
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
    const button = screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryFinalize',
    });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(button);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'finalizeSmartAccountGuardianRecovery'],
      [expect.objectContaining({ account: ACCOUNT, chainId: CHAIN_ID })],
      300000
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
    mockEmitter.mockImplementation((path: string[], ...args: any[]) => {
      if (path[1] === 'registerSmartAccountOnChain') return pending.promise;
      if (hydrate && path[1] === 'hydrateSmartAccount') return hydrate;
      return original(path, ...args);
    });
    const view = render(<SmartAccountPolicy />);
    await act(async () => undefined);
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.registerSmartAccount' })
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
      screen.getByRole('button', { name: 'settings.registerSmartAccount' })
    ).toBeDefined();
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
});
