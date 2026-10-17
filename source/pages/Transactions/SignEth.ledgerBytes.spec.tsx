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
import { Signature } from 'ethers/crypto';
import { verifyMessage } from 'ethers/hash';
import { Wallet } from 'ethers/wallet';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import EthSign from './SignEth';

// Keep the installed SDK, Ledger adapter, cryptography and APDU encoder real.
// Connect is unused by this Ledger journey; it must not initialize transport.
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
let mockTransport: ReturnType<typeof createDeviceTransport>;
let sdk: EthereumTransactions;

const message = (header = 'metamask.github.io', address = ADDRESS) =>
  `${header} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to the test dapp.\n\nURI: https://metamask.github.io\nVersion: 1\nChain ID: 1\nNonce: 32891757\nIssued At: 2021-09-30T16:25:24.000Z`;
const encode = (text: string) => `0x${Buffer.from(text).toString('hex')}`;

function createDeviceTransport() {
  let expectedLength = -1;
  let received = Buffer.alloc(0);
  const send = jest.fn(
    async (cla: number, ins: number, p1: number, p2: number, data: Buffer) => {
      // Decode the real Ledger encoder's wire output, rather than interpreting
      // its input using a test-only implementation of hex conversion.
      expect([cla, ins, p2]).toEqual([0xe0, 0x08, 0]);
      if (p1 === 0) {
        const pathLength = data[0];
        expectedLength = data.readUInt32BE(1 + pathLength * 4);
        received = Buffer.from(data.subarray(1 + pathLength * 4 + 4));
      } else {
        expect(p1).toBe(0x80);
        received = Buffer.concat([received, data]);
      }
      expect(received.length).toBeLessThanOrEqual(expectedLength);
      if (received.length !== expectedLength) return Buffer.alloc(65);
      // Bridge the Node Buffer and jsdom Uint8Array realms at the fake device
      // boundary without changing any encoded bytes.
      const signature = Signature.from(
        await deviceWallet.signMessage(Uint8Array.from(received))
      );
      return Buffer.concat([
        Buffer.from([signature.v]),
        Buffer.from(signature.r.slice(2), 'hex'),
        Buffer.from(signature.s.slice(2), 'hex'),
      ]);
    }
  );
  return {
    bytes: () => Buffer.from(received),
    decorateAppAPIMethods: jest.fn(),
    send,
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
  mockTransport = createDeviceTransport();
  // Preserve the adapter's actual ensureConnection and executeWithRetry paths.
  // These methods emulate only hardware-manager connection/I/O boundaries.
  const manager = {
    ensureConnection: jest.fn(async () => undefined),
    getLedgerConnection: jest.fn(async () => mockTransport),
    on: jest.fn(),
    retryOperation: jest.fn(async (operation: () => Promise<any>) =>
      operation()
    ),
  };
  const ledger = new LedgerKeyring(manager as any);
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
        expect(mockTransport.send).not.toHaveBeenCalled();
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
      expect(mockTransport.bytes()).toEqual(Buffer.from(intended, 'utf8'));
      expect(mockTransport.send).toHaveBeenCalled();
      const [[event, signature]] = (dispatchBackgroundEvent as jest.Mock).mock
        .calls;
      expect(event).toBe(`personal_sign.${ORIGIN}`);
      expect(
        verifyMessage(Uint8Array.from(mockTransport.bytes()), signature)
      ).toBe(ADDRESS);
      if (payload.startsWith('0x'))
        expect(verifyMessage(payload, signature)).not.toBe(ADDRESS);
    });

    it.each(['', '0x'])(
      'accepts valid empty payload %s and surfaces the installed encoder limitation',
      async (payload) => {
        // hw-app-eth 6.47.1 emits no APDU for empty bytes, then reads an absent
        // device reply. Keep that SDK limitation visible instead of replacing
        // the real encoder with a mock that invents empty-message support.
        await prepare(payload, reversed);
        expect(screen.queryByRole('alert')).toBeNull();
        await act(async () => {
          await mockConfirm();
        });
        expect(mockEmitter).toHaveBeenCalledTimes(1);
        expect(mockTransport.send).not.toHaveBeenCalled();
        expect(screen.getByRole('alert').textContent).toContain('undefined');
        expect(
          (
            screen.getByRole('button', {
              name: 'buttons.cancel',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(false);
        expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
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
        expect(mockTransport.send).not.toHaveBeenCalled();
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
        expect(mockTransport.send).not.toHaveBeenCalled();
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
    expect(mockTransport.bytes()).toEqual(intended);
    const [[, signature]] = (dispatchBackgroundEvent as jest.Mock).mock.calls;
    expect(verifyMessage(Uint8Array.from(intended), signature)).toBe(ADDRESS);
    expect(mockQuery).toEqual(originalRequest);
  }
);

it.each(['zz', 'a'])(
  'demonstrates the installed Ledger encoder truncation behind suffix %s',
  async (suffix) => {
    // This isolated encoder contract witness never invokes wallet approval or
    // its controller. The component cases above establish rejection instead.
    const LedgerEth = jest.requireActual(
      '@ledgerhq/hw-app-eth/lib/Eth'
    ).default;
    const transport = createDeviceTransport();
    const encoder = new LedgerEth(transport);
    const intended = message('victim.test');
    const payload = `${encode(intended)}${suffix}`;
    const signature = await encoder.signPersonalMessage(
      "44'/60'/0'/0/0",
      payload.slice(2)
    );
    const joined = `0x${signature.r}${signature.s}${signature.v.toString(16)}`;
    expect(transport.send.mock.calls.length).toBeGreaterThan(1);
    expect(transport.bytes()).toEqual(Buffer.from(intended));
    expect(verifyMessage(Uint8Array.from(transport.bytes()), joined)).toBe(
      ADDRESS
    );
    expect(verifyMessage(payload, joined)).not.toBe(ADDRESS);
  }
);
