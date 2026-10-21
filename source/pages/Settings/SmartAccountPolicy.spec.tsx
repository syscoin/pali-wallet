import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { KeyringAccountType } from 'types/network';
import { hexConcat } from 'utils/ethersV6Compat';
import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_SIGNATURE_LIMIT,
  getSLHDSAKeyId,
} from 'utils/slhDsa';
import { getPaliErc7739PersonalSignHash } from 'utils/smartAccount';

import SmartAccountPolicy from './SmartAccountPolicy';

let mockLocation: any;
const mockNavigate = jest.fn();

jest.mock('antd', () => ({ Form: { Item: 'div' }, Input: 'input' }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: 'span' }));
jest.mock('components/index', () => ({
  Button: 'button',
  ConfirmationModal: 'div',
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
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const GUARDIAN = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';
const VALIDATOR = '0x4444444444444444444444444444444444444444';
const CHAIN_ID = 57057;
const OPERATION = {
  account: ACCOUNT,
  chainId: CHAIN_ID,
  executionCalldata: '0x1234',
  hash: `0x${'55'.repeat(32)}`,
  mode: `0x${'00'.repeat(32)}`,
  policyEpoch: '7',
  salt: `0x${'66'.repeat(32)}`,
};
const SIGNATURE = `0x${'77'.repeat(65)}`;
const smartGuardian = {
  auth: { data: '0x', module: 'ecdsa', validator: VALIDATOR },
  chainId: CHAIN_ID,
  installedModules: [
    {
      address: VALIDATOR,
      config: { owners: [OWNER], threshold: 1 },
      id: 'ecdsa',
      type: 'validator',
    },
  ],
  isDeployed: true,
};

const findElement = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = findElement(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

describe('SmartAccountPolicy guardian approval', () => {
  let hookStates: any[];
  let hookIndex: number;
  let controllerEmitter: jest.Mock;
  let alert: { error: jest.Mock; info: jest.Mock; success: jest.Mock };
  let copy: jest.Mock;

  const render = () => {
    hookIndex = 0;
    return SmartAccountPolicy();
  };

  const click = async (label: string) => {
    const button = findElement(
      render(),
      (element) =>
        element.type === 'button' &&
        Boolean(findElement(element, (child) => child.props.children === label))
    );
    expect(button).toBeDefined();
    expect(button!.props.disabled).toBeFalsy();
    await button!.props.onClick();
  };

  beforeEach(() => {
    // Keep component state between button actions without mounting browser-only
    // presentation components. The recovery handler and signing drivers are real.
    hookStates = [];
    mockLocation = {
      pathname: '/settings/account/smart-account-policy',
      search: '?view=modules',
      hash: '#policy',
      state: { returnContext: { returnRoute: '/home/smart-account' } },
    };
    mockNavigate.mockReset().mockImplementation((_path, options) => {
      mockLocation = { ...mockLocation, state: options.state };
    });
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = hookIndex++;
      if (!(index in hookStates)) {
        hookStates[index] = typeof initial === 'function' ? initial() : initial;
        // This handler-only harness suppresses effects; model the successful
        // entry read. Real pending/failure behavior is tested in lifetime.spec.
        if (
          hookStates[index]?.status === 'pending' &&
          typeof hookStates[index]?.key === 'string'
        )
          hookStates[index] = { ...hookStates[index], status: 'ready' };
      }
      return [
        hookStates[index],
        (value: any) => {
          hookStates[index] =
            typeof value === 'function' ? value(hookStates[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest
      .spyOn(React, 'useRef')
      .mockImplementation((value) => ({ current: value }));
    jest.spyOn(React, 'useEffect').mockImplementation(() => undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: jest.fn(), setItem: jest.fn() },
    });
    alert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
    copy = jest.fn().mockResolvedValue(undefined);
    (useUtils as jest.Mock).mockReturnValue({
      alert,
      navigate: mockNavigate,
      useCopyClipboard: () => [null, copy],
    });
    controllerEmitter = jest.fn(async ([, method]: string[]) => {
      switch (method) {
        case 'getWalletSessionGeneration':
          return 7;
        case 'prepareSmartAccountGuardianStartRecovery':
          return { operation: OPERATION, smartGuardian };
        case 'validateSmartAccountGuardianRecoveryOperation':
          return true;
        case 'signSmartAccountActionDigestInternal':
          return SIGNATURE;
        case 'submitPreparedSmartAccountGuardianStartRecovery':
          return { operation: OPERATION };
        default:
          throw new Error(`Unexpected controller method ${method}`);
      }
    });
    (useController as jest.Mock).mockReturnValue({
      controllerEmitter,
      handleWalletLockedError: () => false,
    });
    const vault = {
      accounts: {
        [KeyringAccountType.HDAccount]: { 0: { address: OWNER, id: 0 } },
        [KeyringAccountType.SmartAccount]: {
          1: {
            address: ACCOUNT,
            id: 1,
            isSmartAccount: true,
            smartAccount: {
              ...smartGuardian,
              installedModules: [
                ...smartGuardian.installedModules,
                {
                  address: '0x8888888888888888888888888888888888888888',
                  config: {
                    delaySeconds: 60,
                    guardians: [GUARDIAN],
                    threshold: 1,
                  },
                  id: 'guardian-recovery',
                  type: 'executor',
                },
              ],
            },
          },
          2: { address: GUARDIAN, id: 2, smartAccount: smartGuardian },
        },
      },
      activeAccount: { id: 1, type: KeyringAccountType.SmartAccount },
      activeNetwork: { chainId: CHAIN_ID, url: 'https://rpc.test' },
    };
    (useSelector as jest.Mock).mockImplementation((select) =>
      select({ vault, vaultGlobal: { activeSlip44: 60 } })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as any).localStorage;
  });

  it('opens only the trusted Sysnode enrollment page without sharing account data', () => {
    const link = findElement(
      render(),
      (element) =>
        element.type === 'a' &&
        element.props.children?.[0] ===
          'settings.smartAccountRecoveryEmailAlerts'
    );
    expect(link).toBeDefined();
    expect(link!.props.href).toBe(
      'https://sysnode.info/account#recovery-alerts'
    );
    expect(link!.props.target).toBe('_blank');
    expect(link!.props.rel).toBe('noopener noreferrer');
    expect(link!.props.href).not.toContain(ACCOUNT);
  });

  it('offers the short recovery wait on testnet but not when the chain changes to mainnet', () => {
    const testOption = (element: React.ReactElement) =>
      element.type === 'button' &&
      element.props.children ===
        'settings.smartAccountGuardianRecoveryDelayTestnet';
    expect(findElement(render(), testOption)).toBeDefined();
    const selectState = (useSelector as jest.Mock).getMockImplementation()!;
    const currentVault = selectState((state: any) => state.vault);
    (useSelector as jest.Mock).mockImplementation((select) =>
      select({
        vault: {
          ...currentVault,
          activeNetwork: { chainId: 1, url: 'https://rpc.test' },
        },
        vaultGlobal: { activeSlip44: 60 },
      })
    );
    expect(findElement(render(), testOption)).toBeUndefined();
    expect(
      findElement(
        render(),
        (element) =>
          element.type === 'button' &&
          element.props.children ===
            'settings.smartAccountGuardianRecoveryDelayThreeDays'
      )
    ).toBeDefined();
  });

  const startRecovery = async () => {
    await click('settings.smartAccountGuardianRecoveryShowOptions');
    await click('settings.ecdsaAuthenticator');
    const ownerInput = findElement(
      render(),
      (element) =>
        element.props.placeholder === 'settings.recoveryAuthenticatorEcdsaOwner'
    );
    expect(ownerInput).toBeDefined();
    ownerInput!.props.onChange({ target: { value: OWNER } });
    await click('settings.smartAccountGuardianRecoveryStart');
  };

  it('waits for the public owner address copy before announcing success', async () => {
    let complete!: () => void;
    copy.mockReturnValueOnce(
      new Promise<void>((resolve) => (complete = resolve))
    );
    const button = findElement(
      render(),
      (element) => element.type === 'button' && element.props.title === OWNER
    )!;
    expect(button).toBeDefined();
    const request = button.props.onClick();
    expect(copy).toHaveBeenCalledWith(OWNER);
    expect(alert.info).not.toHaveBeenCalled();
    complete();
    await request;
    expect(alert.info).toHaveBeenCalledWith('home.addressCopied');
    expect(alert.error).not.toHaveBeenCalled();
    expect(controllerEmitter).not.toHaveBeenCalled();
  });

  it('handles public owner address copy refusal without success', async () => {
    const failure = Promise.reject(new Error('Synthetic clipboard refusal'));
    void failure.catch(() => undefined);
    copy.mockReturnValueOnce(failure);
    const button = findElement(
      render(),
      (element) => element.type === 'button' && element.props.title === OWNER
    )!;
    expect(button).toBeDefined();
    await button.props.onClick();
    expect(alert.info).not.toHaveBeenCalled();
    expect(alert.error).toHaveBeenCalledWith('transactions.copyFailed');
    expect(controllerEmitter).not.toHaveBeenCalled();
  });

  it('remembers only the recovery pane across reopening and starts its form fresh', async () => {
    await click('settings.smartAccountGuardianRecoveryShowOptions');
    await click('settings.ecdsaAuthenticator');
    findElement(
      render(),
      (element) =>
        element.props.placeholder === 'settings.recoveryAuthenticatorEcdsaOwner'
    )!.props.onChange({ target: { value: OWNER } });
    expect(
      findElement(
        render(),
        (element) =>
          element.props.placeholder ===
          'settings.recoveryAuthenticatorEcdsaOwner'
      )!.props.value
    ).toBe(OWNER);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/settings/account/smart-account-policy?view=modules#policy',
      {
        replace: true,
        state: {
          returnContext: { returnRoute: '/home/smart-account' },
          smartAccountPolicyView: 'recovery',
          policyParentScroll: 0,
          policyParentScrollPositions: {},
          scrollPositions: {
            'wallet-layout': 0,
            'smart-account-policy-recovery': 0,
          },
          scrollRestorationKey: expect.any(String),
        },
      }
    );

    hookStates = [];
    expect(
      findElement(
        render(),
        (element) =>
          element.props['data-navigation-scroll'] ===
          'smart-account-policy-recovery'
      )
    ).toBeDefined();
    await click('settings.ecdsaAuthenticator');
    expect(
      findElement(
        render(),
        (element) =>
          element.props.placeholder ===
          'settings.recoveryAuthenticatorEcdsaOwner'
      )!.props.value
    ).toBe('');
    expect(controllerEmitter).not.toHaveBeenCalled();
  });

  it('returns from recovery to the same policy pane and parent chain', async () => {
    await click('settings.smartAccountGuardianRecoveryShowOptions');
    mockLocation.state.policyParentScroll = 173;
    mockLocation.state.policyParentScrollPositions = { 'wallet-layout': 417 };
    const back = findElement(
      render(),
      (element) =>
        element.type === 'button' &&
        element.props.children === 'settings.smartAccountGuardianRecoveryBack'
    )!;
    back.props.onClick();
    expect(mockNavigate).toHaveBeenLastCalledWith(
      '/settings/account/smart-account-policy?view=modules#policy',
      {
        replace: true,
        state: {
          returnContext: { returnRoute: '/home/smart-account' },
          scrollPositions: {
            'wallet-layout': 417,
            'smart-account-policy-recovery': 0,
            'smart-account-policy': 173,
          },
          scrollRestorationKey: expect.any(String),
        },
      }
    );
    expect(
      findElement(
        render(),
        (element) =>
          element.props['data-navigation-scroll'] === 'smart-account-policy'
      )
    ).toBeDefined();
  });

  it('signs the guardian ERC-7739 digest and submits the original recovery operation', async () => {
    await startRecovery();

    const wrappedHash = getPaliErc7739PersonalSignHash({
      accountAddress: GUARDIAN,
      chainId: OPERATION.chainId,
      hash: OPERATION.hash,
    });
    expect(wrappedHash).not.toBe(OPERATION.hash);
    expect(controllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'signSmartAccountActionDigestInternal'],
      [[OWNER, wrappedHash], { id: 0, type: KeyringAccountType.HDAccount }],
      10000
    );
    expect(controllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'submitPreparedSmartAccountGuardianStartRecovery'],
      [
        {
          account: ACCOUNT,
          executionContextId: undefined,
          expectedContext: expect.objectContaining({ sessionGeneration: 7 }),
          approval: {
            guardian: GUARDIAN,
            signature: hexConcat([VALIDATOR, SIGNATURE]),
          },
          gasPayer: undefined,
          guardian: GUARDIAN,
          operation: OPERATION,
        },
      ],
      300000
    );
    expect(alert.error).not.toHaveBeenCalled();
    expect(alert.success).toHaveBeenCalled();
  });

  it('preserves a prepared EOA approval without invoking smart-account signing', async () => {
    const approval = { guardian: GUARDIAN, signature: SIGNATURE };
    const original = controllerEmitter.getMockImplementation()!;
    controllerEmitter.mockImplementation((path, ...args) =>
      path[1] === 'prepareSmartAccountGuardianStartRecovery'
        ? Promise.resolve({ approval, operation: OPERATION })
        : original(path, ...args)
    );

    await startRecovery();

    expect(
      controllerEmitter.mock.calls
        .map(([[, method]]) => method)
        .filter((method) => method !== 'getWalletSessionGeneration')
    ).toEqual([
      'prepareSmartAccountGuardianStartRecovery',
      'submitPreparedSmartAccountGuardianStartRecovery',
    ]);
    expect(
      controllerEmitter.mock.calls.find(
        ([[, method]]) =>
          method === 'submitPreparedSmartAccountGuardianStartRecovery'
      )![1][0]
    ).toMatchObject({
      approval,
      operation: OPERATION,
    });
    expect(alert.error).not.toHaveBeenCalled();
  });

  it.each(['cached', 'freshly hydrated'])(
    'binds a %s non-active SLH guardian to its own account and recovery domain',
    async (cacheStatus) => {
      const publicKey = {
        pkRoot: `0x${'12'.repeat(16)}${'00'.repeat(16)}`,
        pkSeed: `0x${'34'.repeat(16)}${'00'.repeat(16)}`,
      };
      const keyId = getSLHDSAKeyId(publicKey);
      const pqGuardian = {
        ...smartGuardian,
        auth: { data: '0x', module: 'slh-dsa', validator: VALIDATOR },
        installedModules: [
          {
            address: VALIDATOR,
            config: {
              ...publicKey,
              keyId,
              parameterSet: SLH_DSA_PARAMETER_SET,
              signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
            },
            id: 'slh-dsa',
            type: 'validator',
          },
        ],
      };
      const vault = (useSelector as jest.Mock).getMockImplementation()!(
        (state: any) => state.vault
      );
      // The recovery Settings entry belongs to account 1, but account 3 is
      // selected and guardian 2 must sign. A cold entry can have stale cached
      // guardian metadata while the controller returns its hydrated policy.
      mockLocation.state = {
        ...mockLocation.state,
        accountType: KeyringAccountType.SmartAccount,
        id: 1,
      };
      vault.activeAccount = {
        id: 3,
        type: KeyringAccountType.SmartAccount,
      };
      vault.accounts[KeyringAccountType.SmartAccount][3] = {
        address: OWNER,
        id: 3,
        isSmartAccount: true,
        smartAccount: smartGuardian,
      };
      vault.accounts[KeyringAccountType.SmartAccount][2].smartAccount =
        cacheStatus === 'cached' ? pqGuardian : smartGuardian;
      const pqSignature = `0x${'89'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;
      const original = controllerEmitter.getMockImplementation()!;
      controllerEmitter.mockImplementation(
        async (path: string[], payload: any[]) => {
          if (path[1] === 'prepareSmartAccountGuardianStartRecovery') {
            return { operation: OPERATION, smartGuardian: pqGuardian };
          }
          if (path[1] === 'signSLHDSAActionHash') return pqSignature;
          return original(path, payload);
        }
      );

      await startRecovery();

      const wrappedHash = getPaliErc7739PersonalSignHash({
        accountAddress: GUARDIAN,
        chainId: CHAIN_ID,
        hash: OPERATION.hash,
      });
      expect(controllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'signSLHDSAActionHash'],
        [
          {
            ...publicKey,
            accountId: 2,
            actionHash: wrappedHash,
            allowReservedSignature: undefined,
            keyId,
            parameterSet: SLH_DSA_PARAMETER_SET,
          },
        ],
        600000
      );
      expect(
        controllerEmitter.mock.calls.some(
          ([[, method]]) => method === 'signSmartAccountActionDigestInternal'
        )
      ).toBe(false);
      expect(controllerEmitter).toHaveBeenCalledWith(
        ['wallet', 'submitPreparedSmartAccountGuardianStartRecovery'],
        [
          {
            account: ACCOUNT,
            executionContextId: undefined,
            expectedContext: expect.objectContaining({ sessionGeneration: 7 }),
            approval: {
              guardian: GUARDIAN,
              signature: hexConcat([VALIDATOR, pqSignature]),
            },
            gasPayer: undefined,
            guardian: GUARDIAN,
            operation: OPERATION,
          },
        ],
        300000
      );
      expect(alert.error).not.toHaveBeenCalled();
    }
  );

  it('does not sign or submit a smart guardian approval when policy revalidation fails', async () => {
    const original = controllerEmitter.getMockImplementation()!;
    controllerEmitter.mockImplementation((path, ...args) =>
      path[1] === 'validateSmartAccountGuardianRecoveryOperation'
        ? Promise.reject(new Error('PALI_GUARDIAN_RECOVERY_POLICY_CHANGED'))
        : original(path, ...args)
    );

    await startRecovery();

    expect(
      controllerEmitter.mock.calls
        .map(([[, method]]) => method)
        .filter((method) => method !== 'getWalletSessionGeneration')
    ).toEqual([
      'prepareSmartAccountGuardianStartRecovery',
      'validateSmartAccountGuardianRecoveryOperation',
    ]);
    expect(alert.error).toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });
});
