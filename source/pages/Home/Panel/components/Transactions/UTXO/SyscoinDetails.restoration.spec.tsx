/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import { clearTokenIconCache } from 'components/TokenIcon';
import { ISysTransaction } from 'scripts/Background/controllers/transactions/types';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { getKnownTokenLogo, getTokenLogo } from 'utils/tokens';

import {
  compactBridgeNativeOffset,
  compactBridgeWithAccountAsset,
} from './history.fixtures';
import { SyscoinTransactionDetails } from './SyscoinDetails';

let mockState: any;
let mockHash: string;
let mockSequence = 0;
const mockEmitter = jest.fn();
const mockIconFetch = jest.fn();
const mockCopy = jest.fn();
const mockCopyAlert = { info: jest.fn(), error: jest.fn() };
const originalFetch = global.fetch;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
);

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
// Decorative icons do not affect transaction rendering and pull in browser-only antd ESM.
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  ArrowUpSvg: () => null,
  ReceivedArrowSvg: () => null,
  NftFallbackSvg: () => null,
}));
jest.mock('hooks/index', () => ({
  useTransactionsListConfig: jest.requireActual(
    'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
  ).useTransactionsListConfig,
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: mockCopyAlert,
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockState.scope,
}));
jest.mock('utils/index', () => {
  const format = jest.requireActual('utils/format');
  return {
    camelCaseToText: format.camelCaseToText,
    ellipsis: format.ellipsis,
    getTokenLogo: jest.requireActual('utils/tokens').getTokenLogo,
  };
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const rawTransaction = (changes: Partial<ISysTransaction> = {}) =>
  ({
    txid: mockHash,
    blockHash: '',
    blockHeight: 0,
    blockTime: 0,
    confirmations: 0,
    fees: '1000',
    hex: '00',
    value: '900000000',
    valueIn: '900001000',
    version: 2,
    vin: [{ addresses: ['raw-from'], value: '900001000' }],
    vout: [{ addresses: ['raw-to'], value: '900000000' }],
    ...changes,
  } as ISysTransaction);
const confirmationValue = () =>
  within(screen.getByText('Confirmations').parentElement!).getByText(/^\d+$/);
const detailValue = (label: string, value: string) =>
  within(screen.getByText(label).parentElement!).getByText(value);
const tokenTransaction = (
  assetGuid: string | undefined = '123456',
  symbol = 'SYSX'
) =>
  rawTransaction({
    direction: 'sent',
    addressValueIn: '1000',
    addressValueOut: '0',
    tokenType: 'SPTAssetAllocationSend',
    accountAssetTransfers: [
      { assetGuid, symbol, decimals: 8, value: '100000000' },
    ] as any,
    tokenTransfers: [{ token: assetGuid, symbol, decimals: 8 }] as any,
  });
const setAccountAssets = (syscoin: any[], id = 0) => {
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      accountAssets: {
        ...mockState.vault.accountAssets,
        HDAccount: {
          ...mockState.vault.accountAssets.HDAccount,
          [id]: { ethereum: [], syscoin },
        },
      },
    },
  };
};
const expectAmountIcon = async (amount: string, logo: string) => {
  const icon = await screen.findByAltText(/./);
  await waitFor(() => expect(icon.getAttribute('src')).toBe(logo));
  expect(screen.getByText(amount).parentElement!.contains(icon)).toBe(true);
  return icon;
};
const mountHydratedDetails = async (transaction: ISysTransaction) => {
  const hydration = deferred<ISysTransaction>();
  mockEmitter
    .mockResolvedValue(transaction)
    .mockReturnValueOnce(hydration.promise);
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={transaction} />
  );
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'getSysTransactionFromBlockbook'],
      [mockHash, mockState.vault.activeNetwork.url]
    )
  );
  // Hydration replaces the rendered details subtree. Finish that controlled
  // read before querying a button, rather than clicking a detached summary row.
  await act(async () => hydration.resolve(transaction));
  return view;
};
const currentHashCopyButton = () => {
  const button = within(screen.getByText('Txid').parentElement!).getByRole(
    'button'
  );
  expect(button.isConnected).toBe(true);
  return button;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset();
  mockCopy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
  clearTokenIconCache();
  // Exercise the real icon/cache component without making any image request.
  // A synthetic oversized blob keeps the requested URL as the rendered src.
  mockIconFetch.mockResolvedValue({
    ok: true,
    blob: async () => ({ size: 256 * 1024 + 1 }),
  });
  global.fetch = mockIconFetch as any;
  mockHash = 'abc' + (++mockSequence).toString(16).padStart(61, '0');
  mockState = {
    scope: { account: 'account-a', network: 'network-a' },
    vault: {
      isBitcoinBased: true,
      activeAccount: { type: 'HDAccount', id: 0 },
      accountAssets: { HDAccount: { 0: { ethereum: [], syscoin: [] } } },
      activeNetwork: {
        currency: 'sys',
        chainId: 57,
        url: 'https://blockbook.example',
      },
    },
  };
});

afterEach(() => {
  clearTokenIconCache();
  global.fetch = originalFetch;
});
afterAll(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as any).clipboard;
});

it('does not announce a transaction clipboard copy before completion or after refusal', async () => {
  const transaction = rawTransaction();
  await mountHydratedDetails(transaction);
  const pending = deferred<void>();
  mockCopy.mockReturnValueOnce(pending.promise);
  fireEvent.click(currentHashCopyButton());
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
  expect(mockCopyAlert.info).not.toHaveBeenCalled();
  await act(async () => pending.resolve(undefined));
  expect(mockCopyAlert.info).toHaveBeenCalledWith('home.hashCopied');
  mockCopyAlert.info.mockClear();
  const denied = Promise.reject(new Error('denied'));
  void denied.catch(() => undefined);
  mockCopy.mockReturnValueOnce(denied);
  // Hydration can replace the rendered details tree while copying. Interact
  // with the current row, not the detached button from the previous render.
  fireEvent.click(currentHashCopyButton());
  expect(mockCopy).toHaveBeenCalledTimes(2);
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
  await act(async () => undefined);
  expect(mockCopyAlert.info).not.toHaveBeenCalled();
  expect(mockCopyAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
});

it.each(
  ['transaction', 'account', 'network', 'unmount', 'round-trip'].flatMap(
    (change) => ['success', 'failure'].map((outcome) => ({ change, outcome }))
  )
)(
  'ignores delayed transaction clipboard $outcome after $change changes',
  async ({ change, outcome }) => {
    const transaction = rawTransaction();
    const view = await mountHydratedDetails(transaction);
    const pending = deferred<void>();
    mockCopy.mockReturnValueOnce(pending.promise);
    fireEvent.click(currentHashCopyButton());
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
    if (change === 'unmount') view.unmount();
    else {
      if (change === 'transaction') mockHash = 'def' + mockHash.slice(3);
      if (change === 'account')
        mockState.scope = { ...mockState.scope, account: 'account-b' };
      if (change === 'network')
        mockState.scope = { ...mockState.scope, network: 'network-b' };
      view.rerender(
        <SyscoinTransactionDetails hash={mockHash} tx={rawTransaction()} />
      );
      if (change === 'round-trip') {
        mockState.scope = { ...mockState.scope, account: 'account-b' };
        view.rerender(
          <SyscoinTransactionDetails hash={mockHash} tx={rawTransaction()} />
        );
        mockState.scope = { ...mockState.scope, account: 'account-a' };
        view.rerender(
          <SyscoinTransactionDetails hash={mockHash} tx={rawTransaction()} />
        );
      }
    }
    await act(async () => {
      if (outcome === 'failure') pending.reject(new Error('clipboard denied'));
      else pending.resolve(undefined);
    });
    expect(mockCopyAlert.info).not.toHaveBeenCalled();
    expect(mockCopyAlert.error).not.toHaveBeenCalled();
  }
);

it('keeps feedback bound to the latest transaction clipboard action', async () => {
  const transaction = rawTransaction();
  await mountHydratedDetails(transaction);
  const pending = deferred<void>();
  mockCopy.mockReturnValueOnce(pending.promise);
  const copyHash = () => fireEvent.click(currentHashCopyButton());
  copyHash();
  expect(mockCopy).toHaveBeenCalledTimes(1);
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
  await act(async () => copyHash());
  expect(mockCopy).toHaveBeenCalledTimes(2);
  expect(mockCopy).toHaveBeenLastCalledWith(mockHash);
  expect(mockCopyAlert.info).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(undefined));
  expect(mockCopyAlert.info).toHaveBeenCalledTimes(1);
});

it.each([
  {
    name: 'mint140 proof before the positive asset credit',
    version: 140,
    tokenType: 'SPTAssetAllocationMint',
    vout: [
      {
        addresses: ['OP_RETURN proof-ff8d'],
        isAddress: false,
        hex: '6a4d8107',
        value: '0',
      },
      {
        addresses: ['tsys1q0dlpmyhrwzljprrvhv4dut9da42fcvz9c38dt7'],
        isAddress: true,
        value: '885578',
        assetInfo: { assetGuid: '12', value: '100000000' },
      },
    ],
    expected: 'tsys1q0dlpmyhrwzljprrvhv4dut9da42fcvz9c38dt7',
  },
  {
    name: 'ordinary SPT recipient plus asset change without guessing intent',
    version: 142,
    tokenType: 'SPTAssetAllocationSend',
    vout: [
      { addresses: ['native-funding-change'], value: '1000' },
      {
        addresses: ['spt-recipient'],
        value: '294',
        assetInfo: { assetGuid: '12', value: '10000000' },
      },
      { addresses: ['OP_RETURN allocation'], hex: '6a07', value: '0' },
      {
        addresses: ['spt-change'],
        value: '294',
        assetInfo: { assetGuid: '12', value: '90000000' },
      },
      {
        addresses: ['spt-recipient'],
        value: '294',
        assetInfo: { assetGuid: '14', value: '1' },
      },
    ],
    expected: 'spt-recipient, spt-change',
  },
  {
    name: 'native output destinations with a leading protocol output',
    version: 2,
    vout: [
      { addresses: ['OP_RETURN data'], value: '0' },
      { addresses: ['native-recipient'], value: '1000' },
      { addresses: ['native-change'], value: '2000' },
    ],
    expected: 'native-recipient, native-change',
  },
  {
    name: 'native to SPT conversion uses the asset credit not burned SYS',
    version: 139,
    tokenType: 'SPTSyscoinBurnToAssetAllocation',
    vout: [
      { addresses: ['native-change'], value: '1000' },
      { addresses: ['OP_RETURN burn'], value: '100000000' },
      {
        addresses: ['converted-asset-recipient'],
        value: '294',
        assetInfo: { assetGuid: '123456', value: '100000000' },
      },
    ],
    expected: 'converted-asset-recipient',
  },
  {
    name: 'SPT burn to native uses the native receiving outputs',
    version: 138,
    tokenType: 'SPTAssetAllocationBurnToSyscoin',
    vout: [
      {
        addresses: ['OP_RETURN burn'],
        value: '0',
        assetInfo: { assetGuid: '123456', value: '100000000' },
      },
      { addresses: ['native-redemption-recipient'], value: '100000000' },
    ],
    expected: 'native-redemption-recipient',
  },
  {
    name: 'NEVM burn never substitutes remaining native or asset change',
    version: 141,
    tokenType: 'SPTAssetAllocationBurnToNEVM',
    vout: [
      {
        addresses: ['OP_RETURN burn-destination'],
        value: '0',
        assetInfo: { assetGuid: '12', value: '10000000' },
      },
      { addresses: ['native-change'], value: '1000' },
      {
        addresses: ['asset-change'],
        value: '294',
        assetInfo: { assetGuid: '12', value: '90000000' },
      },
    ],
    expected: 'settings.unavailable',
  },
  {
    name: 'missing positive allocation leaves the asset recipient unknown',
    version: 140,
    tokenType: 'SPTAssetAllocationMint',
    vout: [
      { addresses: ['native-change'], value: '1000' },
      {
        addresses: ['zero-asset'],
        value: '294',
        assetInfo: { assetGuid: '12', value: '0' },
      },
      {
        addresses: ['missing-asset-guid'],
        value: '294',
        assetInfo: { value: '1' },
      },
      {
        addresses: ['malformed-asset-guid'],
        value: '294',
        assetInfo: { assetGuid: 'not-an-asset', value: '1' },
      },
      {
        addresses: ['zero-asset-guid'],
        value: '294',
        assetInfo: { assetGuid: '0', value: '1' },
      },
    ],
    expected: 'settings.unavailable',
  },
  {
    name: 'unknown asset operation cannot turn asset change into a recipient',
    version: 141,
    vout: [
      { addresses: ['OP_RETURN burn-destination'], value: '0' },
      {
        addresses: ['asset-change'],
        value: '294',
        assetInfo: { assetGuid: '12', value: '90000000' },
      },
    ],
    expected: 'settings.unavailable',
  },
  {
    name: 'script markers cannot be copied as a recipient',
    version: 2,
    vout: [
      { addresses: ['script-mislabeled-as-address'], hex: '6a00', value: '0' },
      { addresses: ['OP_RETURN hidden'], value: '0' },
      { addresses: ['non-address-script'], isAddress: false, value: '0' },
    ],
    expected: 'settings.unavailable',
  },
])(
  'shows proven receiving outputs for $name',
  async ({ version, tokenType, vout, expected }) => {
    const transaction = rawTransaction({
      version,
      tokenType,
      vin: [],
      vout: vout as any,
    });
    await mountHydratedDetails(transaction);

    const canCopy =
      expected !== 'settings.unavailable' && expected.length >= 20;
    const displayed = canCopy
      ? jest.requireActual('utils/format').ellipsis(expected, 2, 4)
      : expected;
    const row = () => screen.getByText('To').parentElement!;
    await waitFor(() => expect(row().textContent).toBe(`To${displayed}`));
    expect(row().querySelector('button') !== null).toBe(canCopy);
    if (canCopy) {
      const button = row().querySelector('button')!;
      expect(button.isConnected).toBe(true);
      fireEvent.click(button);
      expect(mockCopy).toHaveBeenCalledTimes(1);
      expect(mockCopy).toHaveBeenCalledWith(expected);
    }
  }
);

it.each([
  ['mint', '1', undefined, true],
  ['send', '0.1 PQAS', undefined, true],
  ['send', '0.1 Multi Word Token', undefined, true],
  ['send', '.1 PQAS', undefined, true],
  ['send', `0.${'0'.repeat(400)}1 PQAS`, undefined, true],
  ['send', '0.0000 PQAS', undefined, false],
  ['send', '0 PQAS1', undefined, false],
  ['send', '0 Multi Word Token 1', undefined, false],
  ['send', '-0.1 PQAS', undefined, false],
  ['send', '1junk PQAS', undefined, false],
  ['send', 'Infinity PQAS', undefined, false],
  ['send', 'NaN PQAS', undefined, false],
  ['send', '1e3 PQAS', undefined, false],
  ['send', '1 PQAS', '0', false],
  ['send', '1 PQAS', 'malformed', false],
  ['send', '1 PQAS', null, false],
  ['send', '0 PQAS', '1', true],
])(
  'supports valueStr-only %s credit %s with raw %s without overriding raw precedence',
  async (kind, valueStr, value, positive) => {
    const transaction = rawTransaction({
      version: kind === 'mint' ? 140 : 142,
      tokenType:
        kind === 'mint' ? 'SPTAssetAllocationMint' : 'SPTAssetAllocationSend',
      vout: [
        { addresses: ['OP_RETURN proof'], value: '0' },
        {
          addresses: ['asset-recipient'],
          value: '294',
          assetInfo: { assetGuid: '12', value, valueStr },
        },
      ] as any,
    });
    mockEmitter.mockResolvedValue(transaction);
    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    const expected = positive ? 'asset-recipient' : 'settings.unavailable';
    await waitFor(() =>
      expect(screen.getByText('To').parentElement!.textContent).toBe(
        `To${expected}`
      )
    );
  }
);

it('shows the canonical SYSX icon beside its amount without importing the token', async () => {
  const transaction = tokenTransaction();
  const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
  mockEmitter.mockResolvedValue(transaction);
  expect(selectActiveAccountAssets(mockState).syscoin).toEqual([]);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  const icon = await expectAmountIcon('1.0000 SYSX', officialLogo);
  const decoration = icon.parentElement!;
  expect(decoration.getAttribute('aria-hidden')).toBe('true');
  expect(decoration.classList.contains('group')).toBe(true);
  expect(decoration.classList.contains('cursor-default')).toBe(true);
  expect(decoration.hasAttribute('tabindex')).toBe(false);
  expect(decoration.hasAttribute('role')).toBe(false);
  expect(decoration.querySelector('button, a, [tabindex]')).toBeNull();
  expect(icon.classList.contains('group-hover:shadow-xl')).toBe(true);
  expect(icon.classList.contains('motion-safe:group-hover:scale-110')).toBe(
    true
  );
  expect(icon.classList.contains('motion-reduce:transition-none')).toBe(true);
  const shine = decoration.querySelector('span')!;
  expect(shine.classList.contains('pointer-events-none')).toBe(true);
  expect(shine.classList.contains('group-hover:opacity-100')).toBe(true);
  expect(shine.classList.contains('motion-reduce:transition-none')).toBe(true);
  expect(mockIconFetch).toHaveBeenCalledWith(officialLogo);
});

it.each(['syscoinburntoallocation', 'SPTSyscoinBurnToAssetAllocation'])(
  'shows the canonical native-burn icon for %s without assetInfo or tokenTransfers',
  async (tokenType) => {
    const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
    const transaction = rawTransaction({
      tokenType,
      fees: '226',
      addressValueIn: '300000226',
      addressValueOut: '100000000',
      valueIn: '300000226',
      value: '300000000',
      vin: [{ addresses: ['raw-from'], value: '300000226' }] as any,
      vout: [
        { addresses: ['raw-change'], value: '100000000' },
        { addresses: ['OP_RETURN'], value: '200000000' },
      ] as any,
    });
    mockEmitter.mockResolvedValue(transaction);
    expect(selectActiveAccountAssets(mockState).syscoin).toEqual([]);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await expectAmountIcon('2.0000 SYSX', officialLogo);
    expect(mockIconFetch.mock.calls.map(([url]) => url)).toEqual([
      officialLogo,
    ]);
    expect(screen.queryByText('1.0000 SYSX')).toBeNull();
    expect(
      screen.getByText('send.nativeBalanceChange: -2.00000226 SYS')
    ).toBeTruthy();
    expect(detailValue('Fees', '0.00000226 SYS')).toBeTruthy();
  }
);

it('uses a custom logo only from the active account and exact GUID on the active chain', async () => {
  const logo = 'https://icons.example/exact-active-token.png';
  setAccountAssets([
    { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: logo },
    {
      assetGuid: '900002',
      chainId: 57,
      symbol: 'CUSTOM',
      image: 'https://icons.example/same-symbol-other-guid.png',
    },
  ]);
  setAccountAssets(
    [
      {
        assetGuid: '900001',
        chainId: 57,
        symbol: 'CUSTOM',
        image: 'https://icons.example/other-account.png',
      },
    ],
    1
  );
  const transaction = tokenTransaction('900001', 'CUSTOM');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await expectAmountIcon('1.0000 CUSTOM', logo);
  expect(mockIconFetch.mock.calls.map(([url]) => url)).toEqual([logo]);
});

it('does not let an earlier unscoped or wrong-chain entry shadow the exact-chain logo', async () => {
  const logo = 'https://icons.example/exact-chain-after-legacy.png';
  setAccountAssets([
    {
      assetGuid: '900001',
      symbol: 'CUSTOM',
      image: 'https://icons.example/unscoped-legacy.png',
    },
    {
      assetGuid: '900001',
      chainId: 5700,
      symbol: 'CUSTOM',
      image: 'https://icons.example/wrong-chain-before-exact.png',
    },
    { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: logo },
  ]);
  const transaction = tokenTransaction('900001', 'CUSTOM');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await expectAmountIcon('1.0000 CUSTOM', logo);
  expect(mockIconFetch.mock.calls.map(([url]) => url)).toEqual([logo]);
});

it.each([undefined, 5700])(
  'keeps the normal unknown-token fallback when a custom logo has chainId %s',
  async (chainId) => {
    const logo = 'https://icons.example/not-exact-chain.png';
    setAccountAssets([
      { assetGuid: '900001', chainId, symbol: 'CUSTOM', image: logo },
    ]);
    const transaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await waitFor(() => {
      const icon = screen.getByAltText('CUSTOM');
      expect(icon.getAttribute('src')).toBe(
        getTokenLogo('CUSTOM', true, '900001')
      );
      expect(
        screen.getByText('1.0000 CUSTOM').parentElement!.contains(icon)
      ).toBe(true);
    });
    expect(mockIconFetch).not.toHaveBeenCalled();
  }
);

it.each(['wrong-chain', 'other-account', 'same-symbol-other-guid'])(
  'does not borrow a custom logo from a %s imported asset',
  async (mismatch) => {
    const logo = `https://icons.example/rejected-${mismatch}.png`;
    setAccountAssets(
      [
        {
          assetGuid:
            mismatch === 'same-symbol-other-guid' ? '900002' : '900001',
          chainId: mismatch === 'wrong-chain' ? 5700 : 57,
          symbol: 'CUSTOM',
          image: logo,
        },
      ],
      mismatch === 'other-account' ? 1 : 0
    );
    const transaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await screen.findByText('1.0000 CUSTOM');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockIconFetch).not.toHaveBeenCalledWith(logo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === logo)
    ).toBe(false);
  }
);

it.each([false, true])(
  'never awards an official SYSX logo to a symbol-only impostor (wrong-chain import: %s)',
  async (wrongChain) => {
    const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
    setAccountAssets([
      {
        assetGuid: '900003',
        chainId: wrongChain ? 5700 : 57,
        symbol: 'SYSX',
        image: officialLogo,
      },
    ]);
    const transaction = tokenTransaction('900003');
    mockEmitter.mockResolvedValue(transaction);

    render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

    await screen.findByText('1.0000 SYSX');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockIconFetch).not.toHaveBeenCalledWith(officialLogo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === officialLogo)
    ).toBe(false);
  }
);

it('does not infer the canonical GUID from a SYSX symbol or matching imported symbol', async () => {
  const officialLogo = getKnownTokenLogo(undefined, undefined, '123456')!;
  setAccountAssets([
    { assetGuid: '123456', chainId: 57, symbol: 'SYSX', image: officialLogo },
  ]);
  const transaction = tokenTransaction('');
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await screen.findByText('1.0000 SYSX');
  await act(async () => {
    await Promise.resolve();
  });
  expect(mockIconFetch).not.toHaveBeenCalledWith(officialLogo);
  expect(
    screen
      .queryAllByRole('img', { hidden: true })
      .some((img) => img.getAttribute('src') === officialLogo)
  ).toBe(false);
});

it('keeps native transaction amounts free of a token icon', async () => {
  const transaction = rawTransaction({
    addressValueIn: '900001000',
    addressValueOut: '0',
    direction: 'sent',
  });
  mockEmitter.mockResolvedValue(transaction);

  render(<SyscoinTransactionDetails hash={mockHash} tx={transaction} />);

  await screen.findByText('raw-from');
  expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  expect(mockIconFetch).not.toHaveBeenCalled();
});

it('adds the canonical icon only after a compact transaction hydrates its GUID', async () => {
  const full = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(full.promise);
  const summary = rawTransaction({
    ...compactBridgeNativeOffset,
    txid: mockHash,
    vin: [],
    vout: [],
  });
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  expect(mockIconFetch).not.toHaveBeenCalled();

  await act(async () => {
    full.resolve(
      rawTransaction({
        tokenType: 'SPTAssetAllocationBurnToNEVM',
        tokenTransfers: [
          { token: '123456', symbol: 'SYSX', decimals: 8 },
        ] as any,
        vout: [
          {
            addresses: ['OP_RETURN'],
            value: '0',
            assetInfo: { assetGuid: '123456', value: '100000000' },
          },
        ] as any,
      })
    );
  });

  await expectAmountIcon(
    '1.0000 SYSX',
    getKnownTokenLogo(undefined, undefined, '123456')!
  );
});

it.each(['account', 'network', 'asset-guid', 'hash'])(
  'drops the previous token icon immediately when the %s identity changes',
  async (identity) => {
    const oldLogo = `https://icons.example/${identity}-old.png`;
    const nextLogo = `https://icons.example/${identity}-current.png`;
    const currentImage = deferred<any>();
    setAccountAssets([
      { assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: oldLogo },
      { assetGuid: '900002', chainId: 57, symbol: 'CUSTOM', image: nextLogo },
      { assetGuid: '900001', chainId: 5700, symbol: 'CUSTOM', image: nextLogo },
    ]);
    setAccountAssets(
      [{ assetGuid: '900001', chainId: 57, symbol: 'CUSTOM', image: nextLogo }],
      1
    );
    const oldTransaction = tokenTransaction('900001', 'CUSTOM');
    mockEmitter.mockResolvedValue(oldTransaction);
    const view = render(
      <SyscoinTransactionDetails hash={mockHash} tx={oldTransaction} />
    );
    await expectAmountIcon('1.0000 CUSTOM', oldLogo);
    mockIconFetch.mockImplementation((url) => {
      if (url === nextLogo) return currentImage.promise;
      throw new Error(`Unexpected icon fixture: ${url}`);
    });
    const nextHash = identity === 'hash' ? 'd'.repeat(64) : mockHash;
    const nextGuid = ['asset-guid', 'hash'].includes(identity)
      ? '900002'
      : '900001';
    const nextTransaction = {
      ...tokenTransaction(nextGuid, 'CUSTOM'),
      txid: nextHash,
    };
    mockState = {
      ...mockState,
      scope: {
        ...mockState.scope,
        ...(identity === 'account' ? { account: 'account-b' } : {}),
        ...(identity === 'network' ? { network: 'network-b' } : {}),
      },
      vault: {
        ...mockState.vault,
        activeAccount: {
          type: 'HDAccount',
          id: identity === 'account' ? 1 : 0,
        },
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(identity === 'network'
            ? { chainId: 5700, url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    mockEmitter.mockResolvedValue(nextTransaction);
    view.rerender(
      <SyscoinTransactionDetails hash={nextHash} tx={nextTransaction} />
    );

    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === oldLogo)
    ).toBe(false);
    await waitFor(() => expect(mockIconFetch).toHaveBeenCalledWith(nextLogo));
    await act(async () => {
      currentImage.resolve({
        ok: true,
        blob: async () => ({ size: 256 * 1024 + 1 }),
      });
    });
    await expectAmountIcon('1.0000 CUSTOM', nextLogo);
    expect(
      screen
        .queryAllByRole('img', { hidden: true })
        .some((img) => img.getAttribute('src') === oldLogo)
    ).toBe(false);
  }
);

it.each(['account', 'network', 'hash'])(
  'does not restore a stale icon from an old full-read reply after a %s switch',
  async (identity) => {
    const old = deferred<ISysTransaction>();
    const current = deferred<ISysTransaction>();
    mockEmitter
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const view = render(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    const nextHash = identity === 'hash' ? 'e'.repeat(64) : mockHash;
    mockState = {
      ...mockState,
      scope: {
        ...mockState.scope,
        ...(identity === 'account' ? { account: 'account-b' } : {}),
        ...(identity === 'network' ? { network: 'network-b' } : {}),
      },
      vault: {
        ...mockState.vault,
        activeAccount: {
          type: 'HDAccount',
          id: identity === 'account' ? 1 : 0,
        },
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(identity === 'network'
            ? { chainId: 5700, url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    view.rerender(<SyscoinTransactionDetails hash={nextHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    await act(async () => {
      current.resolve({ ...rawTransaction(), txid: nextHash });
    });
    await screen.findByText('raw-from');
    await act(async () => {
      old.resolve(tokenTransaction());
    });

    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
    expect(mockIconFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('1.0000 SYSX')).toBeNull();
  }
);

it('restores hash-only details from a full Blockbook read without inventing an account amount', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  render(<SyscoinTransactionDetails hash={mockHash} tx={undefined} />);

  expect(await screen.findByText('raw-from')).toBeTruthy();
  expect(screen.getByText('raw-to')).toBeTruthy();
  expect(screen.getAllByText('send.pending')).toHaveLength(3);
  expect(confirmationValue().textContent).toBe('0');
  expect(screen.queryByText('9 SYS')).toBeNull();
  expect(
    screen.queryByText('transactions.transactionNotFoundOrPending')
  ).toBeNull();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSysTransactionFromBlockbook'],
    [mockHash, 'https://blockbook.example']
  );
});

it('restores the same hash-only detail from raw cache without another controller read', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('raw-from');
  first.unmount();

  render(<SyscoinTransactionDetails hash={mockHash.toUpperCase()} />);
  expect(await screen.findByText('raw-to')).toBeTruthy();
  expect(screen.getAllByText('send.pending')).toHaveLength(3);
  expect(screen.queryByText('9 SYS')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each(['null', 'rejected', 'wrong-hash'])(
  'keeps a hash-only %s read graceful without rendering unrelated transaction data',
  async (result) => {
    const errorLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      if (result === 'rejected')
        mockEmitter.mockRejectedValue(
          new Error('Public Blockbook read failed')
        );
      else
        mockEmitter.mockResolvedValue(
          result === 'null' ? null : rawTransaction({ txid: 'f'.repeat(64) })
        );
      render(<SyscoinTransactionDetails hash={mockHash} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByText('transactions.transactionNotFoundOrPending')
      ).toBeTruthy();
      expect(
        screen.getByText('transactions.transactionMayNotExistYet')
      ).toBeTruthy();
      expect(screen.queryByText('raw-from')).toBeNull();
      expect(screen.queryByText('send.pending')).toBeNull();
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(result === 'rejected' ? 1 : 0);
    } finally {
      errorLog.mockRestore();
    }
  }
);

it('uses a new pending summary over an older confirmed cached body without leaking block fields', async () => {
  mockEmitter.mockResolvedValue(
    rawTransaction({
      confirmations: 6,
      blockHeight: 123,
      blockHash: 'old-confirmed-block',
      blockTime: 123456,
    })
  );
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('old-confirmed-block');
  first.unmount();
  const summary = rawTransaction({
    confirmations: 0,
    blockHeight: null,
    blockHash: null,
    blockTime: null,
  });
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  await screen.findByText('raw-from');
  expect(confirmationValue().textContent).toBe('0');
  expect(screen.queryByText('old-confirmed-block')).toBeNull();
  expect(detailValue('Block Hash', 'send.pending')).toBeTruthy();
  expect(detailValue('Block Time', 'send.pending')).toBeTruthy();
  expect(screen.queryByText('send.confirmed')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('uses a same-height replacement block from a current summary over the cached block', async () => {
  const cached = rawTransaction({
    confirmations: 6,
    blockHeight: 123,
    blockHash: 'old-block',
  });
  mockEmitter.mockResolvedValue(cached);
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('old-block');
  first.unmount();
  render(
    <SyscoinTransactionDetails
      hash={mockHash}
      tx={{ ...cached, blockHash: 'new-block' }}
    />
  );
  expect(await screen.findByText('new-block')).toBeTruthy();
  expect(screen.queryByText('old-block')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('uses a newly fetched body until a later summary observation demotes it', async () => {
  const response = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(response.promise);
  const summary = rawTransaction();
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={summary} />
  );
  await act(async () =>
    response.resolve(
      rawTransaction({
        confirmations: 6,
        blockHeight: 123,
        blockHash: 'fresh-block',
      })
    )
  );
  expect(await screen.findByText('fresh-block')).toBeTruthy();
  expect(confirmationValue().textContent).toBe('6');
  view.rerender(
    <SyscoinTransactionDetails hash={mockHash} tx={{ ...summary }} />
  );
  expect(confirmationValue().textContent).toBe('0');
  expect(screen.queryByText('fresh-block')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('uses current summary confirmation and separate native change over pending raw cached metadata', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const first = render(<SyscoinTransactionDetails hash={mockHash} />);
  await screen.findByText('raw-from');
  first.unmount();

  const summary = rawTransaction({
    confirmations: 7,
    blockHeight: 123,
    blockHash: 'current-block',
    blockTime: 123456,
    direction: 'sent',
    addressValueIn: '1000000000',
    addressValueOut: '800000000',
  });
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={summary} />
  );
  expect(
    await screen.findByText('send.nativeBalanceChange: -2 SYS')
  ).toBeTruthy();
  expect(screen.queryByText('2 SYS')).toBeNull();
  expect(screen.getByText('send.confirmed')).toBeTruthy();
  expect(screen.queryByText('send.pending')).toBeNull();
  expect(confirmationValue().textContent).toBe('7');
  expect(screen.getByText('current-block')).toBeTruthy();
  expect(mockEmitter).toHaveBeenCalledTimes(1);

  view.rerender(
    <SyscoinTransactionDetails
      hash={mockHash}
      tx={{
        ...summary,
        confirmations: 8,
        addressValueOut: '700000000',
      }}
    />
  );
  expect(screen.getByText('send.nativeBalanceChange: -3 SYS')).toBeTruthy();
  expect(screen.queryByText('2 SYS')).toBeNull();
  expect(confirmationValue().textContent).toBe('8');
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'formats fee units and pending block fields, omitted REST fields: %s',
  async (omitted) => {
    mockState.vault.activeNetwork.currency = 'tsys';
    const pendingRow = rawTransaction({
      fees: '226',
      blockHash: undefined,
      blockTime: omitted ? undefined : 1791600000,
      addressValueIn: '100000226',
      addressValueOut: '100000000',
    });
    const pending = omitted
      ? JSON.parse(JSON.stringify(pendingRow))
      : pendingRow;
    mockEmitter.mockResolvedValue(pending);
    render(<SyscoinTransactionDetails hash={mockHash} tx={pending} />);

    await screen.findByText('raw-from');
    expect(detailValue('Fees', '0.00000226 TSYS')).toBeTruthy();
    expect(screen.getByText('send.transactionValue')).toBeTruthy();
    expect(detailValue('Block Hash', 'send.pending')).toBeTruthy();
    expect(detailValue('Block Time', 'send.pending')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
    expect(screen.queryByText('1791600000')).toBeNull();
  }
);

it('formats a confirmed block time using the selected language', async () => {
  const blockTime = 1791600000;
  const confirmed = rawTransaction({
    blockHeight: 1,
    confirmations: 1,
    blockHash: 'confirmed-block',
    blockTime,
  });
  mockEmitter.mockResolvedValue(confirmed);
  render(<SyscoinTransactionDetails hash={mockHash} tx={confirmed} />);
  await screen.findByText('raw-from');
  expect(detailValue('Block Hash', 'confirmed-block')).toBeTruthy();
  expect(
    detailValue('Block Time', new Date(blockTime * 1000).toLocaleString('en'))
  ).toBeTruthy();
  expect(screen.queryByText(String(blockTime))).toBeNull();
});

it('hydrates a native self-send output value while keeping its small native change secondary', async () => {
  const full = deferred<ISysTransaction>();
  mockEmitter.mockReturnValue(full.promise);
  const summary = rawTransaction({
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    vin: [],
    vout: [],
    fees: '226',
  });
  render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  expect(
    within(
      screen.getByText('send.transactionValue').parentElement!
    ).queryByText('0.00000226 SYS')
  ).toBeNull();
  await act(async () =>
    full.resolve(
      rawTransaction({
        fees: '226',
        vin: [{ addresses: ['raw-from'], value: '100000226' }] as any,
        vout: [{ addresses: ['raw-to'], value: '100000000' }] as any,
      })
    )
  );
  expect(await screen.findByText('raw-from')).toBeTruthy();
  expect(screen.getByText('1 SYS')).toBeTruthy();
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  expect(screen.queryByText('9 SYS')).toBeNull();
});

it('waits for account totals instead of inferring an amount from a full output', async () => {
  mockEmitter.mockResolvedValue(rawTransaction());
  const minimal = rawTransaction({ vin: [], vout: [] });
  const view = render(
    <SyscoinTransactionDetails hash={mockHash} tx={minimal} />
  );
  expect(
    within(screen.getByText('send.transactionValue').parentElement!).getByText(
      'settings.unavailable'
    )
  ).toBeTruthy();
  await screen.findByText('raw-from');
  expect(
    within(screen.getByText('send.transactionValue').parentElement!).getByText(
      'settings.unavailable'
    )
  ).toBeTruthy();
  expect(screen.queryByText('9 SYS')).toBeNull();

  view.rerender(
    <SyscoinTransactionDetails
      hash={mockHash}
      tx={{
        ...minimal,
        addressValueIn: '100000000',
        addressValueOut: '100000000',
      }}
    />
  );
  expect(screen.getByText('send.nativeBalanceChange: 0 SYS')).toBeTruthy();
  expect(screen.getByText('settings.unavailable')).toBeTruthy();
  expect(screen.queryByText('0 SYS')).toBeNull();
});

it('labels multiple all-self native outputs as a total in Details', async () => {
  const tx = rawTransaction({
    fees: '226',
    addressValueIn: '100000226',
    addressValueOut: '100000000',
    vin: [{ addresses: ['raw-from'], value: '100000226' }] as any,
    vout: [
      { addresses: ['raw-to'], value: '20000000' },
      { addresses: ['raw-change'], value: '80000000' },
    ] as any,
  });
  mockEmitter.mockResolvedValueOnce(tx);
  render(<SyscoinTransactionDetails hash={mockHash} tx={tx} />);
  expect(screen.getByText('send.selfTransferOutputTotal')).toBeTruthy();
  expect(screen.getByText('1 SYS')).toBeTruthy();
  expect(
    screen.getByText('send.nativeBalanceChange: -0.00000226 SYS')
  ).toBeTruthy();
  await screen.findByText('raw-from');
});

it.each([
  [compactBridgeNativeOffset, '1.0000 SYSX'],
  [compactBridgeWithAccountAsset, '0.100000 SYSX'],
])(
  'shows actual compact bridge operation value after full transaction hydration',
  async (compact, amount) => {
    const summary = rawTransaction({
      ...compact,
      txid: mockHash,
      vin: [],
      vout: [],
    });
    const full = deferred<ISysTransaction>();
    mockEmitter.mockReturnValue(full.promise);
    render(<SyscoinTransactionDetails hash={mockHash} tx={summary} />);
    expect(screen.getAllByText('settings.unavailable').length).toBeGreaterThan(
      0
    );
    await act(async () =>
      full.resolve(
        rawTransaction({
          blockHeight: 1,
          confirmations: 1,
          tokenType: 'SPTAssetAllocationBurnToNEVM',
          vout: [
            {
              addresses: ['OP_RETURN'],
              value: '0',
              assetInfo: {
                assetGuid: '123456',
                value:
                  compact === compactBridgeNativeOffset
                    ? '100000000'
                    : '10000000',
              },
            },
          ] as any,
          tokenTransfers: [
            { token: '123456', symbol: 'SYSX', decimals: 8 },
          ] as any,
        })
      )
    );
    expect(await screen.findByText('raw-from')).toBeTruthy();
    expect(screen.getByText(amount)).toBeTruthy();
    expect(screen.getByText('send.transactionValue')).toBeTruthy();
    expect(
      screen.getByText(new RegExp('send.nativeBalanceChange'))
    ).toBeTruthy();
    expect(screen.getAllByText('Bridge to NEVM').length).toBeGreaterThan(0);
  }
);

it.each(
  ['account', 'network'].flatMap((scope) =>
    ['old-first', 'current-first'].map((order) => ({ scope, order }))
  )
)(
  'rejects an old $scope reply with $order completion order',
  async ({ scope, order }) => {
    const old = deferred<ISysTransaction>();
    const current = deferred<ISysTransaction>();
    mockEmitter
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const view = render(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    mockState = {
      ...mockState,
      scope: { ...mockState.scope, [scope]: `${scope}-b` },
      vault: {
        ...mockState.vault,
        activeNetwork: {
          ...mockState.vault.activeNetwork,
          ...(scope === 'network'
            ? { url: 'https://other-blockbook.example' }
            : {}),
        },
      },
    };
    view.rerender(<SyscoinTransactionDetails hash={mockHash} />);
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(2));
    const finishOld = async () => {
      await act(async () => {
        old.resolve(
          rawTransaction({
            vin: [{ addresses: ['stale-from'], value: '1' }] as any,
          })
        );
      });
      expect(screen.queryByText('stale-from')).toBeNull();
    };
    const finishCurrent = async () => {
      await act(async () => {
        current.resolve(
          rawTransaction({
            vin: [{ addresses: ['current-from'], value: '1' }] as any,
          })
        );
      });
      expect(await screen.findByText('current-from')).toBeTruthy();
    };
    if (order === 'old-first') {
      await finishOld();
      await finishCurrent();
    } else {
      await finishCurrent();
      await finishOld();
    }
    expect(screen.getByText('current-from')).toBeTruthy();
    expect(screen.queryByText('stale-from')).toBeNull();
  }
);
