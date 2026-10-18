/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import { PrepareSmartAccount } from './PrepareSmartAccount';

let mockRequest: any;
const mockEmitter = jest.fn();

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
              address: '0x1111111111111111111111111111111111111111',
            },
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  // Only the allocator/selection/connection transport boundary is synthetic.
  // No signature, chain operation, or production controller executes here.
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'createSmartAccount')
      return {
        id: 1,
        address: '0x2222222222222222222222222222222222222222',
        smartAccount: { auth: { module: 'ecdsa' } },
      };
    if (method === 'setAccount' || method === 'connect') return undefined;
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
