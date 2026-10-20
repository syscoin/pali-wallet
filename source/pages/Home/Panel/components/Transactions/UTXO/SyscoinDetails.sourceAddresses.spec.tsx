/** @jest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import * as sys from 'syscoinjs-lib';

import SysTransactionController from 'scripts/Background/controllers/transactions/syscoin';
import { fetchBackendAccountCached } from 'scripts/Background/controllers/utils/fetchBackendAccountWrapper';

import { SyscoinTransactionDetails } from './SyscoinDetails';

// Valid testnet witness addresses from fixed public 20-byte programs; no keys.
const FROM_A = 'tsys1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpmtdx9f';
const FROM_B = 'tsys1qqgpqyqszqgpqyqszqgpqyqszqgpqyqsz20trwl';
const TO = 'tsys1qqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrtl2zy7';
const CHANGE = 'tsys1qqszqgpqyqszqgpqyqszqgpqyqszqgpqyt0d8rz';
const URL = 'https://blockbook.synthetic.invalid';
let mockState: any;
let mockHash = '';
let sequence = 0;
const mockCopy = jest.fn();
const mockEmitter = jest.fn();

jest.mock('syscoinjs-lib', () => ({ utils: { fetchBackendRawTx: jest.fn() } }));
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({ fetchBackendAccountCached: jest.fn() })
);
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
  NftFallbackSvg: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('hooks/index', () => ({
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: { info: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockState.scope,
}));
jest.mock('utils/index', () => {
  const formatting = jest.requireActual('utils/format');
  return {
    camelCaseToText: formatting.camelCaseToText,
    ellipsis: formatting.ellipsis,
    getTokenLogo: () => undefined,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHash = (++sequence).toString(16).padStart(64, 'a');
  mockState = {
    scope: { account: 'synthetic-account', network: 'synthetic-network' },
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { currency: 'sys', chainId: 57, url: URL },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy.mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

const mountFromBlockbook = async (
  inputs: Array<string[] | { addresses?: unknown; isAddress?: boolean }>
) => {
  const accountRow = {
    txid: mockHash,
    direction: 'sent',
    confirmations: 5,
    blockHeight: 42,
    blockTime: 1700000000,
    blockHash: 'b'.repeat(64),
    version: 2,
    fees: '1000',
    valueIn: String(inputs.length * 100000000),
    value: String(inputs.length * 100000000 - 1000),
    vin: inputs.map((input, index) => ({
      txid: String(index + 1).repeat(64),
      vout: index,
      n: index,
      ...(Array.isArray(input) ? { addresses: input, isAddress: true } : input),
      isOwn: true,
      value: '100000000',
      sequence: 0xffffffff,
    })),
    vout: [
      {
        n: 0,
        addresses: [TO],
        isAddress: true,
        isOwn: false,
        value: String(inputs.length * 100000000 - 50001000),
      },
      {
        n: 1,
        addresses: [CHANGE],
        isAddress: true,
        isOwn: true,
        value: '50000000',
      },
    ],
  };
  const withoutOwnership = (entry: any) => {
    const raw = { ...entry };
    delete raw.isOwn;
    return raw;
  };
  const rawRow = {
    ...accountRow,
    vin: accountRow.vin.map(withoutOwnership),
    vout: accountRow.vout.map(withoutOwnership),
  };
  const controller = SysTransactionController();
  jest.mocked(fetchBackendAccountCached).mockResolvedValue({
    txs: 1,
    unconfirmedTxs: 0,
    transactions: [accountRow],
  });
  jest.mocked(sys.utils.fetchBackendRawTx).mockResolvedValue(rawRow as any);
  const [summary] = await controller.getInitialUserTransactionsByXpub(
    'zpub-synthetic-public-account',
    URL
  );
  expect(summary.addressValueIn).toBe(String(inputs.length * 100000000));
  expect(summary.addressValueOut).toBe('50000000');
  mockEmitter.mockImplementation(async ([, method], [hash, url]) => {
    expect(method).toBe('getSysTransactionFromBlockbook');
    return controller.fetchTransactionDetailsFromBlockbook(hash, url);
  });
  const beforeRaw = JSON.stringify(rawRow);
  const beforeSummary = JSON.stringify(summary);
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={summary} />
  );
  await waitFor(() =>
    expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledWith(URL, mockHash)
  );
  await waitFor(() =>
    expect(
      within(screen.getByText('Fees').parentElement!).getByText('0.00001 SYS')
    ).toBeTruthy()
  );
  expect(JSON.stringify(rawRow)).toBe(beforeRaw);
  expect(JSON.stringify(summary)).toBe(beforeSummary);
  return { summary, rawRow, view, beforeRaw, beforeSummary };
};

const copyFrom = () => {
  fireEvent.click(
    within(screen.getByText('From').parentElement!).getByRole('button')
  );
  return mockCopy.mock.calls.at(-1)?.[0];
};

it('healthy one-input transaction preserves its sender and exact atomic fee', async () => {
  await mountFromBlockbook([[FROM_A]]);
  expect(copyFrom()).toBe(FROM_A);
});

it('healthy multiple inputs from the same address do not duplicate the sender', async () => {
  await mountFromBlockbook([[FROM_A], [FROM_A]]);
  expect(copyFrom()).toBe(FROM_A);
});

it('healthy one multi-address input preserves all its source addresses', async () => {
  await mountFromBlockbook([[FROM_A, FROM_B]]);
  expect(copyFrom()).toBe(`${FROM_A}, ${FROM_B}`);
});

it('must not omit a distinct sender address present in a later Blockbook input', async () => {
  await mountFromBlockbook([[FROM_A], [FROM_B]]);
  expect(copyFrom()).toBe(`${FROM_A}, ${FROM_B}`);
});

it('preserves unique first-seen input order through hydration, tooltip, copy and reopen', async () => {
  const { summary, rawRow, view, beforeRaw, beforeSummary } =
    await mountFromBlockbook([[FROM_A], [FROM_B], [FROM_A]]);
  const expected = `${FROM_A}, ${FROM_B}`;
  const fromRow = screen.getByText('From').parentElement!;
  fireEvent.mouseEnter(fromRow.querySelector('span > div')!);
  await screen.findByText(expected);
  expect(copyFrom()).toBe(expected);
  expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  await waitFor(() => expect(copyFrom()).toBe(expected));
  expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(rawRow)).toBe(beforeRaw);
  expect(JSON.stringify(summary)).toBe(beforeSummary);
});

it.each([
  { addresses: [FROM_B], isAddress: false },
  { addresses: 'malformed non-array address list' },
  { addresses: null },
  {},
  { addresses: ['OP_RETURN data', 'two words', '', null, 7] },
])(
  'ignores a non-address or malformed input without hiding another source: %j',
  async (invalid) => {
    await mountFromBlockbook([invalid, [FROM_A]]);
    expect(copyFrom()).toBe(FROM_A);
  }
);
