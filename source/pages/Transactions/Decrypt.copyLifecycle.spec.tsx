/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import Decrypt from './Decrypt';

const ADDRESS = `0x${'11'.repeat(20)}`;
const PLAINTEXT = 'Public synthetic plaintext';
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
    useCopyClipboard: () => [
      false,
      (value: string) => navigator.clipboard.writeText(value),
    ],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  LockFilled: () => null,
  LockIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, loading, ...props }: any) => (
    <button {...props} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Icon: () => null,
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children }: any) => children,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCopy.mockReset().mockResolvedValue(undefined);
  mockEmitter.mockReset().mockResolvedValue(PLAINTEXT);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  mockQuery = {
    host: 'https://synthetic.invalid',
    eventName: 'eth_decrypt',
    0: 'public-synthetic-ciphertext',
  };
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: { label: 'First synthetic account', address: ADDRESS },
          1: {
            label: 'Second synthetic account',
            address: `0x${'22'.repeat(20)}`,
          },
        },
      },
      activeNetwork: { chainId: 1, url: 'https://first.invalid' },
      isBitcoinBased: false,
    },
  };
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

const copyAddress = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.copyAddress' })
  );

it.each(
  ['address', 'plaintext'].flatMap((target) =>
    ['success', 'failure'].map((outcome) => ({ target, outcome }))
  )
)(
  'suppresses delayed $target-copy $outcome feedback after leaving the review',
  async ({ target, outcome }) => {
    const view = render(<Decrypt />);
    if (target === 'plaintext') {
      fireEvent.click(
        screen.getByRole('button', { name: 'transactions.decryptMessage' })
      );
      await screen.findByText(PLAINTEXT);
    }
    let finish!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name:
          target === 'plaintext'
            ? 'transactions.copyMessage'
            : 'transactions.copyAddress',
      })
    );
    expect(mockCopy).toHaveBeenCalledWith(
      target === 'plaintext' ? PLAINTEXT : ADDRESS
    );
    expect(mockCopy).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<div>Replacement wallet page</div>);
    await act(async () =>
      outcome === 'failure'
        ? reject(new Error('Private clipboard diagnostic'))
        : finish()
    );
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(screen.getByText('Replacement wallet page')).toBeDefined();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  }
);

it.each(
  ['account', 'network', 'request', 'round-trip'].flatMap((change) =>
    ['success', 'failure'].map((outcome) => ({ change, outcome }))
  )
)(
  'suppresses delayed address-copy $outcome feedback after $change changes',
  async ({ change, outcome }) => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      })
    );
    const view = render(<Decrypt />);
    copyAddress();
    expect(mockCopy).toHaveBeenCalledWith(ADDRESS);
    if (change === 'account' || change === 'round-trip')
      mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
    if (change === 'network')
      mockState.vault.activeNetwork = {
        chainId: 2,
        url: 'https://second.invalid',
      };
    if (change === 'request')
      mockQuery = { ...mockQuery, host: 'https://second.invalid' };
    view.rerender(<Decrypt />);
    if (change === 'round-trip') {
      mockState.vault.activeAccount = { id: 0, type: 'HDAccount' };
      view.rerender(<Decrypt />);
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
  'keeps feedback with the latest copy when an older write has delayed %s',
  async (outcome) => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve, fail) => {
        finish = resolve;
        reject = fail;
      })
    );
    render(<Decrypt />);
    copyAddress();
    await act(async () => copyAddress());
    expect(mockCopy).toHaveBeenCalledTimes(2);
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
