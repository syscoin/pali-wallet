/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { BigNumber, Interface } from 'utils/ethersV6Compat';

import { SendTransaction } from './SendTransaction';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
const mockNavigate = jest.fn();
const mockCopy = jest.fn().mockResolvedValue(undefined);
const mockState = {
  vault: {
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: {
        0: {
          id: 0,
          address: `0x${'11'.repeat(20)}`,
          balances: { ethereum: '1' },
        },
      },
    },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      currency: 'ETH',
      url: 'https://tabs.synthetic.invalid',
    },
  },
  vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 30 } },
};
const mockDecoded = {
  method: 'record',
  inputs: ['42'],
  names: ['value'],
  types: ['uint256'],
};
const mockData = new Interface([
  'function record(uint256 value)',
]).encodeFunctionData('record', [42]);
const mockTransaction = {
  from: mockState.vault.accounts.HDAccount[0].address,
  to: `0x${'22'.repeat(20)}`,
  data: mockData,
  value: '0x0',
};
const mockQuery = {
  host: 'https://tabs-dapp.synthetic.invalid',
  eventName: 'sendTransaction',
  external: true,
  tx: mockTransaction,
  decodedTx: mockDecoded,
  txMetadata: {},
};

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/external/tx/send/ethTx',
    state: mockQuery,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: mockNavigate,
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/fetchGasAndDecodeFunction', () => ({
  fetchGasAndDecodeFunction: async () => ({
    feeDetails: { gasLimit: 21000, maxFeePerGas: 2, maxPriorityFeePerGas: 1 },
    formTx: { ...mockTransaction, gasLimit: BigNumber.from(21000), nonce: 0 },
    nonce: 0,
    isInvalidTxData: false,
    gasLimitError: false,
  }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  signAndSubmitSmartAccountExecutions: jest.fn(),
  isSmartAccountFeeQuoteChanged: () => false,
}));
jest.mock('utils/logger', () => ({ logError: jest.fn() }));
jest.mock('./EditPriority', () => ({ EditPriorityModal: () => null }));
jest.mock('./EditApprovedAllowanceValueModal', () => ({
  EditApprovedAllowanceValueModal: () => null,
}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => <p>Loading review</p>,
  PqSigningOverlay: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, ...props }: any) => (
    <button type={props.type} onClick={props.onClick} disabled={props.disabled}>
      {children}
    </button>
  ),
  DeviceWaitingBanner: () => null,
  WarningModal: () => null,
}));
jest.mock('@ant-design/icons', () => ({}));

const panel = (name: string) => document.getElementById(`${name}Tab`)!;
const assertPanel = (name: string) => {
  for (const candidate of ['details', 'data', 'hex']) {
    expect(panel(candidate).classList.contains('hidden')).toBe(
      candidate !== name
    );
  }
};
const assertSelectedTab = (name: string) => {
  assertPanel(name);
  for (const candidate of ['details', 'data', 'hex']) {
    const tab = within(screen.getByRole('tablist')).getByRole('tab', {
      name: `send.${candidate}`,
    });
    expect(tab).toHaveAttribute('aria-controls', `${candidate}Tab`);
    expect(tab).toHaveAttribute('aria-selected', String(candidate === name));
    expect(tab).toHaveAttribute('tabindex', candidate === name ? '0' : '-1');
    expect(panel(candidate)).toHaveAttribute('aria-labelledby', tab.id);
  }
};
const assertCalldata = () => {
  const json = panel('data').querySelector('pre')!.textContent!;
  expect(JSON.parse(json)).toEqual(mockDecoded);
  expect(panel('hex')).toHaveTextContent(mockData);
};
const prepare = async () => {
  render(
    <>
      <button>Begin transaction review</button>
      <SendTransaction />
    </>
  );
  await screen.findByRole('button', { name: 'buttons.confirm' });
  assertPanel('details');
  assertCalldata();
};
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockImplementation(async ([, method]) => {
    if (method === 'refreshActiveAccountBalances')
      return { nativeBalance: '1' };
    if (method === 'checkAddressBlacklist') return { isBlacklisted: false };
    if (method === 'isContractAddress') return true;
    throw Error(`Unexpected controller method: ${method}`);
  });
});

it('retains the actual decoded and hexadecimal calldata when changing tabs with the mouse', async () => {
  await prepare();
  fireEvent.click(within(screen.getByRole('tablist')).getByText('send.data'));
  assertPanel('data');
  fireEvent.click(within(screen.getByRole('tablist')).getByText('send.hex'));
  assertSelectedTab('hex');
  fireEvent.click(
    within(screen.getByRole('tablist')).getByText('send.details')
  );
  assertSelectedTab('details');
  assertCalldata();
  expect(
    mockEmitter.mock.calls.some(([methods]) =>
      String(methods[1]).startsWith('send')
    )
  ).toBe(false);
});

it('lets a keyboard-only reviewer reach the tablist and inspect Data and Hex without submitting', async () => {
  await prepare();
  const user = userEvent.setup();
  const start = screen.getByRole('button', {
    name: 'Begin transaction review',
  });
  start.focus();
  const focusedLabels: string[] = [];
  for (let step = 0; step < 25; step += 1) {
    await user.tab();
    focusedLabels.push(document.activeElement?.textContent || '');
    if (document.activeElement === start) break;
  }
  // This asserts the actual tab order, rather than merely asking for ARIA roles.
  expect(focusedLabels).toContain('send.details');
  const details = within(screen.getByRole('tablist')).getByRole('tab', {
    name: 'send.details',
  });
  for (let step = 0; document.activeElement !== details && step < 25; step += 1)
    await user.tab();
  expect(details).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assertSelectedTab('data'));
  expect(
    within(screen.getByRole('tablist')).getByRole('tab', { name: 'send.data' })
  ).toHaveFocus();
  await user.keyboard('{End}');
  await waitFor(() => assertSelectedTab('hex'));
  expect(
    within(screen.getByRole('tablist')).getByRole('tab', { name: 'send.hex' })
  ).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assertSelectedTab('details'));
  expect(details).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => assertSelectedTab('hex'));
  await user.keyboard('{Home}');
  await waitFor(() => assertSelectedTab('details'));
  expect(details).toHaveFocus();
  assertCalldata();
  expect(
    mockEmitter.mock.calls.some(([methods]) =>
      String(methods[1]).startsWith('send')
    )
  ).toBe(false);
});
