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

import EthSign from './SignEth';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const mockEmitter = jest.fn();
const mockTranslate = (key: string) => key;
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
let mockState: any;
let mockQuery: any;
let mockConfirm: () => Promise<any>;

jest.mock('state/store', () => ({ __esModule: true, default: {} }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
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
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, loading }: any) => {
    if (children === 'buttons.confirm') mockConfirm = onClick;
    return (
      <button disabled={disabled || loading} onClick={onClick}>
        {children}
      </button>
    );
  },
  ErrorModal: ({ show, log }: any) =>
    show ? <div role="alert">{log}</div> : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
  IconButton: ({ children }: any) => <span>{children}</span>,
}));

const message = (header = 'metamask.github.io', address = ADDRESS) =>
  `${header} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to the test dapp.\n\nURI: https://metamask.github.io\nVersion: 1\nChain ID: 1\nNonce: 32891757\nIssued At: 2021-09-30T16:25:24.000Z`;
const encode = (text: string) => `0x${Buffer.from(text).toString('hex')}`;
const prepare = async (payload: string, reversed = false) => {
  mockQuery[0] = reversed ? ADDRESS : payload;
  mockQuery[1] = reversed ? payload : ADDRESS;
  const view = render(<EthSign />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'buttons.confirm' })
    ).toBeDefined()
  );
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            address: ADDRESS,
            balances: { ethereum: '1' },
            label: 'Account 1',
          },
        },
      },
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { currency: 'ETH', chainId: 1 },
      isBitcoinBased: false,
    },
  };
  mockQuery = {
    host: 'https://metamask.github.io',
    eventName: 'personal_sign',
    2: 'Example password',
  };
  mockEmitter.mockImplementation(async (path) => {
    if (path[path.length - 1] === 'signPersonalMessage') return '0xsignature';
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  [message(), false],
  [encode(message()), false],
  [message('https://metamask.github.io'), true],
  [encode(message('https://metamask.github.io')), true],
  [
    encode(
      `${message()}\nResources:\n- ipfs://Qme7ss3ARVgxv6rXqVPiikMJ8u2NLgmgszg13pYrDKEoiu\n- https://example.com/resource`
    ),
    false,
  ],
  ['An ordinary message', false],
  [encode('An ordinary message'), false],
  ['0xmalformed', true],
])(
  'signs valid personal_sign without changing original params or their order',
  async (payload, reversed) => {
    await prepare(payload as string, reversed as boolean);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    const originalParams = { ...mockQuery };
    delete originalParams.host;
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
      [originalParams],
      10000
    );
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'personal_sign.https://metamask.github.io',
      '0xsignature'
    );
  }
);

it.each([
  [message('metamask.badactor.io'), 'send.suspiciousSignInRequest'],
  [encode(message('metamask.badactor.io')), 'send.suspiciousSignInRequest'],
  [
    encode(message('metamask.github.io', `0x${'22'.repeat(20)}`)),
    'send.signingForWrongAddress',
  ],
  [
    message().replace('URI: https://metamask.github.io\n', ''),
    'send.suspiciousSignInRequest',
  ],
  [
    encode(message().replace('Sign in', 'Sign ín')),
    'send.suspiciousSignInRequest',
  ],
])(
  'blocks unsafe SIWE in the actual component, including direct confirmation callbacks',
  async (payload, error) => {
    await prepare(payload);
    expect(screen.getByRole('alert').textContent).toBe(error);
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => {
      await mockConfirm();
    });
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it.each(['account', 'origin', 'message'])(
  'invalidates a stale confirmation callback after changing %s',
  async (change) => {
    const view = await prepare(encode(message()));
    const staleConfirm = mockConfirm;
    if (change === 'account')
      mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
    if (change === 'origin') mockQuery.host = 'https://attacker.example';
    if (change === 'message')
      mockQuery[0] = encode(message('attacker.example'));
    view.rerender(<EthSign />);
    await act(async () => {
      await staleConfirm();
      await mockConfirm();
    });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('cannot race background decoding or invoke the signer twice', async () => {
  let finishSign!: (signature: string) => void;
  mockEmitter.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSign = resolve;
      })
  );
  await prepare(encode(message()));
  expect(mockEmitter).not.toHaveBeenCalled(); // Review no longer waits for an RPC.
  const confirm = mockConfirm;
  let first!: Promise<any>;
  await act(async () => {
    first = confirm();
    await confirm();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  await act(async () => {
    finishSign('0xsignature');
    await first;
    await confirm();
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});
