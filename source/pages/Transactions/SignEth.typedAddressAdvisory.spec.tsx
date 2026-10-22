/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { typedDataValidationMiddleware } from 'scripts/Background/controllers/message-handler/middleware/typedDataValidationMiddleware';

import EthSign from './SignEth';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'77'.repeat(20)}`;
const genericAddresses = {
  to: `0x${'22'.repeat(20)}`,
  recipient: `0x${'33'.repeat(20)}`,
  operator: `0x${'44'.repeat(20)}`,
  approved: `0x${'55'.repeat(20)}`,
  delegate: `0x${'66'.repeat(20)}`,
};
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
let mockQuery: any;
let mockFlagged = true;

jest.mock('state/store', () => ({ __esModule: true, default: {} }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        accounts: {
          HDAccount: {
            0: {
              address: ACCOUNT,
              balances: { ethereum: '1' },
              label: 'Public account',
            },
          },
        },
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: {
          currency: 'ETH',
          chainId: 1,
          url: 'https://rpc.invalid',
        },
        isBitcoinBased: false,
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  ErrorModal: ({ show, log }: any) =>
    show ? <div role="alert">{log}</div> : null,
  WarningModal: ({ show, title, warningMessage }: any) =>
    show ? (
      <div role="alert">
        {title} {warningMessage}
      </div>
    ) : null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
  IconButton: ({ children }: any) => <span>{children}</span>,
}));

const typedMessage = (
  primaryType: string,
  message: Record<string, string>
) => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    [primaryType]: Object.keys(message).map((name) => ({
      name,
      type: 'address',
    })),
  },
  domain: {
    name: 'Public typed request',
    version: '1',
    chainId: 1,
    verifyingContract: CONTRACT,
  },
  primaryType,
  message,
});

const prepare = async (
  method: string,
  payload: ReturnType<typeof typedMessage>
) => {
  // Exercise the same typed-data validation used before the real popup is
  // created, so the regression cannot depend on an inadmissible route payload.
  const admitted = jest.fn().mockResolvedValue(undefined);
  await typedDataValidationMiddleware(
    {
      originalRequest: { method, params: [ACCOUNT, payload] },
    } as any,
    admitted
  );
  expect(admitted).toHaveBeenCalledTimes(1);
  mockQuery = {
    host: 'https://public-dapp.invalid',
    eventName: method,
    0: ACCOUNT,
    1: payload,
  };
  render(<EthSign />);
  await screen.findByRole('button', { name: 'buttons.confirm' });
};

const checkedAddresses = () =>
  mockEmitter.mock.calls
    .filter(([path]) => path.at(-1) === 'checkAddressBlacklist')
    .map(([, [address]]) => address);

beforeEach(() => {
  jest.clearAllMocks();
  mockFlagged = true;
  // No signer or network call is allowed. The advisory response is synthetic
  // and independent of the valid payload's field names and values.
  mockEmitter.mockImplementation(async (path) => {
    if (path.at(-1) !== 'checkAddressBlacklist')
      throw new Error(`Unexpected method ${path.join('.')}`);
    return {
      isBlacklisted: mockFlagged,
      severity: 'high',
      reason: 'Synthetic advisory fixture',
    };
  });
});

afterEach(() => {
  expect(
    mockEmitter.mock.calls.every(
      ([path]) => path.at(-1) === 'checkAddressBlacklist'
    )
  ).toBe(true);
  cleanup();
});

it('keeps the known Permit spender high-risk advisory', async () => {
  await prepare(
    'eth_signTypedData_v4',
    typedMessage('Permit', { spender: genericAddresses.recipient })
  );
  await waitFor(() =>
    expect(checkedAddresses()).toEqual([genericAddresses.recipient])
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'blacklist.blacklistHighRisk'
  );
});

it('does not warn for a known Permit spender with a safe result', async () => {
  mockFlagged = false;
  await prepare(
    'eth_signTypedData_v4',
    typedMessage('Permit', { spender: genericAddresses.recipient })
  );
  await waitFor(() =>
    expect(checkedAddresses()).toEqual([genericAddresses.recipient])
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

describe.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
  '%s generic address advisories',
  (method) => {
    it('checks every displayed address field and shows flagged results', async () => {
      await prepare(method, typedMessage('Delivery', genericAddresses));
      await waitFor(() =>
        expect(checkedAddresses()).toEqual(Object.values(genericAddresses))
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'blacklist.blacklistHighRisk'
      );
      for (const address of Object.values(genericAddresses))
        expect(screen.getByText(address, { exact: true })).toBeVisible();
    });

    it('checks every address without inventing a warning for safe results', async () => {
      mockFlagged = false;
      await prepare(method, typedMessage('Delivery', genericAddresses));
      await waitFor(() =>
        expect(checkedAddresses()).toEqual(Object.values(genericAddresses))
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.queryByText('blacklist.blacklistCriticalWarning')
      ).not.toBeInTheDocument();
    });
  }
);
