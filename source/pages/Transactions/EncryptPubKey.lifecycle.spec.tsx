/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

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
  mockEmitter.mockReset().mockResolvedValue('public-synthetic-encryption-key');
  mockCopy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  mockQuery = {
    host: 'https://synthetic.invalid',
    eventName: 'eth_getEncryptionPublicKey',
    0: `0x${'11'.repeat(20)}`,
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
  jest.restoreAllMocks();
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

it('settles an approved public-key request without closing a replacement page after departure', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise<string>((resolve) => (finish = resolve))
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  const view = render(<EncryptPubKey />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith([
    'wallet',
    'ethereumTransaction',
    'getEncryptedPubKey',
  ]);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  view.unmount();
  render(<div>Replacement wallet page</div>);

  await act(async () => finish('public-synthetic-encryption-key'));

  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'eth_getEncryptionPublicKey.https://synthetic.invalid',
    'public-synthetic-encryption-key'
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Replacement wallet page')).toBeDefined();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('settles and closes a current public-key approval normally', async () => {
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  render(<EncryptPubKey />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'eth_getEncryptionPublicKey.https://synthetic.invalid',
    'public-synthetic-encryption-key'
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});

it('keeps a failed current public-key request retryable', async () => {
  mockEmitter.mockRejectedValueOnce(
    new Error('Synthetic key retrieval failure')
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  render(<EncryptPubKey />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(screen.getByText('Synthetic key retrieval failure')).toBeDefined();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'eth_getEncryptionPublicKey.https://synthetic.invalid',
    'public-synthetic-encryption-key'
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});
