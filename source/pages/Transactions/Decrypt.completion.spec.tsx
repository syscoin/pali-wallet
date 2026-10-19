/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import Decrypt from './Decrypt';

const ADDRESS = `0x${'11'.repeat(20)}`;
const CIPHERTEXT = 'public-synthetic-ciphertext';
const PLAINTEXT = 'Public synthetic decrypted response';
const mockEmitter = jest.fn();
const mockQuery = {
  host: 'synthetic.example.invalid',
  eventName: 'synthetic-decryption-request',
  0: CIPHERTEXT,
  1: ADDRESS,
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        accounts: {
          HDAccount: { 0: { label: 'Synthetic account', address: ADDRESS } },
        },
        activeAccount: { id: 0, type: 'HDAccount' },
        activeNetwork: { chainId: 5700, url: 'https://fixture.invalid' },
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
    alert: { info: jest.fn(), error: jest.fn() },
    useCopyClipboard: () => [false, jest.fn()],
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
  mockEmitter.mockReset().mockResolvedValue(PLAINTEXT);
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('settles an approved decryption without closing a replacement page after departure', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve))
  );
  const view = render(<Decrypt />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'decryptMessage'],
    [[CIPHERTEXT, ADDRESS]]
  );
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  view.unmount();
  render(<div>Replacement wallet page</div>);

  await act(async () => finish(PLAINTEXT));

  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'synthetic-decryption-request.synthetic.example.invalid',
    PLAINTEXT
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Replacement wallet page')).toBeDefined();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('settles and closes the current approved decryption normally', async () => {
  render(<Decrypt />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'synthetic-decryption-request.synthetic.example.invalid',
    PLAINTEXT
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('keeps a failed current decryption retryable', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic decryption failure'));
  render(<Decrypt />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(screen.getByText('Synthetic decryption failure')).toBeDefined();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();

  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }))
  );
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'synthetic-decryption-request.synthetic.example.invalid',
    PLAINTEXT
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(window.close).toHaveBeenCalledTimes(1);
});
