jest.unmock('crypto');

import { webcrypto } from 'crypto';
import { Wallet } from 'ethers/wallet';
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
import {
  getSLHDSAKeyId,
  SLH_DSA_SIGNATURE_LIMIT,
} from 'utils/slhDsa/constants';
import {
  buildECDSAAuthenticator,
  buildP256WebAuthnAuthenticator,
  buildSLHDSAAuthenticator,
} from 'utils/smartAccount/authenticators';
import { getPaliModuleAddress } from 'utils/smartAccount/contracts';
import { paliSmartAccountInterface } from 'utils/smartAccount/contracts';
import { listCompositeChildCandidates } from 'utils/smartAccount/custom';
import { buildCompositeValidatorExecutions } from 'utils/smartAccount/moduleCommands';
import { isPaliValidatorAlgorithmSupported } from 'utils/smartAccount/validatorSignability';

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
jest.mock('hooks/useUtils', () => ({ useUtils: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    key: mockPolicyKey,
    pathname: '/settings/account/smart-account-policy',
    search: '',
    hash: '',
    state: null,
  }),
}));
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
const mockOwnerWallet = new Wallet('0x' + '32'.repeat(32));
const OWNER = mockOwnerWallet.address;
let mockPolicyKey = 'policy';
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
  const clickUsePasskey = async (add = false) => {
    const card = find(render(), (element) =>
      String(element.key).includes('p256-webauthn')
    )!;
    expect(card).toBeDefined();
    const button = find(
      card,
      (element) =>
        element.type === 'button' &&
        React.Children.toArray(element.props.children).includes(
          add
            ? 'settings.addToCombinedApprovals'
            : 'settings.useSmartAccountValidator'
        )
    )!;
    await button.props.onClick();
  };
  const waitForTerminalResult = async () => {
    const deadline = Date.now() + 5000;
    while (!alert.error.mock.calls.length && !alert.success.mock.calls.length) {
      if (Date.now() >= deadline)
        throw new Error(
          'Passkey recreation did not report a terminal result within 5 seconds'
        );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const recreate = async (add = false) => {
    await clickUsePasskey(add);
    const confirmation = find(
      render(),
      (element) =>
        element.props.title ===
        'settings.smartAccountPasskeyRecreateConfirmTitle'
    )!;
    expect(confirmation.props.show).toBe(true);
    confirmation.props.onClick();
    await waitForTerminalResult();
  };

  beforeEach(async () => {
    mockPolicyKey = 'policy';
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
    (useSelector as jest.Mock).mockImplementation((select) =>
      select({
        vault: {
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
          activeNetwork: { chainId: CHAIN_ID, url: 'https://rpc.test' },
        },
        vaultGlobal: { activeSlip44: 60 },
      })
    );
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
      if (method === 'getWalletSessionGeneration') return 7;
      if (
        method === 'assertSmartAccountExecutionContext' ||
        method === 'assertSmartAccountPreparedNonce'
      )
        return;
      if (method === 'getSmartAccountNativeGasStatus')
        return { hasNativeGas: true };
      if (method === 'prepareSmartAccountExecutions')
        return {
          accountId: 1,
          actionHash: `0x${'77'.repeat(32)}`,
          executionContextId: 'policy-operation',
          smartAccount: metadata,
          executions: params[0],
        };
      if (method === 'hydrateSmartAccount') return metadata;
      if (method === 'signSmartAccountPreparedOwner')
        return mockOwnerWallet.signingKey.sign(`0x${'77'.repeat(32)}`)
          .serialized;
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
      if (!(i in states)) {
        states[i] = typeof initial === 'function' ? initial() : initial;
        // Effects are outside this signing-handler harness. The real entry
        // verification lifecycle has separate rendered regression coverage.
        if (
          states[i]?.status === 'pending' &&
          typeof states[i]?.key === 'string'
        )
          states[i] = { ...states[i], status: 'ready' };
      }
      return [
        states[i],
        (value: any) => {
          states[i] = typeof value === 'function' ? value(states[i]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
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

  it('waits for delayed recreation to report its terminal result', async () => {
    let finishCredential!: () => void;
    let credentialStarted!: () => void;
    const credentialGate = new Promise<void>((resolve) => {
      finishCredential = resolve;
    });
    const started = new Promise<void>((resolve) => {
      credentialStarted = resolve;
    });
    const original = (
      createPasskeyCredential as jest.Mock
    ).getMockImplementation()!;
    (createPasskeyCredential as jest.Mock).mockImplementation(
      async (params) => {
        credentialStarted();
        await credentialGate;
        return original(params);
      }
    );
    let finished = false;
    const recreating = recreate().then(() => {
      finished = true;
    });
    await started;
    try {
      // Keep the operation deliberately pending beyond the old tick budget.
      for (let tick = 0; tick < 20; tick++)
        await new Promise((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      expect(alert.error).not.toHaveBeenCalled();
      expect(alert.success).not.toHaveBeenCalled();
    } finally {
      finishCredential();
      await recreating;
      await waitForTerminalResult();
    }
    expect(alert.error).toHaveBeenCalled();
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe('b2xk');
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
    const source = buildECDSAAuthenticator({
      chainId: CHAIN_ID,
      config: { owners: [OWNER], threshold: 1 },
    });
    metadata = { ...metadata, ...source.metadata, auth: source.auth };
    const target = buildP256WebAuthnAuthenticator({
      chainId: CHAIN_ID,
      config: { publicKey: PUBLIC_KEY },
    });
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      if (path[1] === 'submitSmartAccountExecution') {
        metadata = { ...metadata, ...target.metadata, auth: target.auth };
      }
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

  it.each([
    'success',
    'wrong target',
    'active changed',
    'rejected',
    'lost response',
  ])(
    'adds a passkey without replacing ECDSA and validates the observed result (%s)',
    async (outcome) => {
      const source = buildECDSAAuthenticator({
        chainId: CHAIN_ID,
        config: { owners: [OWNER], threshold: 1 },
      });
      metadata = { ...metadata, ...source.metadata, auth: source.auth };
      const target = buildP256WebAuthnAuthenticator({
        chainId: CHAIN_ID,
        config: { publicKey: PUBLIC_KEY },
      });
      const original = emitter.getMockImplementation()!;
      emitter.mockImplementation(async (path: string[], params: any[]) => {
        if (path[1] === 'submitSmartAccountExecution') {
          if (outcome === 'rejected') throw new Error('Rejected');
          metadata = {
            ...metadata,
            installedModules: [
              ...source.metadata.installedModules!,
              ...structuredClone(target.metadata.installedModules!),
            ],
          };
          if (outcome === 'wrong target')
            metadata.installedModules[1].config.publicKey.x = `0x${'99'.repeat(
              32
            )}`;
          if (outcome === 'active changed') metadata.auth = target.auth;
          if (outcome === 'lost response')
            throw new Error('Connection lost after broadcast');
        }
        return original(path, params);
      });
      await recreate(true);
      const prepared = emitter.mock.calls.find(
        ([[, method]]) => method === 'prepareSmartAccountExecutions'
      )!;
      expect(prepared).toBeDefined();
      const calls = prepared[1][0].map((call: any) =>
        paliSmartAccountInterface.parseTransaction({ data: call.data })
      );
      expect(calls.map((call: any) => call.name)).toEqual([
        'installModule',
        'rotateValidator',
      ]);
      expect(calls[1].args[0].toLowerCase()).toBe(
        source.auth.validator.toLowerCase()
      );
      expect(calls[1].args[2]).toBe(source.auth.data);
      if (outcome === 'success') {
        expect(metadata.auth).toEqual(source.auth);
        expect(alert.error).not.toHaveBeenCalled();
        expect(alert.success).toHaveBeenCalled();
        expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
          'bmV3'
        );
        // The new method is already installed: another additive action is unavailable.
        const card = find(render(), (element) =>
          String(element.key).includes('p256-webauthn')
        )!;
        expect(
          find(
            card,
            (element) =>
              element.type === 'button' &&
              React.Children.toArray(element.props.children).includes(
                'settings.addToCombinedApprovals'
              )
          )
        ).toBeUndefined();
      } else {
        expect(alert.success).not.toHaveBeenCalled();
        expect(alert.error).toHaveBeenCalled();
        expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
          'b2xk'
        );
        expect(
          getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
        ).toBe('bmV3');
        if (outcome === 'lost response') {
          // Recreate the UI after the accepted transaction becomes observable.
          states = [];
          refs = [];
          alert.error.mockClear();
          const reopened = render();
          const card = find(reopened, (element) =>
            String(element.key).includes('p256-webauthn')
          )!;
          expect(
            find(
              card,
              (element) =>
                element.type === 'button' &&
                React.Children.toArray(element.props.children).includes(
                  'settings.addToCombinedApprovals'
                )
            )
          ).toBeUndefined();
          expect(createPasskeyCredential).toHaveBeenCalledTimes(1);
          expect(
            listCompositeChildCandidates(metadata).map((module) => module.id)
          ).toEqual(['ecdsa', 'p256-webauthn']);
          const combined = buildCompositeValidatorExecutions({
            accountAddress: ACCOUNT,
            metadata,
            children: [ECDSA, P256],
            threshold: 2,
            compositeValidatorAddress: COMPOSITE,
            isAlgorithmAvailable: isPaliValidatorAlgorithmSupported,
          });
          expect(combined).toHaveLength(1);
          expect(
            paliSmartAccountInterface.parseTransaction({
              data: combined[0].data,
            })!.name
          ).toBe('installModule');
          expect(
            getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
          ).toBe('bmV3');
        }
      }
    }
  );

  it('does not fall back to replacement if the additive source changes during credential creation', async () => {
    const source = buildECDSAAuthenticator({
      chainId: CHAIN_ID,
      config: { owners: [OWNER], threshold: 1 },
    });
    metadata = { ...metadata, ...source.metadata, auth: source.auth };
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      if (path[1] === 'hydrateSmartAccount') {
        const changed = buildECDSAAuthenticator({
          chainId: CHAIN_ID,
          config: { owners: [ACCOUNT], threshold: 1 },
        });
        return { ...metadata, ...changed.metadata, auth: changed.auth };
      }
      return original(path, params);
    });
    await recreate(true);
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(false);
    expect(alert.success).not.toHaveBeenCalled();
  });

  it('keeps recreate consent bound to the additive purpose and its exact policy visit', async () => {
    const source = buildECDSAAuthenticator({
      chainId: CHAIN_ID,
      config: { owners: [OWNER], threshold: 1 },
    });
    metadata = { ...metadata, ...source.metadata, auth: source.auth };
    await clickUsePasskey(true);
    const oldPrompt = find(
      render(),
      (element) =>
        element.props.title ===
        'settings.smartAccountPasskeyRecreateConfirmTitle'
    )!;
    expect(oldPrompt.props.show).toBe(true);
    expect(oldPrompt.props.description).toContain(
      'settings.existingApprovalUnchanged'
    );
    mockPolicyKey = 'new-policy-visit';
    const nextPrompt = find(
      render(),
      (element) =>
        element.props.title ===
        'settings.smartAccountPasskeyRecreateConfirmTitle'
    )!;
    expect(nextPrompt?.props.show ?? false).toBe(false);
    await oldPrompt.props.onClick();
    expect(createPasskeyCredential).not.toHaveBeenCalled();
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'prepareSmartAccountExecutions'
      )
    ).toBe(false);
  });

  it('adds the Pali wallet to a passkey account without activating it', async () => {
    const source = buildP256WebAuthnAuthenticator({
      chainId: CHAIN_ID,
      config: profile,
    });
    const target = buildECDSAAuthenticator({
      chainId: CHAIN_ID,
      config: { owners: [OWNER], threshold: 1 },
    });
    metadata = { ...metadata, ...source.metadata, auth: source.auth };
    jest
      .spyOn(
        jest.requireActual('utils/passkey/authenticator'),
        'signP256WebAuthnActionHash'
      )
      .mockResolvedValue({ signature: '0x7788', proof: {} } as any);
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      if (path[1] === 'submitSmartAccountExecution')
        metadata = {
          ...metadata,
          installedModules: [
            ...source.metadata.installedModules!,
            ...target.metadata.installedModules!,
          ],
        };
      return original(path, params);
    });
    const card = find(render(), (element) =>
      String(element.key).endsWith('ecdsa')
    )!;
    expect(card).toBeDefined();
    const add = find(
      card,
      (element) =>
        element.type === 'button' &&
        React.Children.toArray(element.props.children).includes(
          'settings.addToCombinedApprovals'
        )
    )!;
    await add.props.onClick();
    expect(alert.error).not.toHaveBeenCalled();
    expect(alert.success).toHaveBeenCalled();
    expect(metadata.auth).toEqual(source.auth);
    const prepared = emitter.mock.calls.find(
      ([[, method]]) => method === 'prepareSmartAccountExecutions'
    )!;
    expect(
      prepared[1][0].map(
        (call: any) =>
          paliSmartAccountInterface.parseTransaction({ data: call.data })!.name
      )
    ).toEqual(['installModule', 'rotateValidator']);
  });

  it.each(['wrong config', 'unavailable metadata'])(
    'keeps the pending credential when the confirmed target has %s',
    async (failure) => {
      const source = buildECDSAAuthenticator({
        chainId: CHAIN_ID,
        config: { owners: [OWNER], threshold: 1 },
      });
      metadata = { ...metadata, ...source.metadata, auth: source.auth };
      const target = buildP256WebAuthnAuthenticator({
        chainId: CHAIN_ID,
        config: { publicKey: PUBLIC_KEY },
      });
      const original = emitter.getMockImplementation()!;
      let submitted = false;
      emitter.mockImplementation(async (path: string[], params: any[]) => {
        if (path[1] === 'submitSmartAccountExecution') {
          submitted = true;
          metadata = { ...metadata, ...target.metadata, auth: target.auth };
          metadata.installedModules[0].config.publicKey = {
            ...PUBLIC_KEY,
            originHash: `0x${'99'.repeat(32)}`,
          };
        }
        if (
          path[1] === 'hydrateSmartAccount' &&
          submitted &&
          failure === 'unavailable metadata'
        )
          throw new Error('RPC unavailable');
        return original(path, params);
      });
      await recreate();
      expect(submitted).toBe(true);
      expect(alert.success).not.toHaveBeenCalled();
      expect(alert.error).toHaveBeenCalled();
      expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe(
        'b2xk'
      );
      expect(
        getPasskeyAccountRecords(ACCOUNT).pending?.profile.credentialId
      ).toBe('bmV3');
    }
  );

  it('refuses a changed canonical source immediately before submission', async () => {
    const source = buildECDSAAuthenticator({
      chainId: CHAIN_ID,
      config: { owners: [OWNER], threshold: 1 },
    });
    metadata = { ...metadata, ...source.metadata, auth: source.auth };
    const original = emitter.getMockImplementation()!;
    emitter.mockImplementation(async (path: string[], params: any[]) => {
      if (path[1] === 'hydrateSmartAccount') {
        const changed = buildECDSAAuthenticator({
          chainId: CHAIN_ID,
          config: { owners: [ACCOUNT], threshold: 1 },
        });
        return { ...metadata, ...changed.metadata, auth: changed.auth };
      }
      return original(path, params);
    });
    await recreate();
    expect(
      emitter.mock.calls.some(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toBe(false);
    expect(alert.success).not.toHaveBeenCalled();
    expect(getPasskeyAccountRecords(ACCOUNT).active?.credentialId).toBe('b2xk');
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'uses the shared command for an owned prepared SLH key and checks hydrated config (mismatch %s, add %s)',
    async (mismatch, add) => {
      const source = buildECDSAAuthenticator({
        chainId: CHAIN_ID,
        config: { owners: [OWNER], threshold: 1 },
      });
      metadata = { ...metadata, ...source.metadata, auth: source.auth };
      const publicKey = {
        pkRoot: `0x${'44'.repeat(16)}${'00'.repeat(16)}`,
        pkSeed: `0x${'55'.repeat(16)}${'00'.repeat(16)}`,
      };
      const config = {
        ...publicKey,
        keyId: getSLHDSAKeyId(publicKey),
        parameterSet: 'SLH-DSA-SHA2-128-24' as const,
        signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
      };
      const target = buildSLHDSAAuthenticator({ chainId: CHAIN_ID, config });
      const original = emitter.getMockImplementation()!;
      emitter.mockImplementation(async (path: string[], params: any[]) => {
        if (path[1] === 'getSLHDSAPreparedSmartAccountSigner')
          return { accountId: 1, config, version: 1, updatedAt: 1 };
        if (path[1] === 'hasSLHDSALocalSignerState') return true;
        if (path[1] === 'clearSLHDSASmartAccountSetupStatus') return;
        if (path[1] === 'submitSmartAccountExecution') {
          metadata = add
            ? {
                ...metadata,
                installedModules: [
                  ...source.metadata.installedModules!,
                  ...target.metadata.installedModules!,
                ],
              }
            : { ...metadata, ...target.metadata, auth: target.auth };
          if (mismatch)
            metadata.installedModules[add ? 1 : 0].config = {
              ...config,
              pkRoot: `0x${'66'.repeat(32)}`,
            };
        }
        return original(path, params);
      });
      const card = find(render(), (element) =>
        String(element.key).includes('slh-dsa')
      )!;
      expect(card).toBeDefined();
      await find(
        card,
        (element) =>
          element.type === 'button' &&
          React.Children.toArray(element.props.children).includes(
            add
              ? 'settings.addToCombinedApprovals'
              : 'settings.useSmartAccountValidator'
          )
      )!.props.onClick();
      const confirmation = find(
        render(),
        (element) => element.props.title === 'settings.slhDsaAuthenticator'
      )!;
      expect(confirmation.props.show).toBe(true);
      await confirmation.props.onClick();
      const methods = emitter.mock.calls.map(([[, method]]) => method);
      expect(
        methods.filter((method) => method === 'submitSmartAccountExecution')
      ).toHaveLength(1);
      expect(methods).not.toContain('startSLHDSASmartAccountValidatorSetup');
      if (add) expect(metadata.auth).toEqual(source.auth);
      if (mismatch) {
        expect(methods).not.toContain('clearSLHDSASmartAccountSetupStatus');
        expect(alert.success).not.toHaveBeenCalled();
        expect(alert.error).toHaveBeenCalled();
      } else {
        expect(methods).toContain('clearSLHDSASmartAccountSetupStatus');
        expect(alert.error).not.toHaveBeenCalled();
        expect(alert.success).toHaveBeenCalledWith(
          add
            ? 'settings.addedToCombinedApprovals'
            : 'settings.smartAccountAuthenticatorConfigured'
        );
      }
    }
  );
});
