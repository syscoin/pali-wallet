/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import Decrypt from './Decrypt';
import EncryptPubKey from './EncryptPubKey';

const ADDRESS = `0x${'11'.repeat(20)}`;
const CIPHERTEXT = 'synthetic-encrypted-message';
const PLAINTEXT = 'Synthetic decrypted fixture message';
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
    useCopyClipboard: () => {
      const [copied, setCopied] = jest.requireActual('react').useState(false);
      return [
        copied,
        async (value: string) => {
          await mockCopy(value);
          setCopied(true);
        },
      ];
    },
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: () => <span>0 TSYS</span>,
}));
jest.mock('components/Icon/Icon', () => ({
  LockFilled: () => null,
  LockIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Icon: () => <svg aria-hidden="true" />,
  IconButton: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => children,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCopy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  mockEmitter.mockResolvedValue(PLAINTEXT);
  mockQuery = {
    host: 'synthetic.example.invalid',
    eventName: 'synthetic-encryption-request',
    0: CIPHERTEXT,
  };
  mockState = {
    vault: {
      accounts: {
        HDAccount: { 0: { label: 'Synthetic account', address: ADDRESS } },
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: { chainId: 5700, url: 'https://first.invalid' },
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

const addressCopy = () =>
  // Before the accessibility fix this is the only unnamed button.
  screen.queryByRole('button', { name: 'transactions.copyAddress' }) ||
  screen.getByRole('button', { name: '' });

it.each([
  ['Decrypt', Decrypt],
  ['EncryptPubKey', EncryptPubKey],
])(
  '%s waits for deferred address copy and announces only its own result',
  async (_, Component) => {
    let resolve!: () => void;
    mockCopy.mockImplementationOnce(
      () => new Promise<void>((done) => (resolve = done))
    );
    render(<Component />);
    fireEvent.click(addressCopy());
    expect(mockCopy).toHaveBeenCalledWith(ADDRESS);
    expect(mockAlert.info).not.toHaveBeenCalled();
    await act(async () => resolve());
    await waitFor(() => expect(mockAlert.info).toHaveBeenCalledTimes(1));
    expect(mockAlert.info).toHaveBeenCalledWith('home.addressCopied');
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each([
  ['Decrypt', Decrypt],
  ['EncryptPubKey', EncryptPubKey],
])(
  '%s handles rejected address copy without a success toast',
  async (_, Component) => {
    mockCopy.mockRejectedValueOnce(new Error('Clipboard permission denied'));
    render(<Component />);
    fireEvent.click(addressCopy());
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('waits for deferred decrypted-message copy without announcing an address', async () => {
  render(<Decrypt />);
  fireEvent.click(screen.getByText(CIPHERTEXT));
  await screen.findByText(PLAINTEXT);
  let resolve!: () => void;
  mockCopy.mockImplementationOnce(
    () => new Promise<void>((done) => (resolve = done))
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.copyMessage' })
  );
  expect(mockCopy).toHaveBeenCalledWith(PLAINTEXT);
  expect(mockAlert.info).not.toHaveBeenCalled();
  await act(async () => resolve());
  await waitFor(() => expect(mockAlert.info).toHaveBeenCalledTimes(1));
  expect(mockAlert.info).toHaveBeenCalledWith('transactions.messageCopied');
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'decryptMessage'],
    [[CIPHERTEXT, ADDRESS]]
  );
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
});

it('handles rejected decrypted-message copy without exposing an internal error', async () => {
  render(<Decrypt />);
  fireEvent.click(screen.getByText(CIPHERTEXT));
  await screen.findByText(PLAINTEXT);
  mockCopy.mockRejectedValueOnce(new Error('Private clipboard diagnostic'));
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.copyMessage' })
  );
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
  expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(screen.queryByText('Private clipboard diagnostic')).toBeNull();
});

it('preserves the approved encryption-key request and dispatch payload', async () => {
  mockEmitter.mockResolvedValueOnce('synthetic-public-encryption-key');
  render(<EncryptPubKey />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith([
    'wallet',
    'ethereumTransaction',
    'getEncryptedPubKey',
  ]);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'synthetic-encryption-request.synthetic.example.invalid',
    'synthetic-public-encryption-key'
  );
  expect(mockCopy).not.toHaveBeenCalled();
});

it('renders a successfully decrypted empty plaintext as unlocked', async () => {
  mockEmitter.mockResolvedValueOnce('');
  render(<Decrypt />);
  fireEvent.click(screen.getByText(CIPHERTEXT));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'transactions.copyMessage' })
    ).toBeDefined()
  );
  expect(screen.queryByText(CIPHERTEXT)).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.copyMessage' })
  );
  await waitFor(() => expect(mockCopy).toHaveBeenCalledWith(''));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('exposes a keyboard-native preview action and disables it until decryption completes', async () => {
  let resolve!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((done) => (resolve = done))
  );
  render(<Decrypt />);
  const preview = screen.getByRole('button', {
    name: 'transactions.decryptMessage',
  });
  expect(preview.getAttribute('type')).toBe('button');
  fireEvent.click(preview);
  expect((preview as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(preview);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => resolve(PLAINTEXT));
  await screen.findByText(PLAINTEXT);
  expect(
    screen.queryByRole('button', { name: 'transactions.decryptMessage' })
  ).toBeNull();
});

it('preserves the approved decrypt request and dispatch payload', async () => {
  render(<Decrypt />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'decryptMessage'],
    [[CIPHERTEXT, ADDRESS]]
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'synthetic-encryption-request.synthetic.example.invalid',
    PLAINTEXT
  );
  expect(mockCopy).not.toHaveBeenCalled();
});

it('clears a failed preview diagnostic after a successful decryption retry', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic preview failure'));
  render(<Decrypt />);
  const preview = () =>
    screen.getByRole('button', { name: 'transactions.decryptMessage' });
  fireEvent.click(preview());
  await screen.findByText('Synthetic preview failure');
  fireEvent.click(preview());
  await screen.findByText(PLAINTEXT);
  expect(screen.queryByText('Synthetic preview failure')).toBeNull();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('drops an already revealed preview when the displayed account changes', async () => {
  const view = render(<Decrypt />);
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.decryptMessage' })
  );
  await screen.findByText(PLAINTEXT);
  mockState.vault.accounts.HDAccount[1] = {
    label: 'Other synthetic account',
    address: `0x${'22'.repeat(20)}`,
  };
  mockState.vault.activeAccount = { id: 1, type: 'HDAccount' };
  view.rerender(<Decrypt />);
  expect(screen.getByText('Other synthetic account')).toBeDefined();
  expect(screen.queryByText(PLAINTEXT)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'transactions.decryptMessage' })
  ).toBeDefined();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each(['ciphertext', 'network', 'host'])(
  'ignores a delayed preview result from a previous %s',
  async (change) => {
    let finish!: (value: string) => void;
    mockEmitter.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve))
    );
    const view = render(<Decrypt />);
    fireEvent.click(
      screen.getByRole('button', { name: 'transactions.decryptMessage' })
    );
    if (change === 'ciphertext')
      mockQuery = { ...mockQuery, 0: 'new-synthetic-ciphertext' };
    if (change === 'network')
      mockState.vault.activeNetwork = {
        chainId: 5701,
        url: 'https://second.invalid',
      };
    if (change === 'host')
      mockQuery = { ...mockQuery, host: 'other-synthetic.invalid' };
    view.rerender(<Decrypt />);
    await act(async () => finish(PLAINTEXT));
    expect(screen.getByText(mockQuery[0])).toBeDefined();
    expect(screen.queryByText(PLAINTEXT)).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'transactions.decryptMessage',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it('an old preview rejection cannot clear a newer request busy state or add its error', async () => {
  let rejectOld!: (error: Error) => void;
  let finishNew!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((_, reject) => (rejectOld = reject))
  );
  const view = render(<Decrypt />);
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.decryptMessage' })
  );
  mockQuery = { ...mockQuery, 0: 'new-synthetic-ciphertext' };
  view.rerender(<Decrypt />);
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finishNew = resolve))
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.decryptMessage' })
  );
  await act(async () => rejectOld(new Error('Old preview diagnostic')));
  expect(screen.queryByText('Old preview diagnostic')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: 'transactions.decryptMessage',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => finishNew('New synthetic plaintext'));
  await screen.findByText('New synthetic plaintext');
  expect(screen.queryByText(PLAINTEXT)).toBeNull();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it('ignores a preview completion after its review unmounts', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve))
  );
  const view = render(<Decrypt />);
  fireEvent.click(
    screen.getByRole('button', { name: 'transactions.decryptMessage' })
  );
  view.unmount();
  await act(async () => finish(PLAINTEXT));
  expect(screen.queryByText(PLAINTEXT)).toBeNull();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
});
