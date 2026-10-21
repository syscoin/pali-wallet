/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SendConfirm } from './Confirm';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockClear = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
let mockLocation: any;
let mockState: any;
let mockDecoded: any;
let entry = 0;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: mockNavigate,
    useCopyClipboard: () => [false, mockCopy],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: false, forceRecheck: jest.fn() }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
  selectActiveAccountAssets: () => ({ syscoin: [], ethereum: [] }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled, type }: any) => (
    <button onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  ),
  Icon: () => null,
  DeviceWaitingBanner: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
// Use the package's real CommonJS color helpers with Jest's CommonJS runtime.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/Icon/Icon', () => {
  const { DownOutlined, RightOutlined } = jest.requireActual(
    'components/Icon/Icon'
  );
  return {
    WarningOutlined: () => null,
    CheckCircleOutlined: () => null,
    ClockCircleOutlined: () => null,
    DownOutlined,
    RightOutlined,
  };
});
jest.mock('antd', () => ({
  Typography: { Text: ({ children }: any) => <span>{children}</span> },
}));
jest.mock('components/TransactionDetails', () => ({
  SyscoinTransactionDetailsFromPSBT: jest.requireActual(
    'components/TransactionDetails/SyscoinTransactionDetailsFromPSBT'
  ).SyscoinTransactionDetailsFromPSBT,
}));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));
jest.mock('utils/index', () => ({
  clearNavigationState: () => mockClear(),
  saveNavigationState: jest.fn(),
  ellipsis: (value: string) => value,
  truncate: (value: string) => value,
  logError: jest.fn(),
  omitTransactionObjectData: (value: any) => value,
  removeScientificNotation: (value: string | number) =>
    jest
      .requireActual('utils/removeScientificNotation')
      .removeScientificNotation(value),
  INITIAL_FEE: {},
  SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS: 30000,
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  getWalletNavigationScope: () => mockScope,
  clearTransactionNavigationState: () => mockClear(),
  navigateBack: jest.fn(),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));

// Recorded from syscoinjs-lib@1.0.274 decoding unsigned witness-UTXO PSBTs:
// each input is 100,000 satoshis, total fee is 1,000. No keys or signatures.
// Common decoded fields are reconstructed below without changing their values.
// Four outputs exercise the shared disclosure; four inputs with one recipient
// is the ordinary SendSys -> Confirm shape.
const vectors = {
  '4-1': {
    psbt: 'cHNidP8BAM0CAAAABAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAAAP////8DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAAAAAA/////wQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAD/////AZgWBgAAAAAAFgAUFhYWFhYWFhYWFhYWFhYWFhYWFhYAAAAAAAEBH6CGAQAAAAAAFgAUEREREREREREREREREREREREREREAAQEfoIYBAAAAAAAWABQREREREREREREREREREREREREREQABAR+ghgEAAAAAABYAFBERERERERERERERERERERERERERAAEBH6CGAQAAAAAAFgAUEREREREREREREREREREREREREREAAA==',
    txid: '1e6f8cbd70e0bd2e847184f8cc05e9947f4650c0874ab80d026623c5b6517c24',
    size: 205,
    total: 399000,
  },
  '4-4': {
    psbt: 'cHNidP8BAP0qAQIAAAAEAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAAAP////8CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgAAAAAA/////wMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAAAAAD/////BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAAAAP////8EpoUBAAAAAAAWABQWFhYWFhYWFhYWFhYWFhYWFhYWFqaFAQAAAAAAFgAUFxcXFxcXFxcXFxcXFxcXFxcXFxemhQEAAAAAABYAFBgYGBgYGBgYGBgYGBgYGBgYGBgYpoUBAAAAAAAWABQZGRkZGRkZGRkZGRkZGRkZGRkZGQAAAAAAAQEfoIYBAAAAAAAWABQREREREREREREREREREREREREREQABAR+ghgEAAAAAABYAFBERERERERERERERERERERERERERAAEBH6CGAQAAAAAAFgAUEREREREREREREREREREREREREREAAQEfoIYBAAAAAAAWABQREREREREREREREREREREREREREQAAAAAA',
    txid: '2d02702e9bcb6689e13af140b66a3299bfc2b0a802e66d7728cbe673b5cd4b25',
    size: 298,
    total: 399000,
  },
  '3-1': {
    psbt: 'cHNidP8BAKQCAAAAAwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAAAP////8DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAAAAAA/////wH4jwQAAAAAABYAFBYWFhYWFhYWFhYWFhYWFhYWFhYWAAAAAAABAR+ghgEAAAAAABYAFBERERERERERERERERERERERERERAAEBH6CGAQAAAAAAFgAUEREREREREREREREREREREREREREAAQEfoIYBAAAAAAAWABQREREREREREREREREREREREREREQAA',
    txid: '77b0bf210115c6e4c9c18c0cc10190ff173c97d858c81cca381a501ba609d861',
    size: 164,
    total: 299000,
  },
} as const;
const addresses = [
  'sys1qzctpv9skzctpv9skzctpv9skzctpv9skl8lkwv',
  'sys1qzut3w9chzut3w9chzut3w9chzut3w9ch7h7hyd',
  'sys1qrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqc30vrq5',
  'sys1qryv3jxgeryv3jxgeryv3jxgeryv3jxgesldz24',
];
function fixture(key: keyof typeof vectors) {
  const vector = vectors[key];
  const [inputCount, outputCount] = key.split('-').map(Number);
  const valueSatoshis = String(vector.total / outputCount);
  return {
    psbt: vector.psbt,
    amount: String(vector.total / 1e8),
    decoded: {
      txid: vector.txid,
      hash: Array.from(Buffer.from(vector.txid, 'hex').reverse()).join(','),
      version: 2,
      size: vector.size,
      vsize: vector.size,
      weight: vector.size * 4,
      locktime: 0,
      feeSatoshis: '1000',
      vin: Array.from({ length: inputCount }, (_, index) => ({
        txid: (index + 1).toString(16).padStart(2, '0').repeat(32),
        vout: 0,
        scriptSig: { asm: '', hex: '' },
        sequence: 4294967295,
      })),
      vout: Array.from({ length: outputCount }, (_, index) => ({
        n: index,
        value: Number(valueSatoshis) / 1e8,
        valueSatoshis,
        scriptPubKey: {
          asm: 'OP_0 ' + (22 + index).toString(16).repeat(20),
          hex: '0014' + (22 + index).toString(16).repeat(20),
          type: 'witness_v0_keyhash',
          reqSigs: 1,
          addresses: [addresses[index]],
        },
      })),
      syscoin: {
        txtype: 'bitcoin',
        version: 2,
        allocations: null,
        burn: null,
        mint: null,
        poda: null,
        inputAssets: [],
      },
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/');
  mockClear.mockResolvedValue(undefined);
  mockState = {
    vault: {
      activeNetwork: {
        kind: 'syscoin',
        chainId: 57,
        currency: 'SYS',
        label: 'Syscoin',
        url: 'http://127.0.0.1:1',
      },
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: 'synthetic-sender',
            balances: { syscoin: '1' },
          },
        },
      },
      accountTransactions: {},
    },
    price: { fiat: { asset: 'USD' } },
  };
  mockLocation = {
    key: 'psbt-disclosure-' + ++entry,
    pathname: '/send/confirm',
    state: { submissionStarted: false, walletScope: mockScope },
  };
  mockEmitter.mockImplementation(async (method: string[], args: any[]) => {
    if (method[1] !== 'decodeRawTransaction')
      throw Error(
        'Unexpected controller call (signing forbidden): ' + method.join('.')
      );
    expect(args).toEqual([mockLocation.state.tx.psbt]);
    return mockDecoded;
  });
});
afterEach(() => {
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter.mock.calls[0][0]).toEqual([
    'wallet',
    'decodeRawTransaction',
  ]);
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement
) {
  for (let count = 0; count < 40 && document.activeElement !== target; count++)
    await user.tab();
  expect(document.activeElement).toBe(target);
}
async function openAdvanced(key: keyof typeof vectors) {
  const data = fixture(key);
  mockDecoded = data.decoded;
  mockLocation.state.tx = {
    sender: 'synthetic-sender',
    receivingAddress: addresses[0],
    amount: data.amount,
    fee: 0.00001,
    psbt: data.psbt,
    token: null,
  };
  const user = userEvent.setup();
  const view = render(<SendConfirm />);
  const advanced = screen.getByRole('button', { name: 'send.advancedDetails' });
  await tabTo(user, advanced);
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.getByText('Technical Details:')).toBeTruthy()
  );
  expect(view.container.querySelector('form')).toBeNull();
  return { user };
}
it('opens and closes four inputs using normal Tab, Enter and Space', async () => {
  const { user } = await openAdvanced('4-1');
  expect(screen.queryByText('Input #0')).toBeNull();
  const button = screen.getByRole('button', { name: 'send.inputs (4)' });
  expect(button.getAttribute('type')).toBe('button');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await tabTo(user, button);
  await user.keyboard('{Enter}');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'send.inputs (4)' })).toBe(button);
  expect(screen.getByText('Input #0')).toBeTruthy();
  expect(screen.getByText('Input #3')).toBeTruthy();
  await user.keyboard(' ');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Input #0')).toBeNull();
});
it('opens and closes four outputs using normal Tab, Space and Enter', async () => {
  const { user } = await openAdvanced('4-4');
  expect(screen.queryByText('Output #0')).toBeNull();
  const button = screen.getByRole('button', { name: 'send.outputs (4)' });
  expect(button.getAttribute('type')).toBe('button');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await tabTo(user, button);
  await user.keyboard(' ');
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'send.outputs (4)' })).toBe(button);
  expect(screen.getByText('Output #0')).toBeTruthy();
  expect(screen.getByText('Output #3')).toBeTruthy();
  await user.keyboard('{Enter}');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Output #0')).toBeNull();
});
it('retains mouse toggling for both four-row sections', async () => {
  const { user } = await openAdvanced('4-4');
  for (const [label, row] of [
    ['send.inputs (4)', 'Input #3'],
    ['send.outputs (4)', 'Output #3'],
  ]) {
    await user.click(screen.getByText(label));
    expect(screen.getByText(row)).toBeTruthy();
    await user.click(screen.getByText(label));
    expect(screen.queryByText(row)).toBeNull();
  }
});
it('keeps three inputs and one output expanded by default', async () => {
  await openAdvanced('3-1');
  expect(screen.getByText('Input #0')).toBeTruthy();
  expect(screen.getByText('Input #2')).toBeTruthy();
  expect(screen.getByText('Output #0')).toBeTruthy();
});
it('keeps sibling Copy Details keyboard-operable without submitting', async () => {
  const { user } = await openAdvanced('4-1');
  const copy = screen.getByRole('button', { name: 'Copy Details' });
  expect(copy.tagName).toBe('BUTTON');
  expect(copy.closest('form')).toBeNull();
  await tabTo(user, copy);
  await user.keyboard('{Enter}');
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockCopy.mock.calls[0][0])).toMatchObject({
    txid: vectors['4-1'].txid,
    feeSatoshis: '1000',
  });
});
