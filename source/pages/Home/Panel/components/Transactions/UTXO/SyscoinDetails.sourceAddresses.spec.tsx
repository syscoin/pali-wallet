/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import * as sys from 'syscoinjs-lib';

import MainController from 'scripts/Background/controllers/MainController';
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
const originalFetch = globalThis.fetch;

jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('syscoinjs-lib', () => {
  const actual = jest.requireActual('syscoinjs-lib');
  return {
    ...actual,
    utils: { ...actual.utils, fetchBackendRawTx: jest.fn() },
  };
});
jest.mock(
  'scripts/Background/controllers/utils/fetchBackendAccountWrapper',
  () => ({ fetchBackendAccountCached: jest.fn() })
);
jest.mock(
  'scripts/Background/controllers/providers/walletHttpIdentity',
  () => ({
    withWalletBackend: async (
      _url: string,
      operation: () => Promise<unknown>
    ) => operation(),
  })
);
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
    i18n: { language: 'en' },
  }),
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
  globalThis.fetch = jest.fn();
  mockHash = (++sequence).toString(16).padStart(64, 'a');
  mockState = {
    scope: { account: 'synthetic-account', network: 'synthetic-network' },
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { currency: 'sys', chainId: 5700, slip44: 1, url: URL },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
    },
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy.mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const mountFromBlockbook = async (
  inputs: Array<string[] | { addresses?: unknown; isAddress?: boolean }>,
  options: {
    invalidScalars?: string;
    participantAlias?: string;
    rawFields?: Record<string, unknown>;
    rawUnavailable?: boolean;
    readRaw?: () => Promise<null>;
    recipientLabel?: string;
  } = {}
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
    ...(options.participantAlias && {
      from: options.participantAlias,
      to: options.participantAlias,
    }),
    ...(options.invalidScalars && {
      estimatedConfirmation: options.invalidScalars,
      confirmations: options.invalidScalars,
      blockHash: options.invalidScalars,
    }),
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
        addresses: options.recipientLabel ? [TO, options.recipientLabel] : [TO],
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
    ...options.rawFields,
  };
  const controller = SysTransactionController();
  jest.mocked(fetchBackendAccountCached).mockResolvedValue({
    txs: 1,
    unconfirmedTxs: 0,
    transactions: [accountRow],
  });
  const fetchRaw = jest.mocked(sys.utils.fetchBackendRawTx);
  if (options.readRaw) fetchRaw.mockImplementation(options.readRaw);
  else
    fetchRaw.mockResolvedValue(options.rawUnavailable ? null : (rawRow as any));
  const [summary] = await controller.getInitialUserTransactionsByXpub(
    'zpub-synthetic-public-account',
    URL
  );
  expect(summary.addressValueIn).toBe(String(inputs.length * 100000000));
  expect(summary.addressValueOut).toBe('50000000');
  const wallet = Object.create(MainController.prototype);
  wallet.isUnlocked = () => true;
  wallet.transactionsManager = { sys: controller };
  mockEmitter.mockImplementation(async ([, method], [hash, url, request]) => {
    expect(method).toBe('getSysTransactionFromBlockbook');
    return wallet.getSysTransactionFromBlockbook(hash, url, request);
  });
  const beforeRaw = JSON.stringify(rawRow);
  const beforeSummary = JSON.stringify(summary);
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={summary} />
  );
  await waitFor(() =>
    expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledWith(
      URL,
      mockHash,
      expect.objectContaining({
        fetch: expect.any(Function),
        signal: expect.any(AbortSignal),
      })
    )
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

it('ignores reflected metadata and leaves malformed confirmation and hash fields unavailable', async () => {
  const reflection = 'source:zpub-decorated-account-key';
  await mountFromBlockbook([[FROM_A]], { invalidScalars: reflection });
  await waitFor(() => expect(copyFrom()).toBe(FROM_A));
  expect(screen.queryByText('Estimated Confirmation')).toBeNull();
  for (const field of ['Block Hash', 'Confirmations']) {
    const row = within(screen.getByText(field).parentElement!);
    expect(row.getByText('settings.unavailable')).toBeTruthy();
    expect(row.queryByRole('button')).toBeNull();
  }
});

it('keeps reflected token metadata out of the hero and Asset GUID copy', async () => {
  const reflection = 'source:zpub-decorated-account-key';
  await mountFromBlockbook([[FROM_A]], {
    rawFields: {
      tokenType: 'SPTAssetAllocationMint',
      tokenTransfers: [{ token: reflection, symbol: reflection, decimals: 8 }],
      vout: [
        { n: 0, assetInfo: { assetGuid: reflection, value: '100000000' } },
      ],
    },
  });
  await screen.findByText('1.0000 SPT');
  expect(screen.queryByText(reflection)).toBeNull();
  expect(screen.queryByRole('button', { name: /asset.?guid/i })).toBeNull();
});

it('copies the exact canonical uint64 Asset GUID while excluding invalid alternatives', async () => {
  const guid = '18446744073709551615';
  await mountFromBlockbook([[FROM_A]], {
    rawFields: {
      tokenType: 'SPTAssetAllocationMint',
      tokenTransfers: [
        guid,
        '18446744073709551616',
        '0',
        '001',
        Number(guid),
      ].map((token) => ({ token, decimals: 8 })),
      vout: [{ n: 0, assetInfo: { assetGuid: guid, value: '100000000' } }],
    },
  });
  await screen.findByText('1.0000 SPT');
  fireEvent.click(screen.getByRole('button', { name: /asset.?guid/i }));
  expect(mockCopy).toHaveBeenLastCalledWith(guid);
});

it.each([
  ['legacy output label', { addresses: ['OP_RETURN reflected-label'] }],
  ['validated script hex', { hex: '6a01ff' }],
])('preserves the SYS to SYSX burn amount from a %s', async (_, evidence) => {
  await mountFromBlockbook([[FROM_A]], {
    rawFields: {
      tokenType: 'SPTSyscoinBurnToAssetAllocation',
      version: 139,
      vout: [
        { n: 0, addresses: [CHANGE], isAddress: true, value: '100000000' },
        { n: 1, value: '200000000', ...evidence },
      ],
    },
  });
  await screen.findByText('2.0000 SYSX');
  expect(screen.queryByText(/reflected-label/)).toBeNull();
});

it('keeps the exact admitted transaction ID and block hash copy bytes', async () => {
  await mountFromBlockbook([[FROM_A]]);
  await waitFor(() => expect(copyFrom()).toBe(FROM_A));
  fireEvent.click(
    within(screen.getByText('Block Hash').parentElement!).getByRole('button')
  );
  expect(mockCopy).toHaveBeenLastCalledWith('b'.repeat(64));
  fireEvent.click(
    within(screen.getByText('Transaction ID').parentElement!).getByRole(
      'button'
    )
  );
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
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

it.each([false, true])(
  'only copies vetted participants when the full body is unavailable: %s',
  async (rawUnavailable) => {
    const reflected = 'source:zpub-decorated-account-key';
    await mountFromBlockbook([[reflected, FROM_A.toUpperCase(), FROM_A]], {
      rawUnavailable,
      recipientLabel: reflected,
    });
    await waitFor(() => expect(copyFrom()).toBe(FROM_A));
    fireEvent.click(
      within(screen.getByText('To').parentElement!).getByRole('button')
    );
    expect(mockCopy).toHaveBeenLastCalledWith(`${TO}, ${CHANGE}`);
    expect(screen.queryByText(reflected)).toBeNull();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledTimes(1);
  }
);

it('refuses a mismatched or retired detail request at the background boundary', async () => {
  const wallet = Object.create(MainController.prototype);
  wallet.isUnlocked = jest.fn().mockReturnValue(false);
  wallet.networkRequestGeneration = 0;
  let finish!: (value: null) => void;
  const read = jest.fn(() =>
    wallet.isUnlocked()
      ? new Promise<null>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(null)
  );
  wallet.transactionsManager = {
    sys: { fetchTransactionDetailsFromBlockbook: read },
  };
  const compact = { txid: mockHash, from: [FROM_A], to: [TO] };
  await expect(
    wallet.getSysTransactionFromBlockbook(mockHash, URL, {
      scope: mockState.scope,
      compact,
    })
  ).rejects.toThrow('Transaction details changed');
  expect(read).not.toHaveBeenCalled();
  wallet.isUnlocked.mockReturnValue(true);
  await expect(
    wallet.getSysTransactionFromBlockbook(mockHash, URL, {
      scope: { ...mockState.scope, account: 'different-account' },
      compact,
    })
  ).rejects.toThrow('Transaction details changed');
  expect(read).not.toHaveBeenCalled();

  const pending = wallet.getSysTransactionFromBlockbook(mockHash, URL, {
    scope: mockState.scope,
    compact,
  });
  expect(read).toHaveBeenCalledTimes(1);
  wallet.networkRequestGeneration++;
  finish(null);
  await expect(pending).rejects.toThrow('Transaction details changed');
});

it('shares a held compact fallback and keeps it through equal polling replacements', async () => {
  let finish!: (value: null) => void;
  const pending = new Promise<null>((resolve) => {
    finish = resolve;
  });
  const { summary, view } = await mountFromBlockbook([[FROM_A]], {
    readRaw: () => pending,
  });
  const polled = { ...summary, confirmations: 6 };
  view.rerender(<SyscoinTransactionDetails hash={mockHash} tx={polled} />);
  const another = render(
    <SyscoinTransactionDetails hash={mockHash} tx={{ ...polled }} />
  );
  await act(async () => finish(null));
  const from = (container: HTMLElement) =>
    within(within(container).getByText('From').parentElement!);
  for (const container of [view.container, another.container]) {
    fireEvent.click(from(container).getByRole('button'));
    expect(mockCopy).toHaveBeenLastCalledWith(FROM_A);
  }
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(sys.utils.fetchBackendRawTx).toHaveBeenCalledTimes(1);

  const changed = {
    ...polled,
    vin: polled.vin.map((input) => ({ ...input, addresses: [FROM_B] })),
  };
  view.rerender(<SyscoinTransactionDetails hash={mockHash} tx={changed} />);
  expect(from(view.container).getByText('settings.unavailable')).toBeTruthy();
  expect(from(view.container).queryByRole('button')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  view.unmount();
  another.unmount();
  render(<SyscoinTransactionDetails hash={mockHash} tx={changed} />);
  await waitFor(() => expect(copyFrom()).toBe(FROM_B));
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  'ignores raw top-level From/To aliases when the full body is unavailable: %s',
  async (rawUnavailable) => {
    await mountFromBlockbook([[FROM_A]], {
      rawUnavailable,
      participantAlias: 'source:zpub-decorated-account-key',
    });
    await waitFor(() => expect(copyFrom()).toBe(FROM_A));
    expect(screen.getAllByText('From')).toHaveLength(1);
    expect(screen.getAllByText('To')).toHaveLength(1);
  }
);

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
