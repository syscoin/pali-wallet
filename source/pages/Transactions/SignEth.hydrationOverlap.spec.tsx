/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import EthSign from './SignEth';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const mockEmitter = jest.fn();
const mockSign = jest.fn();
const mockAlert = { info: jest.fn(), success: jest.fn(), error: jest.fn() };
const metadata = { chainId: 57057, isDeployed: true, installedModules: [] };
const mockQuery = {
  host: 'https://sysnode.info',
  eventName: 'personal_sign',
  0:
    '0x' +
    Buffer.from(
      'Pali recovery QA: verify original owner after guardian removal.'
    ).toString('hex'),
  1: ADDRESS,
};
jest.mock('state/store', () => ({ __esModule: true, default: {} }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { id: 0, type: 'SmartAccount' },
        activeNetwork: { currency: 'TSYS', chainId: 57057 },
        isBitcoinBased: false,
        accounts: {
          SmartAccount: {
            0: {
              id: 0,
              address: ADDRESS,
              label: 'Owned smart account',
              balances: { ethereum: 1 },
              isSmartAccount: true,
              smartAccount: metadata,
            },
          },
        },
      },
    }),
}));
const mockTranslate = (key: string) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
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
jest.mock('utils/index', () => ({ truncate: (v: string) => v }));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => ({}),
  getPaliErc7739PersonalSignHash: () => '0x' + 'ab'.repeat(32),
  signSmartAccountActionHash: (...args: any[]) => mockSign(...args),
  encodeSmartAccountAuthenticatorSignature: () => '0x' + 'cd'.repeat(85),
}));
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
  ErrorModal: ({ show, log, title, onClose }: any) =>
    show ? (
      <div role="alert">
        <strong>{title}</strong>
        <span>{log}</span>
        <button onClick={onClose}>Dismiss error</button>
      </div>
    ) : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
  IconButton: ({ children }: any) => <span>{children}</span>,
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockSign.mockResolvedValue({});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('shows a localized context-change request only after confirmation, signs nothing, and closes rather than retrying on dismiss', async () => {
  mockEmitter.mockRejectedValue(new Error('PALI_TRANSACTION_CONTEXT_CHANGED'));
  render(<EthSign />);
  await act(async () => jest.advanceTimersByTime(100));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'hydrateSmartAccount'],
    [0],
    300000
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'transactions.psbtSigningContextChanged'
  );
  expect(screen.getByRole('alert').textContent).not.toContain(
    'PALI_TRANSACTION_CONTEXT_CHANGED'
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'transactions.signatureFailed'
  );
  expect(mockSign).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('a settled metadata read takes the same request through one signing and successful completion', async () => {
  mockEmitter.mockResolvedValue(metadata);
  render(<EthSign />);
  await act(async () => jest.advanceTimersByTime(100));
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(mockSign).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});
