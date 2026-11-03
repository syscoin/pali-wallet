/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Buffer } from 'buffer';
import { verifyMessage } from 'ethers/hash';
import { Wallet } from 'ethers/wallet';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import EthSign from './SignEth';

// Keep the installed SDK authority checks and cryptography real.
// The injected semantic Ledger host is the device boundary; no APDU is mocked.
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: {},
}));
// The adapter imports unrelated UTXO tooling, which is never used here. Avoid
// loading its browser-only dependency exports into Jest's CommonJS runtime.
jest.mock('syscoinjs-lib', () => ({
  utils: { bitcoinjs: {} },
  networks: { bitcoin: {}, syscoin: {} },
}));
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

// Deliberately public key. Its signature substitutes only for the physical
// device's final reply; no RPC provider, live account or broadcast is involved.
const deviceWallet = new Wallet(`0x${'11'.repeat(32)}`);
const ADDRESS = deviceWallet.address;
const ORIGIN = 'https://metamask.github.io';
const mockEmitter = jest.fn();
const mockTranslate = (key: string) => key;
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
let mockState: any;
let mockQuery: any;
let mockConfirm: () => Promise<any>;
let mockDevice: ReturnType<typeof createDeviceHost>;
let sdk: EthereumTransactions;

const message = (header = 'metamask.github.io', address = ADDRESS) =>
  `${header} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to the test dapp.\n\nURI: https://metamask.github.io\nVersion: 1\nChain ID: 1\nNonce: 32891757\nIssued At: 2021-09-30T16:25:24.000Z`;
const encode = (text: string) => `0x${Buffer.from(text).toString('hex')}`;

function createDeviceHost() {
  let received = Buffer.alloc(0);
  const sign = jest.fn(
    async ({ messageHex, expectedAddress, accountIndex }: any) => {
      expect(expectedAddress).toBe(ADDRESS);
      expect(accountIndex).toBe(0);
      expect(messageHex).toMatch(/^(?:[0-9a-f]{2})*$/i);
      received = Buffer.from(messageHex, 'hex');
      return deviceWallet.signMessage(Uint8Array.from(received));
    }
  );
  return {
    bytes: () => Buffer.from(received),
    sign,
    host: {
      getStatus: () => ({ connected: true }),
      connect: jest.fn(),
      disconnect: jest.fn(),
      utxo: {} as any,
      evm: { signPersonalMessage: sign } as any,
    },
  };
}

const prepare = async (payload: string, reversed: boolean) => {
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
        Ledger: {
          0: {
            address: ADDRESS,
            balances: { ethereum: '1' },
            id: 0,
            isLedgerWallet: true,
            label: 'Ledger 1',
          },
        },
      },
      activeAccount: { type: 'Ledger', id: 0 },
      activeNetwork: { currency: 'ETH', chainId: 1, slip44: 60 },
      isBitcoinBased: false,
    },
  };
  mockQuery = {
    host: ORIGIN,
    eventName: 'personal_sign',
    2: 'Example password',
  };
  mockDevice = createDeviceHost();
  const ledger = new LedgerKeyring(undefined, mockDevice.host);
  sdk = new EthereumTransactions(
    () => mockState.vault.activeNetwork,
    () => ({ address: ADDRESS, decryptedPrivateKey: '' }),
    () => ({
      ...mockState.vault,
      activeAccountId: 0,
      activeAccountType: 'Ledger',
    }),
    ledger,
    undefined as any
  );
  mockEmitter.mockImplementation(async (path, args) => {
    expect(path).toEqual([
      'wallet',
      'ethereumTransaction',
      'signPersonalMessage',
    ]);
    return sdk.signPersonalMessage(args[0]);
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each([false, true])(
  'Ledger personal_sign bytes (reversed parameters: %s)',
  (reversed) => {
    it.each([
      `${encode(message('victim.test'))}zz`,
      `${encode(message('victim.test'))}a`,
      '0xmalformed',
      '0xabc',
    ])(
      'blocks malformed message %s before all signer/device calls',
      async (payload) => {
        await prepare(payload, reversed);
        expect(screen.getByRole('alert').textContent).toBe(
          'send.invalidPersonalSignMessage'
        );
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
        expect(mockDevice.sign).not.toHaveBeenCalled();
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
      }
    );

    it.each([
      [message(), message()],
      [encode(message()), message()],
      ['Hello Pali', 'Hello Pali'],
      [encode('Hello Pali'), 'Hello Pali'],
      [encode('Hello Pali').toUpperCase().replace(/^0X/, '0x'), 'Hello Pali'],
      ['Hello Pali 👋 café', 'Hello Pali 👋 café'],
      [encode('Hello Pali 👋 café'), 'Hello Pali 👋 café'],
      ['0Xmalformed', '0Xmalformed'],
    ])('signs exactly the reviewed bytes for %s', async (payload, intended) => {
      await prepare(payload, reversed);
      expect(screen.queryByRole('alert')).toBeNull();
      const originalRequest = { ...mockQuery };
      const sdkParams = { ...mockQuery, 0: ADDRESS, 1: payload };
      delete sdkParams.host;
      fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
      await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
        [sdkParams],
        300000
      );
      expect(mockQuery).toEqual(originalRequest);
      expect(mockDevice.bytes()).toEqual(Buffer.from(intended, 'utf8'));
      expect(mockDevice.sign).toHaveBeenCalled();
      const [[event, signature]] = (dispatchBackgroundEvent as jest.Mock).mock
        .calls;
      expect(event).toBe(`personal_sign.${ORIGIN}`);
      expect(
        verifyMessage(Uint8Array.from(mockDevice.bytes()), signature)
      ).toBe(ADDRESS);
      if (payload.startsWith('0x'))
        expect(verifyMessage(payload, signature)).not.toBe(ADDRESS);
    });

    it.each(['', '0x'])(
      'signs the valid empty payload %s through the semantic host',
      async (payload) => {
        await prepare(payload, reversed);
        expect(screen.queryByRole('alert')).toBeNull();
        await act(async () => {
          await mockConfirm();
        });
        expect(mockEmitter).toHaveBeenCalledTimes(1);
        expect(mockDevice.sign).toHaveBeenCalledTimes(1);
        expect(mockDevice.bytes()).toEqual(Buffer.alloc(0));
        const [[, signature]] = (dispatchBackgroundEvent as jest.Mock).mock
          .calls;
        expect(verifyMessage(Uint8Array.from([]), signature)).toBe(ADDRESS);
        expect(window.close).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      [encode(message('victim.test')), 'send.suspiciousSignInRequest'],
      [
        encode(message('metamask.github.io', `0x${'22'.repeat(20)}`)),
        'send.signingForWrongAddress',
      ],
    ])(
      'retains wrong-origin and wrong-signer checks for %s',
      async (payload, error) => {
        await prepare(payload, reversed);
        expect(screen.getByRole('alert').textContent).toBe(error);
        await act(async () => {
          await mockConfirm();
        });
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(mockDevice.sign).not.toHaveBeenCalled();
      }
    );

    it.each(['zz', 'a'])(
      'invalidates an earlier valid callback when the payload gains suffix %s',
      async (suffix) => {
        const view = await prepare(encode(message()), reversed);
        const staleConfirm = mockConfirm;
        mockQuery[reversed ? 1 : 0] = `${encode(message())}${suffix}`;
        view.rerender(<EthSign />);
        await act(async () => {
          await staleConfirm();
          await mockConfirm();
        });
        expect(screen.getByRole('alert').textContent).toBe(
          'send.invalidPersonalSignMessage'
        );
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(mockDevice.sign).not.toHaveBeenCalled();
      }
    );
  }
);

it.each([`0x${'22'.repeat(20)}`, ADDRESS, ADDRESS.toUpperCase()])(
  'signs exact canonical 20-byte message %s through the installed Ledger SDK',
  async (payload) => {
    await prepare(payload, false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(payload).length).toBeGreaterThan(0);
    const originalRequest = { ...mockQuery };
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    const intended = payload.startsWith('0x')
      ? Buffer.from(payload.slice(2), 'hex')
      : Buffer.from(payload, 'utf8');
    expect(mockDevice.bytes()).toEqual(intended);
    const [[, signature]] = (dispatchBackgroundEvent as jest.Mock).mock.calls;
    expect(verifyMessage(Uint8Array.from(intended), signature)).toBe(ADDRESS);
    expect(mockQuery).toEqual(originalRequest);
  }
);
