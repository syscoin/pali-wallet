/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getAddress } from 'utils/ethersV6Compat';
import { SLH_DSA_SIGNATURE_LIMIT, getSLHDSAKeyId } from 'utils/slhDsa';
import {
  encodeEcdsaValidatorInitData,
  encodeSLHDSAValidatorInitData,
  getPaliModuleAddress,
  paliSmartAccountInterface,
} from 'utils/smartAccount';

import { PrepareSmartAccount } from './PrepareSmartAccount';

let mockRequest: any;
let mockSupported: boolean;
const mockEmitter = jest.fn();
const mockClose = jest.fn();

jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <span />,
  DropdownArrowSvg: () => <span />,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => <span />,
}));
jest.mock('components/Loading', () => ({ PqOperationStatus: () => null }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({ host: 'pq.example.test', request: mockRequest }),
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        accounts: {
          HDAccount: {
            0: { id: 0, address: '0x1111111111111111111111111111111111111111' },
          },
        },
        activeNetwork: { chainId: 57057 },
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  isSLHDSAOffscreenSignerSupported: () => mockSupported,
}));

const CHAIN_ID = 57057;
const ACCOUNT_ID = 19;
const ACCOUNT = '0x2222222222222222222222222222222222222222';
const OWNER = '0x1111111111111111111111111111111111111111';
const ECDSA = getPaliModuleAddress(CHAIN_ID, 'ecdsa');
const SLH_DSA = getPaliModuleAddress(CHAIN_ID, 'slh-dsa');
const CONFIG = {
  parameterSet: 'SLH-DSA-SHA2-128-24',
  pkRoot: `0x${'33'.repeat(32)}`,
  pkSeed: `0x${'44'.repeat(32)}`,
  signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
};
const BOOTSTRAP = {
  auth: {
    data: encodeEcdsaValidatorInitData([OWNER], 1),
    module: 'ecdsa',
    validator: ECDSA,
  },
  chainId: CHAIN_ID,
  installedModules: [
    {
      address: ECDSA,
      config: { owners: [OWNER], threshold: 1 },
      id: 'ecdsa',
      type: 'validator',
    },
  ],
  isDeployed: false,
};

const methods = () => mockEmitter.mock.calls.map(([[, method]]) => method);

describe('wallet-managed SLH-DSA creation boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupported = true;
    mockRequest = { authenticator: { id: 'slh-dsa' }, label: 'Local PQ' };
    jest.spyOn(window, 'close').mockImplementation(mockClose);
    mockEmitter.mockImplementation(
      async ([, method]: string[], params: any[]) => {
        switch (method) {
          case 'createSmartAccount':
            return {
              address: ACCOUNT,
              id: ACCOUNT_ID,
              isSmartAccount: true,
              smartAccount: BOOTSTRAP,
            };
          case 'setAccount':
          case 'registerSmartAccountOnChain':
          case 'connect':
          case 'assertSmartAccountExecutionContext':
            return undefined;
          case 'provisionSLHDSASmartAccountValidator':
            return { ...CONFIG, keyId: getSLHDSAKeyId(CONFIG) };
          case 'getSmartAccountNativeGasStatus':
            return { hasNativeGas: true };
          case 'prepareSmartAccountExecutions':
            return {
              actionHash: `0x${'55'.repeat(32)}`,
              executionContextId: 'local-pq-install',
              executions: params[0],
              smartAccount: BOOTSTRAP,
            };
          case 'signSmartAccountActionDigestInternal':
            return `0x${'66'.repeat(65)}`;
          case 'submitSmartAccountExecution':
          case 'hydrateSmartAccount':
            return { hash: `0x${'77'.repeat(32)}` };
          default:
            throw new Error(`Unexpected controller method ${method}`);
        }
      }
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['authenticator', {}],
    ['authenticator', { keyId: 'external-key' }],
    ['authenticator', { pkRoot: CONFIG.pkRoot, pkSeed: CONFIG.pkSeed }],
    ['initialAuthenticator', {}],
    ['initialAuthenticator', { keyId: 'external-key' }],
    ['initialAuthenticator', { pkRoot: CONFIG.pkRoot, pkSeed: CONFIG.pkSeed }],
    ['policy', {}],
    ['policy', { keyId: 'external-key' }],
    ['policy', { pkRoot: CONFIG.pkRoot, pkSeed: CONFIG.pkSeed }],
    ['authenticator', []],
    ['authenticator', true],
    ['authenticator', 1],
    ['authenticator', 'external-key'],
  ])(
    'rejects supplied %s config %p before any privileged call',
    async (field, config) => {
      const authenticator = { config, id: 'slh-dsa' };
      mockRequest =
        field === 'policy'
          ? { policy: { authenticator } }
          : { [field as string]: authenticator };
      render(<PrepareSmartAccount />);
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));

      await screen.findByText('connections.smartAccountPrepareFailed');
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    }
  );

  it('rejects an unsupported signer browser before allocating an account', async () => {
    mockSupported = false;
    render(<PrepareSmartAccount />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await screen.findByText('connections.smartAccountPrepareFailed');
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('provisions the new account locally before installing or connecting its validator', async () => {
    render(<PrepareSmartAccount />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));

    expect(methods().slice(0, 4)).toEqual([
      'createSmartAccount',
      'setAccount',
      'provisionSLHDSASmartAccountValidator',
      'registerSmartAccountOnChain',
    ]);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setAccount'],
      [ACCOUNT_ID, KeyringAccountType.SmartAccount, true]
    );
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'provisionSLHDSASmartAccountValidator'],
      [{ accountId: ACCOUNT_ID }],
      600000
    );
    const prepare = mockEmitter.mock.calls.find(
      ([[, method]]) => method === 'prepareSmartAccountExecutions'
    )!;
    expect(prepare[1][1]).toBe(ACCOUNT_ID);
    const [install, removeBootstrap] = prepare[1][0];
    expect(install.target).toBe(ACCOUNT);
    const installed = paliSmartAccountInterface.parseTransaction({
      data: install.data,
    });
    expect(installed.name).toBe('installModule');
    expect(installed.args[1]).toBe(getAddress(SLH_DSA));
    expect(installed.args[2]).toBe(encodeSLHDSAValidatorInitData(CONFIG));
    const removed = paliSmartAccountInterface.parseTransaction({
      data: removeBootstrap.data,
    });
    expect(removed.name).toBe('uninstallModule');
    expect(removed.args[1]).toBe(getAddress(ECDSA));
    expect(
      methods().indexOf('provisionSLHDSASmartAccountValidator')
    ).toBeLessThan(methods().indexOf('submitSmartAccountExecution'));
    expect(methods().slice(-2)).toEqual(['hydrateSmartAccount', 'connect']);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'wallet_prepareSmartAccount.pq.example.test',
      { address: ACCOUNT, chainId: '0xdee1', installedValidator: SLH_DSA }
    );
  });

  it('does not install or connect when local provisioning fails after account allocation', async () => {
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path: string[], params: any[]) => {
      if (path[1] === 'provisionSLHDSASmartAccountValidator') {
        throw new Error('Local signer unavailable');
      }
      return original(path, params);
    });
    render(<PrepareSmartAccount />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await screen.findByText('Local signer unavailable');
    expect(methods()).toEqual([
      'createSmartAccount',
      'setAccount',
      'provisionSLHDSASmartAccountValidator',
    ]);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
