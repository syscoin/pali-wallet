/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';

import { KeyringAccountType } from 'types/network';

import SmartAccountPolicy from './SmartAccountPolicy';

const PATH = '/settings/account/smart-account-policy';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const GUARDIAN = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const VALIDATOR = '0x4444444444444444444444444444444444444444';
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockLockedError = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockVault: any;
const METADATA = {
  auth: { data: '0x', module: 'ecdsa', validator: VALIDATOR },
  chainId: 57057,
  installedModules: [
    {
      address: VALIDATOR,
      config: { owners: [OWNER], threshold: 1 },
      id: 'ecdsa',
      type: 'validator',
    },
    {
      address: '0x8888888888888888888888888888888888888888',
      config: { delaySeconds: 60, guardians: [GUARDIAN], threshold: 1 },
      id: 'guardian-recovery',
      type: 'executor',
    },
  ],
  isDeployed: true,
};
const OPERATION = {
  account: ACCOUNT,
  chainId: 57057,
  executionCalldata: '0x1234',
  hash: `0x${'55'.repeat(32)}`,
  mode: `0x${'00'.repeat(32)}`,
  policyEpoch: '7',
  salt: `0x${'66'.repeat(32)}`,
};

jest.mock('antd', () => ({
  Form: { Item: ({ children }: any) => <div>{children}</div> },
  Input: ({ placeholder, value, onChange, disabled }: any) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  ),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ConfirmationModal: () => null,
  Icon: () => null,
}));
jest.mock('components/Loading', () => ({
  PqOperationStatus: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: mockLockedError,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => ({ account: 'account:1', network: '57057' }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => {
    const navigate = jest.requireActual('react-router-dom').useNavigate();
    return {
      alert: mockAlert,
      navigate: (path: any, options?: any) => {
        mockNavigate(path, options);
        navigate(path, options);
      },
      useCopyClipboard: () => [null, jest.fn()],
    };
  },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select({ vault: mockVault }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const Harness = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate(PATH, { replace: true, state: {} })}>
        Header back
      </button>
      <output data-testid="pane">
        {location.state?.smartAccountPolicyView || 'policy'}
      </output>
      <SmartAccountPolicy />
    </>
  );
};
const mount = (recovery = true) => {
  window.history.replaceState(
    {
      key: 'policy-origin',
      usr: recovery ? { smartAccountPolicyView: 'recovery' } : {},
    },
    '',
    `/app.html#${PATH}`
  );
  return render(
    <HashRouter>
      <Harness />
    </HashRouter>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockVault = {
    accounts: {
      [KeyringAccountType.HDAccount]: { 0: { address: OWNER, id: 0 } },
      [KeyringAccountType.SmartAccount]: {
        1: {
          address: ACCOUNT,
          id: 1,
          isSmartAccount: true,
          smartAccount: METADATA,
        },
      },
    },
    activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
    activeNetwork: { chainId: 57057 },
  };
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getSmartAccountGuardianRecoveryStatus')
      return { exists: true, delay: 60, guardians: [GUARDIAN], threshold: 1 };
    if (method === 'prepareSmartAccountGuardianStartRecovery')
      return {
        approval: { guardian: GUARDIAN, signature: '0x1234' },
        operation: OPERATION,
      };
    return null;
  });
});

it.each([
  ['success', 'committed'],
  ['failure', 'committed'],
  ['success', 'native-only'],
  ['failure', 'native-only'],
])(
  'settled %s cleans only busy state after a %s same-route Back, without stale feedback or duplicate submission',
  async (outcome, departure) => {
    let settle!: (value: any) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise((resolve, rejectPending) => {
      settle = resolve;
      reject = rejectPending;
    });
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((...args: any[]) =>
      args[0][1] === 'submitPreparedSmartAccountGuardianStartRecovery'
        ? pending
        : original(...args)
    );
    mount();
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /settings.ecdsaAuthenticator/ })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    fireEvent.click(
      screen.getByRole('button', { name: /settings.ecdsaAuthenticator/ })
    );
    fireEvent.change(
      screen.getByPlaceholderText('settings.recoveryAuthenticatorEcdsaOwner'),
      { target: { value: OWNER } }
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryStart',
      })
    );
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.filter(
          ([[, method]]) =>
            method === 'submitPreparedSmartAccountGuardianStartRecovery'
        )
      ).toHaveLength(1)
    );
    if (departure === 'committed') {
      fireEvent.click(screen.getByText('Header back'));
      await waitFor(() =>
        expect(screen.getByTestId('pane').textContent).toBe('policy')
      );
      const options = screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryShowOptions',
      });
      expect(options.hasAttribute('disabled')).toBe(true);
      fireEvent.click(options);
      expect(screen.getByTestId('pane').textContent).toBe('policy');
    } else {
      window.history.replaceState(
        { ...window.history.state, key: 'native-policy-parent', usr: {} },
        '',
        `/app.html#${PATH}`
      );
      expect(
        screen
          .getByRole('button', {
            name: 'settings.smartAccountGuardianRecoveryStart',
          })
          .hasAttribute('disabled')
      ).toBe(true);
    }
    await act(async () => {
      if (outcome === 'success') settle({ operation: OPERATION });
      else reject(new Error('Synthetic recovery failure'));
    });
    if (departure === 'native-only')
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', {
            name:
              outcome === 'success'
                ? 'settings.smartAccountGuardianRecoveryContinue'
                : 'settings.smartAccountGuardianRecoveryShowOptions',
          })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    expect(screen.getByTestId('pane').textContent).toBe('policy');
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) =>
          method === 'submitPreparedSmartAccountGuardianStartRecovery'
      )
    ).toHaveLength(1);
    expect(mockAlert.success).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockLockedError).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    if (outcome === 'success') {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'settings.smartAccountGuardianRecoveryContinue',
        })
      );
      await waitFor(() =>
        expect(
          screen
            .getByRole('button', {
              name: 'settings.smartAccountGuardianRecoveryStart',
            })
            .hasAttribute('disabled')
        ).toBe(true)
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: 'settings.smartAccountGuardianRecoveryStart',
        })
      );
      expect(
        mockEmitter.mock.calls.filter(
          ([[, method]]) =>
            method === 'submitPreparedSmartAccountGuardianStartRecovery'
        )
      ).toHaveLength(1);
    }
  }
);

it('restarts incomplete hydration for the new entry and rejects the old entry result without looping', async () => {
  mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount = {
    ...METADATA,
    installedModules: [],
  };
  const resolves: Array<(metadata: any) => void> = [];
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((...args: any[]) =>
    args[0][1] === 'hydrateSmartAccount'
      ? new Promise((resolve) => resolves.push(resolve))
      : original(...args)
  );
  mount(false);
  await waitFor(() => expect(resolves).toHaveLength(1));
  fireEvent.click(screen.getByText('Header back'));
  await waitFor(() => expect(resolves).toHaveLength(2));
  await act(async () => resolves[0](METADATA));
  expect(
    screen.queryByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  ).toBeNull();
  await act(async () => resolves[1](METADATA));
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryShowOptions',
      })
    ).toBeTruthy()
  );
  expect(resolves).toHaveLength(2);
});

it('syncs authoritative recovered owner and modules after same-route Back without stale feedback or another hydration', async () => {
  const recoveredOwner = '0x9999999999999999999999999999999999999999';
  const updatedMetadata = {
    ...METADATA,
    installedModules: [
      {
        ...METADATA.installedModules[0],
        config: { owners: [recoveredOwner], threshold: 1 },
      },
      METADATA.installedModules[1],
      {
        address: '0x5555555555555555555555555555555555555555',
        config: {
          credentialIdHash: `0x${'77'.repeat(32)}`,
          publicKey: { x: `0x${'11'.repeat(32)}`, y: `0x${'22'.repeat(32)}` },
        },
        id: 'p256-webauthn',
        type: 'validator',
      },
    ],
  };
  localStorage.setItem(
    `pali-smart-account-recovery-replacement:57057:${ACCOUNT}`,
    JSON.stringify({
      authenticator: {
        config: { owners: [recoveredOwner], threshold: 1 },
        id: 'ecdsa',
      },
      kind: 'ecdsa',
      recoveryOperation: {
        ...OPERATION,
        readyAt: Math.floor(Date.now() / 1000) - 60,
      },
    })
  );
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((...args: any[]) => {
    if (args[0][1] === 'finalizeSmartAccountGuardianRecovery') return pending;
    if (args[0][1] === 'hydrateSmartAccount') {
      mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
        updatedMetadata;
      return Promise.resolve(updatedMetadata);
    }
    return original(...args);
  });
  mount();
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', {
          name: 'settings.smartAccountGuardianRecoveryFinalize',
        })
        .hasAttribute('disabled')
    ).toBe(false)
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryFinalize',
    })
  );
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'finalizeSmartAccountGuardianRecovery'
    )
  ).toHaveLength(1);
  fireEvent.click(screen.getByText('Header back'));
  expect(screen.getByTitle(OWNER)).toBeTruthy();
  await act(async () => settle());
  await waitFor(() => expect(screen.getByTitle(recoveredOwner)).toBeTruthy());
  expect(screen.queryByTitle(OWNER)).toBeNull();
  const passkeyCard = screen
    .getByText('settings.passkeyAuthenticator')
    .closest('[class*="rounded-2xl"]') as HTMLElement;
  expect(within(passkeyCard).getByText('settings.installed')).toBeTruthy();
  expect(
    screen
      .getByRole('button', {
        name: 'settings.smartAccountGuardianRecoveryShowOptions',
      })
      .hasAttribute('disabled')
  ).toBe(false);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'hydrateSmartAccount'
    )
  ).toHaveLength(1);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByTestId('pane').textContent).toBe('policy');
});

it('an authoritative empty-module hydration result syncs locally without triggering an RPC loop', async () => {
  mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount = {
    ...METADATA,
    installedModules: [],
  };
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((...args: any[]) => {
    if (args[0][1] === 'hydrateSmartAccount') {
      const updated = { ...METADATA, installedModules: [] };
      mockVault.accounts[KeyringAccountType.SmartAccount][1].smartAccount =
        updated;
      return Promise.resolve(updated);
    }
    return original(...args);
  });
  mount(false);
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'hydrateSmartAccount'
    )
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', {
      name: 'settings.smartAccountGuardianRecoveryShowOptions',
    })
  ).toBeNull();
});
