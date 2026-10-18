/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import EthSign from './SignEth';

const ADDRESS = `0x${'11'.repeat(20)}`;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), success: jest.fn(), error: jest.fn() };
const mockTranslate = (key: string) => key;
let mockConfirm: () => Promise<any>;
let mockCancel: () => void;
let mockTimers: jest.SpyInstance;
let mockLedger = false;
const mockQuery = {
  host: 'https://synthetic.invalid',
  eventName: 'personal_sign',
  0: ADDRESS,
  1: 'Synthetic public signing fixture',
};

jest.mock('state/store', () => ({ __esModule: true, default: {} }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        accounts: {
          HDAccount: {
            0: {
              address: ADDRESS,
              balances: { ethereum: '1' },
              label: 'Synthetic account',
              isLedgerWallet: mockLedger,
            },
          },
        },
        activeAccount: { type: 'HDAccount', id: 0 },
        activeNetwork: { currency: 'ETH', chainId: 1 },
        isBitcoinBased: false,
      },
    }),
}));
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
jest.mock('utils/alarmUtils', () => ({
  createTemporaryAlarm: ({ callback, delayInSeconds }: any) => {
    setTimeout(callback, delayInSeconds * 1000);
    return 'synthetic-alarm';
  },
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ truncate: (value: string) => value }));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => {
    if (children === 'buttons.confirm') mockConfirm = onClick;
    if (children === 'buttons.cancel') mockCancel = onClick;
    return (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    );
  },
  ErrorModal: ({ show, log, onClose }: any) =>
    show ? <button onClick={onClose}>{log}</button> : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
  IconButton: ({ children }: any) => <span>{children}</span>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLedger = false;
  jest.useFakeTimers();
  mockTimers = jest.spyOn(global, 'setTimeout');
  mockEmitter.mockRejectedValueOnce(
    Object.assign(new Error('User rejected the request.'), { code: 4001 })
  );
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const prepare = async () => {
  const view = render(<EthSign />);
  await act(async () => jest.advanceTimersByTime(100));
  return view;
};

it('does not let an old signing error close a pending retry', async () => {
  const view = await prepare();
  await act(async () => mockConfirm());
  expect(mockAlert.info).toHaveBeenCalledWith(
    'transactions.transactionCancelled'
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  let finish!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve))
  );
  let retry!: Promise<any>;
  act(() => {
    retry = mockConfirm();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  await act(async () => jest.advanceTimersByTime(40000));
  expect(window.close).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  await act(async () => {
    finish('synthetic-signature');
    await retry;
  });
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'personal_sign.https://synthetic.invalid',
    'synthetic-signature'
  );
  expect(window.close).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('retains the genuine current signing error close deadline', async () => {
  await prepare();
  await act(async () => mockConfirm());
  await act(async () => jest.advanceTimersByTime(39999));
  expect(window.close).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each(['cancel', 'unmount'])(
  'invalidates an exposed error-alarm callback after %s',
  async (departure) => {
    const view = await prepare();
    await act(async () => mockConfirm());
    const callback = mockTimers.mock.calls.find(
      ([, delay]) => delay === 40000
    )![0];
    if (departure === 'cancel')
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    else view.unmount();
    const expectedCloses = departure === 'cancel' ? 1 : 0;
    await act(async () => callback());
    await act(async () => mockConfirm());
    expect(window.close).toHaveBeenCalledTimes(expectedCloses);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it('ignores stale Cancel and cleared alarm callbacks while a retry is signing', async () => {
  const view = await prepare();
  const oldCancel = mockCancel;
  await act(async () => mockConfirm());
  const oldAlarm = mockTimers.mock.calls.find(
    ([, delay]) => delay === 40000
  )![0];
  let finish!: (value: string) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<string>((resolve) => (finish = resolve))
  );
  let retry!: Promise<any>;
  act(() => {
    retry = mockConfirm();
  });
  act(() => {
    oldCancel();
    oldAlarm();
  });
  expect(window.close).not.toHaveBeenCalled();
  await act(async () => {
    finish('synthetic-signature');
    await retry;
  });
  expect(window.close).toHaveBeenCalledTimes(1);
  act(() => oldAlarm());
  expect(window.close).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('keeps a failed retry on its own error deadline rather than the previous alarm', async () => {
  const view = await prepare();
  await act(async () => mockConfirm());
  const oldAlarm = mockTimers.mock.calls.find(
    ([, delay]) => delay === 40000
  )![0];
  mockEmitter.mockRejectedValueOnce(
    Object.assign(new Error('User rejected the request.'), { code: 4001 })
  );
  await act(async () => mockConfirm());
  const alarms = mockTimers.mock.calls.filter(([, delay]) => delay === 40000);
  expect(alarms).toHaveLength(2);
  act(() => oldAlarm());
  expect(window.close).not.toHaveBeenCalled();
  act(() => alarms[1][0]());
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  view.unmount();
});

it.each([false, true])(
  'settles an admitted signature without closing a replacement page after departure (Ledger=%s)',
  async (ledger) => {
    mockLedger = ledger;
    let finish!: (value: string) => void;
    mockEmitter
      .mockReset()
      .mockReturnValueOnce(
        new Promise<string>((resolve) => (finish = resolve))
      );
    const view = await prepare();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
      [
        {
          eventName: 'personal_sign',
          0: ADDRESS,
          1: 'Synthetic public signing fixture',
        },
      ],
      ledger ? 300000 : 10000
    );
    view.unmount();
    render(<div>Replacement wallet page</div>);

    await act(async () => finish('public-synthetic-signature'));

    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'personal_sign.https://synthetic.invalid',
      'public-synthetic-signature'
    );
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Replacement wallet page')).toBeDefined();
    expect(window.close).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);

it('does not show an obsolete signing failure after departure', async () => {
  let reject!: (error: Error) => void;
  mockEmitter
    .mockReset()
    .mockReturnValueOnce(new Promise<string>((_, fail) => (reject = fail)));
  const view = await prepare();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<div>Replacement wallet page</div>);
  mockTimers.mockClear();
  await act(async () =>
    reject(
      Object.assign(new Error('User rejected the request.'), { code: 4001 })
    )
  );
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockTimers).not.toHaveBeenCalled();
});
