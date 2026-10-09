jest.unmock('crypto');

import { webcrypto } from 'crypto';
import React from 'react';
import { useSelector } from 'react-redux';

import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { KeyringAccountType } from 'types/network';
import {
  createPasskeyCredential,
  getPasskeyAccountRecords,
  getPendingCreationPasskey,
  setPendingCreationPasskey,
  signalAcceptedPasskeyCredentials,
  signalUnknownPasskeyCredential,
  signP256WebAuthnActionHash,
} from 'utils/passkey';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';

import { PrepareSmartAccount } from './PrepareSmartAccount';

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: 'span',
  DropdownArrowSvg: 'span',
}));
jest.mock('components/index', () => ({
  Button: 'button',
  Card: 'card',
  Icon: 'span',
}));
jest.mock('components/Loading', () => ({ PqOperationStatus: 'div' }));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('hooks/index', () => ({ useQueryData: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/passkey', () => ({
  ...jest.requireActual('utils/passkey'),
  createPasskeyCredential: jest.fn(),
  signP256WebAuthnActionHash: jest.fn(),
  signalUnknownPasskeyCredential: jest.fn(),
  signalAcceptedPasskeyCredentials: jest.fn(),
}));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const CHAIN_ID = 57057;
const PUBLIC_KEY = {
  x: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296',
  y: '0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  originHash: `0x${'33'.repeat(32)}`,
  rpIdHash: `0x${'44'.repeat(32)}`,
  originLength: 24,
};
const CREDENTIAL = {
  ...PUBLIC_KEY,
  credentialId: 'b2xk',
  credentialIdHash: `0x${'55'.repeat(32)}`,
  rawId: 'b2xk',
  userHandle: 'dXNlcg',
};
const find = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = find(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

describe('smart-account creation passkey ownership and retention', () => {
  let states: any[];
  let cursor: number;
  let records: Map<string, string>;
  let emitter: jest.Mock;
  let failHydration: boolean;
  let failSubmission: boolean;
  let failWrite: (key: string) => boolean;
  let createdAccount: string;
  let walletPasskeyFlow: boolean;
  const render = () => {
    cursor = 0;
    return PrepareSmartAccount();
  };
  const confirm = () =>
    find(
      render(),
      (element) =>
        element.type === 'button' &&
        element.props.children === 'buttons.confirm'
    )!;
  const request = (label = 'My wallet', config?: any) => {
    (useQueryData as jest.Mock).mockReturnValue({
      host: 'example.test',
      request: {
        label,
        authenticator: {
          id: 'p256-webauthn',
          ...(config === undefined ? {} : { config }),
        },
      },
    });
  };

  beforeEach(() => {
    states = [];
    records = new Map();
    failHydration = false;
    failSubmission = false;
    failWrite = () => false;
    createdAccount = ACCOUNT;
    walletPasskeyFlow = true;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { close: jest.fn() },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failWrite(key)) throw new Error('Storage unavailable');
          records.set(key, value);
        },
        removeItem: (key: string) => records.delete(key),
      },
    });
    const bootstrap = {
      auth: {
        module: 'ecdsa',
        validator: getPaliModuleAddress(CHAIN_ID, 'ecdsa'),
        data: '0x',
      },
      chainId: CHAIN_ID,
      isDeployed: true,
      installedModules: [
        {
          id: 'ecdsa',
          type: 'validator',
          address: getPaliModuleAddress(CHAIN_ID, 'ecdsa'),
          config: { owners: [OWNER], threshold: 1 },
        },
      ],
    };
    (useSelector as jest.Mock).mockReturnValue({
      accounts: {
        [KeyringAccountType.HDAccount]: { 0: { id: 0, address: OWNER } },
      },
      activeNetwork: { chainId: CHAIN_ID },
    });
    emitter = jest.fn(async ([, method]: string[], params: any[]) => {
      if (method === 'createSmartAccount')
        return {
          id: 1,
          address: createdAccount,
          isSmartAccount: true,
          smartAccount: bootstrap,
        };
      if (method === 'getSmartAccountNativeGasStatus')
        return { hasNativeGas: true };
      if (method === 'prepareSmartAccountExecutions')
        return {
          actionHash: `0x${'77'.repeat(32)}`,
          smartAccount: bootstrap,
          executions: params[0],
        };
      if (method === 'signSmartAccountActionDigestInternal')
        return `0x${'88'.repeat(65)}`;
      if (method === 'submitSmartAccountExecution' && walletPasskeyFlow) {
        expect(
          getPasskeyAccountRecords(createdAccount).pending?.profile.credentialId
        ).toEqual(expect.any(String));
        if (failSubmission) throw new Error('Submission outcome unknown');
      }
      if (method === 'hydrateSmartAccount' && failHydration)
        throw new Error('Hydration unavailable');
      return { hash: `0x${'99'.repeat(32)}` };
    });
    (useController as jest.Mock).mockReturnValue({
      controllerEmitter: emitter,
      handleWalletLockedError: () => false,
    });
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (value: any) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
    (createPasskeyCredential as jest.Mock).mockResolvedValue(CREDENTIAL);
    (signP256WebAuthnActionHash as jest.Mock).mockResolvedValue({
      credentialId: CREDENTIAL.credentialId,
    });
    request();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    { ...CREDENTIAL, publicKey: PUBLIC_KEY },
    { publicKey: PUBLIC_KEY },
    {},
  ])(
    'rejects supplied P256 ownership config before creation or signing (%j)',
    async (config) => {
      request('External key', config);
      expect(confirm().props.disabled).toBe(true);
      expect(
        find(
          render(),
          (element) =>
            element.props.children ===
            'connections.smartAccountExternalPasskeyUnsupported'
        )
      ).toBeDefined();
      // An old/programmatic callback must enforce the same gate as the button.
      await confirm().props.onClick();
      expect(createPasskeyCredential).not.toHaveBeenCalled();
      expect(signP256WebAuthnActionHash).not.toHaveBeenCalled();
      expect(emitter).not.toHaveBeenCalled();
    }
  );

  it('keeps the ordinary wallet-managed creation path and records adoption', async () => {
    expect(confirm().props.disabled).toBe(false);
    await confirm().props.onClick();
    expect(createPasskeyCredential).toHaveBeenCalledTimes(1);
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(true);
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
      CREDENTIAL.credentialId
    );
    expect(getPendingCreationPasskey()).toBeNull();
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    expect(signalAcceptedPasskeyCredentials).not.toHaveBeenCalled();
  });

  it.each([
    KeyringAccountType.HDAccount,
    KeyringAccountType.Ledger,
    KeyringAccountType.Trezor,
  ])('keeps local ECDSA ownership working for %s', async (type) => {
    walletPasskeyFlow = false;
    (useSelector as jest.Mock).mockReturnValue({
      accounts: { [type]: { 0: { id: 0, address: OWNER } } },
      activeNetwork: { chainId: CHAIN_ID },
    });
    (useQueryData as jest.Mock).mockReturnValue({
      host: 'example.test',
      request: {
        authenticator: {
          id: 'ecdsa',
          config: { owners: [OWNER], threshold: 1 },
        },
      },
    });
    expect(confirm().props.disabled).toBe(false);
    await confirm().props.onClick();
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(true);
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(createPasskeyCredential).not.toHaveBeenCalled();
  });

  it('preserves the installed credential before failed hydration and a new flow after restart', async () => {
    failHydration = true;
    await confirm().props.onClick();
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
      CREDENTIAL.credentialId
    );
    expect(getPendingCreationPasskey()).toBeNull();
    states = []; // A new page reads the same durable records.
    failHydration = false;
    request('A different account');
    const secondAccount = '0x3333333333333333333333333333333333333333';
    createdAccount = secondAccount;
    (createPasskeyCredential as jest.Mock).mockResolvedValue({
      ...CREDENTIAL,
      credentialId: 'bmV3',
      userHandle: 'ZnJlc2g',
    });
    await confirm().props.onClick();
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
      CREDENTIAL.credentialId
    );
    expect(getPasskeyAccountRecords(secondAccount).active?.credentialId).toBe(
      'bmV3'
    );
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    expect(signalAcceptedPasskeyCredentials).not.toHaveBeenCalled();
  });

  it('retains ambiguous installed credentials across restart, another label and cancelled possession', async () => {
    failSubmission = true;
    await confirm().props.onClick();
    expect(
      getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
    ).toBe(CREDENTIAL.credentialId);
    expect(getPendingCreationPasskey()?.profile.credentialId).toBe(
      CREDENTIAL.credentialId
    );
    states = [];
    request('A different account');
    createdAccount = '0x3333333333333333333333333333333333333333';
    (createPasskeyCredential as jest.Mock).mockResolvedValue({
      ...CREDENTIAL,
      credentialId: 'bmV3',
      userHandle: 'ZnJlc2g',
    });
    await confirm().props.onClick();
    expect(
      getPasskeyAccountRecords(createdAccount).pending?.profile.credentialId
    ).toBe('bmV3');
    request('A different account');
    (signP256WebAuthnActionHash as jest.Mock).mockRejectedValue(
      new Error('Cancelled')
    );
    await confirm().props.onClick();
    expect(
      getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
    ).toBe(CREDENTIAL.credentialId);
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    expect(signalAcceptedPasskeyCredentials).not.toHaveBeenCalled();
  });

  it.each(['creation', 'account'])(
    'does not submit if the %s recovery record cannot be saved',
    async (failedRecord) => {
      failWrite = (key) =>
        failedRecord === 'creation'
          ? key.endsWith('creation-pending')
          : key.endsWith(ACCOUNT);
      await confirm().props.onClick();
      expect(
        emitter.mock.calls.some(
          ([[, method]]) => method === 'submitSmartAccountExecution'
        )
      ).toBe(false);
      expect(
        find(
          render(),
          (element) =>
            element.props.children ===
            'connections.smartAccountPasskeySaveFailed'
        )
      ).toBeDefined();
      expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    }
  );

  it('keeps the pending record if the confirmed adoption write fails', async () => {
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      const result = await original(path, params);
      if (path[1] === 'submitSmartAccountExecution')
        failWrite = (key) => key.endsWith(ACCOUNT);
      return result;
    });
    await confirm().props.onClick();
    expect(
      getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
    ).toBe(CREDENTIAL.credentialId);
    expect(getPendingCreationPasskey()?.profile.credentialId).toBe(
      CREDENTIAL.credentialId
    );
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
  });

  it('reuses a retained creation credential only after possession succeeds', async () => {
    setPendingCreationPasskey({
      ...CREDENTIAL,
      publicKey: PUBLIC_KEY,
      passkeyName: 'My wallet',
    });
    await confirm().props.onClick();
    expect(signP256WebAuthnActionHash).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCredentialIdHash: CREDENTIAL.credentialIdHash,
        expectedPublicKey: PUBLIC_KEY,
      })
    );
    expect(createPasskeyCredential).not.toHaveBeenCalled();
  });
});
