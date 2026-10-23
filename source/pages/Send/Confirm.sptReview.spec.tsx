/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SendConfirm } from './Confirm';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockClear = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
const mockScope = {
  account: 'synthetic-account',
  network: 'synthetic-network',
};
let mockConfirmClick: () => Promise<unknown> | void;
let mockLocation: any;
let mockState: any;
let mockAsset: any;
let mockDecoded: any;
let mockDecode: () => Promise<any>;
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
    useCopyClipboard: () => [false, jest.fn()],
  }),
  usePrice: () => ({ getFiatAmount: () => null }),
}));
jest.mock('hooks/useEIP1559', () => ({
  useEIP1559: () => ({ isEIP1559Compatible: false, forceRecheck: jest.fn() }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
  selectActiveAccountAssets: () => ({ syscoin: [mockAsset], ethereum: [] }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, onClick, disabled }: any) => {
    if (children === 'buttons.confirm') mockConfirmClick = onClick;
    return (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
  Icon: () => null,
  DeviceWaitingBanner: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
  IconButton: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
jest.mock('components/Loading', () => ({ PqSigningOverlay: () => null }));
jest.mock('components/Icon/Icon', () => ({
  WarningOutlined: () => null,
  CheckCircleOutlined: () => null,
  ClockCircleOutlined: () => null,
  DownOutlined: () => null,
  RightOutlined: () => null,
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockClear.mockResolvedValue(undefined);
  mockAsset = {
    assetGuid: '123458',
    assetType: 'ERC20',
    contract: `0x${'11'.repeat(20)}`,
    originDecimals: 0,
    decimals: 8,
    symbol: 'E20ZERO',
  };
  mockState = {
    vault: {
      activeNetwork: {
        chainId: 5700,
        currency: 'TSYS',
        label: 'Syscoin Testnet',
        url: 'https://controlled-blockbook.invalid',
      },
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { id: 0, address: 'synthetic-sender', balances: { syscoin: '1' } },
        },
      },
      accountTransactions: {},
    },
    price: { fiat: { asset: 'USD' } },
  };
  mockLocation = {
    key: `spt-review-${++entry}`,
    pathname: '/send/confirm',
    state: {
      walletScope: mockScope,
      tx: {
        sender: 'synthetic-sender',
        receivingAddress: 'synthetic-recipient',
        amount: '1.99999999',
        fee: 0.00000344,
        psbt: 'controlled-unsigned-spt',
        token: {
          assetGuid: '123458',
          guid: '123458',
          symbol: 'E20ZERO',
          decimals: 8,
        },
      },
    },
  };
  mockDecoded = {
    feeSatoshis: '344',
    fee: 0.00000344,
    version: 142,
    syscoin: {
      txtype: 'assetallocationsend',
      allocations: {
        assets: [
          { assetGuid: '123458', values: [{ n: 0, value: '199999999' }] },
        ],
      },
    },
    vin: [],
    vout: [
      {
        n: 0,
        value: 0.00000546,
        valueSatoshis: '546',
        scriptPubKey: {
          type: 'witness_v0_keyhash',
          addresses: ['synthetic-recipient'],
          hex: `0014${'22'.repeat(20)}`,
        },
      },
    ],
  };
  mockDecode = async () => mockDecoded;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'decodeRawTransaction') return mockDecode();
    if (method === 'addSysDefaultToken') return mockAsset;
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '1' };
    if (method === 'signSendAndSaveTransaction')
      return { txid: 'synthetic-only-no-publication' };
    throw new Error(`Unexpected controller method: ${method}`);
  });
});

// Actual Confirm, PSBT review component and metadata validator are rendered.
// Only controller read responses are synthetic; there is no signing or RPC.
it('blocks missing origin metadata without opening Advanced and rejects a direct click', async () => {
  delete mockAsset.contract;
  render(<SendConfirm />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  );
  expect(
    screen.getByRole('button', { name: 'send.advancedDetails' })
  ).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getByText('Unable to verify origin contract for asset 123458')
    ).toBeTruthy()
  );
  await act(async () => {
    await mockConfirmClick();
  });
  expect(
    mockEmitter.mock.calls.some(
      ([[, method]]) => method === 'signSendAndSaveTransaction'
    )
  ).toBe(false);
  expect(mockClear).not.toHaveBeenCalled();
});

it('keeps Confirm disabled until mandatory SPT review finishes, then reuses it when expanded', async () => {
  let resolve!: (value: any) => void;
  mockDecode = () =>
    new Promise((done) => {
      resolve = done;
    });
  render(<SendConfirm />);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'decodeRawTransaction'],
      ['controlled-unsigned-spt'],
      expect.any(Number)
    )
  );
  await act(async () => {
    resolve(mockDecoded);
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  const beforeExpansion = mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'decodeRawTransaction'
  ).length;
  expect(beforeExpansion).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'send.advancedDetails' }));
  expect(screen.getByText('transactions.outputsHeading')).toBeTruthy();
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'decodeRawTransaction'
    )
  ).toHaveLength(beforeExpansion);
});

it('does not decode an ordinary native preview until Advanced is opened', async () => {
  mockLocation.state.tx.token = null;
  mockDecoded.syscoin = { txtype: 'bitcoin', allocations: null };
  render(<SendConfirm />);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(false);
  expect(mockEmitter).not.toHaveBeenCalledWith(
    ['wallet', 'decodeRawTransaction'],
    expect.anything(),
    expect.anything()
  );
  fireEvent.click(screen.getByRole('button', { name: 'send.advancedDetails' }));
  await waitFor(() =>
    expect(screen.getByText('transactions.outputsHeading')).toBeTruthy()
  );
});

it('invalidates a previously completed review when the unsigned SPT changes', async () => {
  const view = render(<SendConfirm />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.confirm',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
  let resolve!: (value: any) => void;
  mockDecode = () =>
    new Promise((done) => {
      resolve = done;
    });
  mockLocation.state.tx = {
    ...mockLocation.state.tx,
    psbt: 'different-unsigned-spt',
  };
  view.rerender(<SendConfirm />);
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => {
    resolve({ ...mockDecoded, error: 'Failed to decode transaction details' });
  });
  await waitFor(() =>
    expect(
      screen.getByText('Failed to decode transaction details')
    ).toBeTruthy()
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.confirm',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});
