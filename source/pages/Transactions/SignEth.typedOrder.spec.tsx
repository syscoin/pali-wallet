/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import fixtures from '../../../tests/fixtures/typedOrderRequests.json';
import { signPaliErc7739TypedDataV4 } from 'utils/smartAccount';

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
jest.mock('utils/smartAccount', () => ({
  assertPaliErc7739TypedDataV4Method: jest.fn(),
  signPaliErc7739TypedDataV4: jest.fn(async () => '0xsmart-signature'),
}));
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

const prepare = async (payload: any, reversed = false) => {
  mockQuery[0] = reversed ? payload : ADDRESS;
  mockQuery[1] = reversed ? ADDRESS : payload;
  const view = render(<EthSign />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.confirm' })).toBeTruthy()
  );
  return view;
};

const signCalls = () =>
  mockEmitter.mock.calls.filter(([path]) => path.at(-1) === 'signTypedData');

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
  mockQuery = {
    host: 'https://metamask.github.io',
    eventName: 'eth_signTypedData_v4',
  };
  mockEmitter.mockImplementation(async (path) => {
    if (path.at(-1) === 'signTypedData') return '0xsignature';
    if (path.at(-1) === 'checkAddressBlacklist')
      return { isBlacklisted: false, severity: 'low' };
    if (path.at(-1) === 'hydrateSmartAccount') return { chainId: 1 };
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
  '%s malformed payloads',
  (method) => {
    it.each(
      [
        'not-json',
        '',
        ' \n {',
        'null',
        '42',
        'false',
        '[]',
        null,
        42,
        [],
      ].flatMap((payload) => [
        { payload, reversed: false },
        { payload, reversed: true },
      ])
    )(
      'keeps Data review usable and blocks signing ($payload, $reversed)',
      async ({ payload, reversed }) => {
        mockQuery.eventName = method;
        await prepare(payload, reversed);
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
        fireEvent.click(screen.getByText('send.data'));
        expect(screen.getByText('send.rawParameters')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toBe(
          'send.invalidApprovalDetails'
        );
        await act(async () => mockConfirm());
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(signPaliErc7739TypedDataV4).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
      }
    );

    it.each([false, true])(
      'uses the parsed whitespace JSON for display and signing (reversed: %s)',
      async (reversed) => {
        mockQuery.eventName = method;
        const payload = ` \n ${JSON.stringify(fixtures.OrderComponents)}`;
        await prepare(payload, reversed);
        fireEvent.click(screen.getByText('send.data'));
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(
          screen.getByRole('button', { name: 'buttons.confirm' })
        );
        await waitFor(() => expect(signCalls()).toHaveLength(1));
        expect(signCalls()[0][1]).toEqual([
          ADDRESS,
          fixtures.OrderComponents,
          method === 'eth_signTypedData_v3' ? 'V3' : 'V4',
        ]);
        expect(mockQuery[reversed ? 0 : 1]).toBe(payload);
      }
    );

    it('does not crash Data review after the signer account changes', async () => {
      mockQuery.eventName = method;
      const view = await prepare(JSON.stringify(fixtures.OrderComponents));
      fireEvent.click(screen.getByText('send.data'));
      const staleConfirm = mockConfirm;
      mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
      view.rerender(<EthSign />);
      expect(screen.getByRole('alert').textContent).toBe(
        'send.signingForWrongAddress'
      );
      expect(screen.getByText('send.rawParameters')).toBeTruthy();
      await act(async () => {
        await staleConfirm();
        await mockConfirm();
      });
      expect(signCalls()).toHaveLength(0);
      expect(window.close).not.toHaveBeenCalled();
    });
  }
);

it.each(['Ledger', 'Trezor'])(
  'keeps the interactive %s signer path and hardware timeout',
  async (device) => {
    const account = mockState.vault.accounts.HDAccount[0];
    account.isLedgerWallet = device === 'Ledger';
    account.isTrezorWallet = device === 'Trezor';
    await prepare(JSON.stringify(fixtures.OrderComponents));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(signCalls()).toHaveLength(1));
    expect(signCalls()[0]).toEqual([
      ['wallet', 'ethereumTransaction', 'signTypedData'],
      [ADDRESS, fixtures.OrderComponents, 'V4'],
      300000,
    ]);
  }
);

it('keeps contract-account typed signing with an independent order creator', async () => {
  const account = mockState.vault.accounts.HDAccount[0];
  account.id = 0;
  account.isSmartAccount = true;
  account.smartAccount = { chainId: 1 };
  await prepare(JSON.stringify(fixtures.OrderComponents));
  expect(screen.getByText('send.nftOrderNoReturn')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(signPaliErc7739TypedDataV4).toHaveBeenCalledTimes(1)
  );
  expect(signPaliErc7739TypedDataV4).toHaveBeenCalledWith(
    expect.objectContaining({
      accountAddress: ADDRESS,
      chainId: 1,
      typedData: fixtures.OrderComponents,
    })
  );
  expect(signCalls()).toHaveLength(0);
});

it.each([false, true])(
  'shows the gift advisory and preserves exact signing data (reversed: %s)',
  async (reversed) => {
    // The offerer deliberately differs from the active EOA. An advisory must
    // neither assume ownership nor reject delegated/contract-wallet orders.
    const payload = JSON.stringify(fixtures.OrderComponents);
    await prepare(payload, reversed);
    const warning = screen.getByText('send.nftOrderNoReturn');
    const confirm = screen.getByRole('button', { name: 'buttons.confirm' });
    expect(
      warning.compareDocumentPosition(confirm) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('send.data'));
    expect(screen.getByText('send.nftOrderNoReturn')).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(signCalls()).toHaveLength(1));
    expect(signCalls()[0]).toEqual([
      ['wallet', 'ethereumTransaction', 'signTypedData'],
      [ADDRESS, fixtures.OrderComponents, 'V4'],
      10000,
    ]);
    expect(mockQuery[reversed ? 0 : 1]).toBe(payload);
    expect(
      mockEmitter.mock.calls.every(([path]) =>
        ['signTypedData', 'checkAddressBlacklist'].includes(path.at(-1))
      )
    ).toBe(true);
  }
);

it('does not invent a scam warning for the positive-payment trade fixture', async () => {
  await prepare(fixtures.ERC721Order);
  expect(screen.getByText('send.nftOrderAuthorization')).toBeTruthy();
  expect(screen.queryByText('send.nftOrderZeroPayment')).toBeNull();
  expect(screen.queryByText('send.nftOrderNoReturn')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(signCalls()).toHaveLength(1));
  expect(signCalls()[0][1]).toEqual([ADDRESS, fixtures.ERC721Order, 'V4']);
});

it('falls back to raw review for a familiar name with a changed signed schema', async () => {
  const payload = JSON.parse(JSON.stringify(fixtures.OrderComponents));
  payload.types.OrderComponents[2].type = 'bytes';
  await prepare(payload);
  expect(screen.getByText('send.nftOrderUnrecognized')).toBeTruthy();
  expect(screen.queryByText('send.nftOrderAuthorization')).toBeNull();
  expect(screen.queryByText('send.nftOrderNoReturn')).toBeNull();
});

it('updates the warning synchronously when another request has the same method', async () => {
  const view = await prepare(JSON.stringify(fixtures.OrderComponents));
  expect(screen.getByText('send.nftOrderNoReturn')).toBeTruthy();
  mockQuery = { ...mockQuery, 1: JSON.stringify(fixtures.ERC721Order) };
  view.rerender(<EthSign />);
  expect(screen.queryByText('send.nftOrderNoReturn')).toBeNull();
  expect(screen.queryByText('send.nftOrderZeroPayment')).toBeNull();
  expect(screen.getByText('send.nftOrderAuthorization')).toBeTruthy();
});

it.each(['payload', 'origin', 'account', 'chain', 'rpc', 'method'])(
  'invalidates a stale typed-data approval after changing %s',
  async (change) => {
    const view = await prepare(JSON.stringify(fixtures.OrderComponents));
    const staleConfirm = mockConfirm;
    if (change === 'payload')
      mockQuery = { ...mockQuery, 1: JSON.stringify(fixtures.ERC721Order) };
    if (change === 'origin')
      mockQuery = { ...mockQuery, host: 'https://other.example' };
    if (change === 'account')
      mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
    if (change === 'chain') mockState.vault.activeNetwork.chainId = 5700;
    if (change === 'rpc')
      mockState.vault.activeNetwork.url = 'https://another-rpc.example';
    if (change === 'method')
      mockQuery = {
        ...mockQuery,
        eventName: 'personal_sign',
        0: 'ordinary text',
        1: ADDRESS,
      };
    view.rerender(<EthSign />);
    await act(async () => staleConfirm());
    expect(signCalls()).toHaveLength(0);
    expect(window.close).not.toHaveBeenCalled();
  }
);
