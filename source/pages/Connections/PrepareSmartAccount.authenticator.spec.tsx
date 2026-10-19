/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';
import { getAddress } from 'utils/ethersV6Compat';
import {
  encodeEcdsaValidatorInitData,
  encodeRotateValidatorModuleCall,
  getPaliModuleAddress,
} from 'utils/smartAccount';

import { PrepareSmartAccount } from './PrepareSmartAccount';

let mockRequest: any;
const mockEmitter = jest.fn();
const mockInstall = jest.fn();
const owner = '0x1111111111111111111111111111111111111111';
const otherOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const validator = getPaliModuleAddress(57057, 'ecdsa');
const bootstrapData = encodeEcdsaValidatorInitData([owner], 1);
const bootstrapMetadata = {
  auth: { module: 'ecdsa', validator, data: bootstrapData },
  chainId: 57057,
  installedModules: [
    {
      id: 'ecdsa',
      address: validator,
      type: 'validator',
      data: bootstrapData,
      config: { owners: [owner], threshold: 1 },
    },
  ],
};

jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => ({
    approvalId: 'synthetic-approval',
    host: 'https://local.invalid',
    request: mockRequest,
  }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeNetwork: {
          kind: 'ethereum',
          chainId: 57057,
          url: 'https://local.invalid',
        },
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              address: owner,
            },
            1: { id: 1, address: otherOwner },
          },
        },
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
}));
jest.mock('components/Loading', () => ({ PqOperationStatus: () => null }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  signAndSubmitSmartAccountExecutions: (params: any) => mockInstall(params),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  // Keep normalization and ABI encoding real; replace the controller transport
  // and transaction submission boundaries so no signatures or chain I/O run.
  mockInstall.mockResolvedValue(undefined);
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'createSmartAccount')
      return {
        id: 1,
        address: '0x2222222222222222222222222222222222222222',
        smartAccount: bootstrapMetadata,
      };
    if (
      method === 'setAccount' ||
      method === 'connect' ||
      method === 'registerSmartAccountOnChain'
    )
      return undefined;
    if (method === 'getSmartAccountNativeGasStatus')
      return { hasNativeGas: true };
    if (method === 'hydrateSmartAccount') {
      const request =
        mockRequest.authenticator ||
        mockRequest.initialAuthenticator ||
        mockRequest.policy?.authenticator;
      const config = {
        owners: request.config.owners.map((address: string) =>
          getAddress(address)
        ),
        threshold: request.config.threshold ?? 1,
      };
      const data = encodeEcdsaValidatorInitData(
        config.owners,
        config.threshold
      );
      return {
        ...bootstrapMetadata,
        isDeployed: true,
        auth: { module: 'ecdsa', validator, data },
        installedModules: [
          { id: 'ecdsa', address: validator, type: 'validator', config, data },
        ],
      };
    }
    throw new Error(`Unexpected controller call: ${method}`);
  });
});

afterEach(() => jest.restoreAllMocks());

describe.each(['authenticator', 'initialAuthenticator', 'policy'])(
  'smart-account creation %s validation',
  (field) => {
    it.each(['future-validator', 'SLH-DSA', undefined, 0, true, {}])(
      'rejects unsupported or missing id %p before allocating a default account',
      async (id) => {
        const authenticator = id === undefined ? {} : { id };
        mockRequest =
          field === 'policy'
            ? { policy: { authenticator } }
            : { [field]: authenticator };
        render(<PrepareSmartAccount />);
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'buttons.confirm' })
          );
        });

        expect(mockEmitter).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
        expect(
          screen.getByText('connections.smartAccountPrepareFailed')
        ).toBeTruthy();
      }
    );
  }
);

describe.each(['authenticator', 'initialAuthenticator', 'policy'])(
  'smart-account creation %s owner configuration',
  (field) => {
    it.each([
      null,
      {},
      [],
      { owners: [] },
      { owners: 'invalid' },
      { owners: null },
    ])(
      'rejects explicitly malformed ECDSA config %p without defaulting owners',
      async (config) => {
        const authenticator = { id: 'ecdsa', config };
        mockRequest =
          field === 'policy'
            ? { policy: { authenticator } }
            : { [field]: authenticator };
        render(<PrepareSmartAccount />);
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'buttons.confirm' })
          );
        });

        expect(mockEmitter).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
        expect(
          screen.getByText('connections.smartAccountPrepareFailed')
        ).toBeTruthy();
      }
    );
  }
);

it('permits an explicitly requested default ECDSA account', async () => {
  mockRequest = { authenticator: { id: 'ecdsa' } };
  render(<PrepareSmartAccount />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  });

  expect(mockEmitter.mock.calls.map(([[, method]]) => method)).toEqual([
    'createSmartAccount',
    'setAccount',
    'connect',
  ]);
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

describe.each(['authenticator', 'initialAuthenticator', 'policy'])(
  'smart-account creation %s ECDSA threshold policy',
  (field) => {
    const useConfig = (config: any) => {
      const authenticator = { id: 'ecdsa', config };
      mockRequest =
        field === 'policy'
          ? { policy: { authenticator } }
          : { [field]: authenticator };
    };

    it.each([0, 2, -1, 1.5, '1', null, true])(
      'rejects threshold %p before account allocation or submission',
      async (threshold) => {
        useConfig({ owners: [owner], threshold });
        render(<PrepareSmartAccount />);
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'buttons.confirm' })
          );
        });
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(mockInstall).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
      }
    );

    it.each([
      [owner, owner],
      [otherOwner, getAddress(otherOwner)],
    ])(
      'rejects duplicate normalized owners %p before account allocation',
      async (...owners) => {
        useConfig({ owners, threshold: 2 });
        render(<PrepareSmartAccount />);
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'buttons.confirm' })
          );
        });
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(mockInstall).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
      }
    );

    it.each([
      { owners: [owner] },
      { owners: [owner], threshold: 1 },
      { owners: [owner, otherOwner], threshold: 2 },
    ])(
      'preserves a valid ECDSA policy %p through the approval flow',
      async (config) => {
        useConfig(config);
        render(<PrepareSmartAccount />);
        await act(async () => {
          fireEvent.click(
            screen.getByRole('button', { name: 'buttons.confirm' })
          );
        });
        const expectedData = encodeEcdsaValidatorInitData(
          config.owners,
          config.threshold ?? 1
        );
        expect(mockEmitter.mock.calls.map(([[, method]]) => method)).toEqual([
          'createSmartAccount',
          'setAccount',
          'registerSmartAccountOnChain',
          'getSmartAccountNativeGasStatus',
          'hydrateSmartAccount',
          'connect',
        ]);
        expect(mockInstall).toHaveBeenCalledWith(
          expect.objectContaining({
            executions: [
              {
                data: encodeRotateValidatorModuleCall(validator, expectedData),
                target: '0x2222222222222222222222222222222222222222',
                value: '0x0',
              },
            ],
          })
        );
        expect(window.close).toHaveBeenCalledTimes(1);
        expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
      }
    );
  }
);
