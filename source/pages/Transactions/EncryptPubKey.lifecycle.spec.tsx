/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import EncryptPubKey from './EncryptPubKey';

const mockCopy = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);
let mockState: any;
let mockQuery: any;
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => null,
}));
jest.mock('components/Icon/Icon', () => ({ LockIconSvg: () => null }));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, loading, ...props }: any) => (
    <button {...props} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Icon: () => null,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCopy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  mockQuery = {
    host: 'https://synthetic.invalid',
    eventName: 'eth_getEncryptionPublicKey',
  };
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: {
            label: 'First synthetic account',
            address: `0x${'11'.repeat(20)}`,
          },
          1: {
            label: 'Second synthetic account',
            address: `0x${'22'.repeat(20)}`,
          },
        },
      },
      activeNetwork: { chainId: 1, url: 'https://first.invalid' },
    },
  };
});
afterEach(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it.each(
  ['account', 'network', 'request', 'unmount', 'round-trip'].flatMap((change) =>
    ['success', 'failure'].map((outcome) => ({ change, outcome }))
  )
)(
  'suppresses a delayed address-copy $outcome after $change changes',
  async ({ change, outcome }) => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      })
    );
    const view = render(<EncryptPubKey />);
    fireEvent.click(
      screen.getByRole('button', { name: 'transactions.copyAddress' })
    );
    if (change === 'unmount') view.unmount();
    else {
      if (change === 'account' || change === 'round-trip')
        mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
      if (change === 'network')
        mockState.vault.activeNetwork = {
          chainId: 2,
          url: 'https://second.invalid',
        };
      if (change === 'request')
        mockQuery = { ...mockQuery, host: 'https://second.invalid' };
      view.rerender(<EncryptPubKey />);
      if (change === 'round-trip') {
        mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
        view.rerender(<EncryptPubKey />);
      }
    }
    await act(async () =>
      outcome === 'failure'
        ? reject(new Error('Private clipboard diagnostic'))
        : finish()
    );
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each(['success', 'failure'])(
  'keeps copy feedback with the latest action when an older action has delayed %s',
  async (outcome) => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      })
    );
    render(<EncryptPubKey />);
    const copy = screen.getByRole('button', {
      name: 'transactions.copyAddress',
    });
    fireEvent.click(copy);
    await act(async () => fireEvent.click(copy));
    expect(mockAlert.info).toHaveBeenCalledTimes(1);
    await act(async () =>
      outcome === 'failure'
        ? reject(new Error('Private clipboard diagnostic'))
        : finish()
    );
    expect(mockAlert.info).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
