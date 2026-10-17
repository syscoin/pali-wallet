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
const HOST = 'https://legacy-signing.example';
const FIELDS = [
  { name: 'Message', type: 'string', value: 'Exact message 日本語' },
  { name: 'Amount', type: 'uint256', value: '9007199254740993' },
  { name: 'Enabled', type: 'bool', value: false },
];
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

const prepare = async (payload: any = FIELDS, addressFirst = true) => {
  mockQuery[0] = addressFirst ? ADDRESS : payload;
  mockQuery[1] = addressFirst ? payload : ADDRESS;
  const view = render(<EthSign />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy()
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
      activeNetwork: {
        currency: 'ETH',
        chainId: 1,
        url: 'https://rpc.example',
      },
      isBitcoinBased: false,
    },
  };
  mockQuery = { host: HOST, eventName: 'eth_signTypedData' };
  mockEmitter.mockImplementation(async (path) => {
    if (path.at(-1) === 'signTypedData') return '0xsignature';
    if (path.at(-1) === 'hydrateSmartAccount') return { chainId: 1 };
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('keeps long legacy field labels and values in separate wrapping blocks without changing the signed data', async () => {
  const fields = [
    {
      name: 'Field'.repeat(40),
      type: 'string',
      value: 'IMPORTANT_SIGNED_VALUE'.repeat(10),
    },
  ];
  await prepare(fields);
  const label = screen.getByText(fields[0].name);
  const value = screen.getByText(fields[0].value);
  expect(label.parentElement).toBe(value.parentElement);
  expect(label.parentElement?.className).toContain('flex-col');
  expect(label.className).toContain('[overflow-wrap:anywhere]');
  expect(value.className).toContain('[overflow-wrap:anywhere]');
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'ethereumTransaction', 'signTypedData'],
    [ADDRESS, fields, 'V1'],
    10000
  );
});

describe.each([true, false])(
  'legacy typed data address-first=%s',
  (addressFirst) => {
    it.each([false, true])(
      'renders and signs the exact reviewed fields (JSON string=%s)',
      async (stringified) => {
        const payload = stringified ? JSON.stringify(FIELDS) : FIELDS;
        await prepare(payload, addressFirst);
        for (const field of FIELDS) {
          expect(screen.getByText(field.name)).toBeTruthy();
          expect(screen.getByText(String(field.value))).toBeTruthy();
        }
        expect(screen.queryByRole('alert')).toBeNull();
        const original = { ...mockQuery };
        fireEvent.click(
          screen.getByRole('button', { name: 'buttons.confirm' })
        );
        await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
        expect(mockEmitter).toHaveBeenCalledTimes(1);
        expect(mockEmitter).toHaveBeenCalledWith(
          ['wallet', 'ethereumTransaction', 'signTypedData'],
          [ADDRESS, FIELDS, 'V1'],
          10000
        );
        expect(mockQuery).toEqual(original);
        expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
          `eth_signTypedData.${HOST}`,
          '0xsignature'
        );
      }
    );

    it('cancels without invoking a signer or returning a signature', async () => {
      await prepare(FIELDS, addressFirst);
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
      expect(window.close).toHaveBeenCalledTimes(1);
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    });
  }
);

it.each([
  null,
  {},
  [],
  [null],
  [{ name: 'missing type', value: '1' }],
  [{ name: 'missing value', type: 'uint256' }],
  '{invalid JSON',
])(
  'rejects malformed legacy fields without crashing or signing: %j',
  async (payload) => {
    await prepare(payload);
    expect(screen.getByRole('alert').textContent).toBe(
      'send.invalidApprovalDetails'
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => mockConfirm());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it('rejects a legacy request for another account before rendering signed fields', async () => {
  mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
  await prepare();
  expect(screen.getByRole('alert').textContent).toBe(
    'send.signingForWrongAddress'
  );
  expect(screen.queryByText('Exact message 日本語')).toBeNull();
  await act(async () => mockConfirm());
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['payload', 'origin', 'account', 'chain', 'rpc'])(
  'invalidates a stale legacy confirmation after changing %s',
  async (change) => {
    const view = await prepare();
    const staleConfirm = mockConfirm;
    if (change === 'payload')
      mockQuery = { ...mockQuery, 1: [{ ...FIELDS[0], value: 'different' }] };
    if (change === 'origin')
      mockQuery = { ...mockQuery, host: 'https://other.example' };
    if (change === 'account')
      mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
    if (change === 'chain') mockState.vault.activeNetwork.chainId = 5700;
    if (change === 'rpc')
      mockState.vault.activeNetwork.url = 'https://other-rpc.example';
    view.rerender(<EthSign />);
    await act(async () => staleConfirm());
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it('retains the smart-account rejection of legacy V1 signing', async () => {
  mockState.vault.accounts.HDAccount[0].isSmartAccount = true;
  mockState.vault.accounts.HDAccount[0].smartAccount = { chainId: 1 };
  await prepare();
  await act(async () => mockConfirm());
  expect(screen.getByRole('alert').textContent).toBe(
    'send.smartAccountLegacyTypedDataUnsupported'
  );
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each([
  ['eth_signTypedData_v3', 'V3'],
  ['eth_signTypedData_v4', 'V4'],
])(
  'keeps the %s payload and signing version unchanged',
  async (method, version) => {
    const payload = {
      types: {
        EIP712Domain: [],
        Test: [{ name: 'value', type: 'uint256' }],
      },
      domain: {},
      primaryType: 'Test',
      message: { value: '9007199254740993' },
    };
    mockQuery.eventName = method;
    await prepare(JSON.stringify(payload));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'ethereumTransaction', 'signTypedData'],
      [ADDRESS, payload, version],
      10000
    );
  }
);
