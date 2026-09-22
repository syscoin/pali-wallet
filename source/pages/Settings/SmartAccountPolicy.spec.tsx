import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { KeyringAccountType } from 'types/network';
import { hexConcat } from 'utils/ethersV6Compat';
import { getPaliErc7739PersonalSignHash } from 'utils/smartAccount';

import SmartAccountPolicy from './SmartAccountPolicy';

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
jest.mock('hooks/useUtils', () => ({ useUtils: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
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
  let alert: { error: jest.Mock; success: jest.Mock };

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
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = hookIndex++;
      if (!(index in hookStates)) {
        hookStates[index] = typeof initial === 'function' ? initial() : initial;
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
    alert = { error: jest.fn(), success: jest.fn() };
    (useUtils as jest.Mock).mockReturnValue({
      alert,
      useCopyClipboard: () => [null, jest.fn()],
    });
    controllerEmitter = jest.fn(async ([, method]: string[]) => {
      switch (method) {
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
    (useSelector as jest.Mock).mockReturnValue({
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
      activeNetwork: { chainId: CHAIN_ID },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as any).localStorage;
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
    controllerEmitter.mockResolvedValueOnce({ approval, operation: OPERATION });

    await startRecovery();

    expect(controllerEmitter.mock.calls.map(([[, method]]) => method)).toEqual([
      'prepareSmartAccountGuardianStartRecovery',
      'submitPreparedSmartAccountGuardianStartRecovery',
    ]);
    expect(controllerEmitter.mock.calls[1][1][0]).toMatchObject({
      approval,
      operation: OPERATION,
    });
    expect(alert.error).not.toHaveBeenCalled();
  });

  it('does not sign or submit a smart guardian approval when policy revalidation fails', async () => {
    controllerEmitter
      .mockResolvedValueOnce({ operation: OPERATION, smartGuardian })
      .mockRejectedValueOnce(
        new Error('PALI_GUARDIAN_RECOVERY_POLICY_CHANGED')
      );

    await startRecovery();

    expect(controllerEmitter.mock.calls.map(([[, method]]) => method)).toEqual([
      'prepareSmartAccountGuardianStartRecovery',
      'validateSmartAccountGuardianRecoveryOperation',
    ]);
    expect(alert.error).toHaveBeenCalled();
    expect(alert.success).not.toHaveBeenCalled();
  });
});
