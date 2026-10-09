jest.unmock('crypto');

import { webcrypto } from 'crypto';
import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { KeyringAccountType } from 'types/network';
import {
  createPasskeyCredential,
  derivePasskeyUserHandle,
  getPasskeyAccountRecords,
  signalAcceptedPasskeyCredentials,
  signalUnknownPasskeyCredential,
  signP256WebAuthnActionHash,
} from 'utils/passkey';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';

import SmartAccountPolicy from './SmartAccountPolicy';

jest.mock('antd', () => ({ Form: { Item: 'div' }, Input: 'input' }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: 'span' }));
jest.mock('components/index', () => ({
  Button: 'button',
  ConfirmationModal: 'confirmation',
  Icon: 'span',
}));
jest.mock('components/Loading', () => ({
  PqOperationStatus: 'div',
  PqSigningOverlay: 'div',
}));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('hooks/useUtils', () => ({ useUtils: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/passkey', () => ({
  ...jest.requireActual('utils/passkey'),
  createPasskeyCredential: jest.fn(),
  signP256WebAuthnActionHash: jest.fn(),
  signalUnknownPasskeyCredential: jest.fn(),
  signalAcceptedPasskeyCredentials: jest.fn(),
}));

const CHAIN_ID = 57057;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const P256 = getPaliModuleAddress(CHAIN_ID, 'p256-webauthn');
const COMPOSITE = getPaliModuleAddress(CHAIN_ID, 'composite');
const ECDSA = getPaliModuleAddress(CHAIN_ID, 'ecdsa');
const PUBLIC_KEY = {
  x: `0x${'11'.repeat(32)}`,
  y: `0x${'22'.repeat(32)}`,
  originHash: `0x${'33'.repeat(32)}`,
  rpIdHash: `0x${'44'.repeat(32)}`,
  originLength: 52,
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

describe('SmartAccountPolicy passkey preservation', () => {
  let states: any[];
  let refs: any[];
  let index: number;
  let refIndex: number;
  let records: Map<string, string>;
  let metadata: any;
  let profile: any;
  let emitter: jest.Mock;
  let alert: { error: jest.Mock; success: jest.Mock };
  let storageFails: boolean;
  const render = () => {
    index = 0;
    refIndex = 0;
    return SmartAccountPolicy();
  };
  const clickUsePasskey = async () => {
    const card = find(render(), (element) =>
      String(element.key).includes('p256-webauthn')
    )!;
    expect(card).toBeDefined();
    const button = find(card, (element) => element.type === 'button')!;
    await button.props.onClick();
  };
  const recreate = async () => {
    await clickUsePasskey();
    const confirmation = find(
      render(),
      (element) =>
        element.props.title ===
        'settings.smartAccountPasskeyRecreateConfirmTitle'
    )!;
    expect(confirmation.props.show).toBe(true);
    confirmation.props.onClick();
    for (let i = 0; i < 15; i++)
      await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    states = [];
    refs = [];
    storageFails = false;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    profile = {
      credentialId: 'b2xk',
      credentialIdHash: `0x${'55'.repeat(32)}`,
      passkeyName: 'Existing',
      publicKey: PUBLIC_KEY,
      userHandle: Buffer.from(await derivePasskeyUserHandle(ACCOUNT)).toString(
        'base64url'
      ),
    };
    records = new Map([
      [
        `pali-smart-account-passkey:v1:${ACCOUNT}`,
        JSON.stringify({ active: profile }),
      ],
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (storageFails) throw new Error('Storage unavailable');
          records.set(key, value);
        },
        removeItem: (key: string) => records.delete(key),
      },
    });
    metadata = {
      auth: { module: 'composite', validator: COMPOSITE, data: '0x' },
      chainId: CHAIN_ID,
      isDeployed: true,
      installedModules: [
        {
          id: 'ecdsa',
          type: 'validator',
          address: ECDSA,
          config: { owners: [OWNER], threshold: 1 },
        },
        {
          id: 'p256-webauthn',
          type: 'validator',
          address: P256,
          config: profile,
        },
        {
          id: 'composite',
          type: 'validator',
          address: COMPOSITE,
          config: { childValidators: [P256, ECDSA], threshold: 2 },
        },
      ],
    };
    (useSelector as jest.Mock).mockImplementation(() => ({
      accounts: {
        [KeyringAccountType.HDAccount]: { 0: { id: 0, address: OWNER } },
        [KeyringAccountType.SmartAccount]: {
          1: {
            id: 1,
            address: ACCOUNT,
            isSmartAccount: true,
            smartAccount: metadata,
          },
        },
      },
      activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
      activeNetwork: { chainId: CHAIN_ID },
    }));
    (signP256WebAuthnActionHash as jest.Mock).mockRejectedValue(
      new Error('Prompt cancelled')
    );
    (createPasskeyCredential as jest.Mock).mockResolvedValue({
      ...PUBLIC_KEY,
      rawId: 'bmV3',
      credentialId: 'bmV3',
      credentialIdHash: `0x${'66'.repeat(32)}`,
      userHandle: 'ZnJlc2g',
    });
    emitter = jest.fn(async ([, method]: string[], params: any[]) => {
      if (method === 'getSmartAccountNativeGasStatus')
        return { hasNativeGas: true };
      if (method === 'prepareSmartAccountExecutions')
        return {
          actionHash: `0x${'77'.repeat(32)}`,
          smartAccount: metadata,
          executions: params[0],
        };
      if (method === 'hydrateSmartAccount') return metadata;
      if (method === 'signSmartAccountActionDigestInternal')
        return `0x${'88'.repeat(65)}`;
      if (method === 'submitSmartAccountExecution')
        return { hash: `0x${'99'.repeat(32)}` };
      throw new Error(`Unexpected ${method}`);
    });
    alert = { error: jest.fn(), success: jest.fn() };
    (useController as jest.Mock).mockReturnValue({
      controllerEmitter: emitter,
      handleWalletLockedError: () => false,
    });
    (useUtils as jest.Mock).mockReturnValue({
      alert,
      useCopyClipboard: () => [null, jest.fn()],
    });
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const i = index++;
      if (!(i in states))
        states[i] = typeof initial === 'function' ? initial() : initial;
      return [
        states[i],
        (value: any) => {
          states[i] = typeof value === 'function' ? value(states[i]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useEffect').mockImplementation(() => undefined);
    jest.spyOn(React, 'useRef').mockImplementation((value) => {
      const i = refIndex++;
      return refs[i] || (refs[i] = { current: value });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('preserves the old composite child when recreation is followed by a failed rotation', async () => {
    let oldAvailable = true;
    (createPasskeyCredential as jest.Mock).mockImplementation(
      async ({ userId }: any) => {
        if (
          userId &&
          Buffer.from(userId).toString('base64url') === profile.userHandle
        )
          oldAvailable = false;
        return {
          ...PUBLIC_KEY,
          rawId: 'bmV3',
          credentialId: 'bmV3',
          credentialIdHash: `0x${'66'.repeat(32)}`,
          userHandle: 'ZnJlc2g',
        };
      }
    );
    await recreate();
    expect(createPasskeyCredential).toHaveBeenCalledTimes(1);
    expect(createPasskeyCredential).toHaveBeenCalledWith(
      expect.not.objectContaining({ userId: expect.anything() })
    );
    expect(oldAvailable).toBe(true);
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(false);
    expect(alert.error).toHaveBeenCalled();
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe('b2xk');
    expect(
      getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
    ).toBe('bmV3');
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    expect(signalAcceptedPasskeyCredentials).not.toHaveBeenCalled();
  });

  it('does not start rotation if the replacement recovery record cannot be saved', async () => {
    storageFails = true;
    await recreate();
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'prepareSmartAccountExecutions'
      )
    ).toBe(false);
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe('b2xk');
    expect(alert.error).toHaveBeenCalledWith(
      'connections.smartAccountPasskeySaveFailed'
    );
  });

  it('keeps normal ECDSA-authorized passkey rotation working without pruning the old credential', async () => {
    metadata.auth = { module: 'ecdsa', validator: ECDSA, data: '0x' };
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      if (path[1] === 'hydrateSmartAccount')
        return {
          ...metadata,
          auth: { module: 'p256-webauthn', validator: P256, data: '0x' },
        };
      return original(path, params);
    });
    await recreate();
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(true);
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe('bmV3');
    expect(alert.error).not.toHaveBeenCalled();
    expect(alert.success).toHaveBeenCalledWith(
      'settings.smartAccountAuthenticatorConfigured'
    );
    expect(signalUnknownPasskeyCredential).not.toHaveBeenCalled();
    expect(signalAcceptedPasskeyCredentials).not.toHaveBeenCalled();
  });
});
