/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { decodeSmartAccountOperations } from '../../../../../../wallet/smartAccountActivity';
import { defaultAbiCoder, id } from 'utils/ethersV6Compat';
import { encodeERC7579Executions } from 'utils/smartAccount/account';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';

import { EvmTransactionsList } from './EvmList';
import { savedTransactionHistoryRow } from './useSavedEvmTransactions';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const CONTRACT = `0x${'33'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(32)}`;
const mockAlert = { success: jest.fn(), warning: jest.fn(), error: jest.fn() };
const mockVault = {
  activeAccount: { id: 0, type: 'HDAccount' },
  accounts: { HDAccount: { 0: { address: ACCOUNT } } },
  accountAssets: { HDAccount: { 0: { ethereum: [] } } },
  activeNetwork: { chainId: 1, currency: 'eth' },
};
let mockRows: any[] = [];
let mockAccountAddress = ACCOUNT;
let mockFiatAvailable = true;
let mockFiatText = '0 USD';
const mockGetFiatAmount = () => mockFiatText;
beforeEach(() => {
  mockFiatAvailable = true;
  mockFiatText = '0 USD';
  mockAccountAddress = ACCOUNT;
  mockVault.accountAssets.HDAccount[0].ethereum = [];
});
const mockEnsCache = {
  [TARGET]: { name: 'first.eth' },
  [ACCOUNT]: { name: 'updated.eth' },
};
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => ({ vault: mockVault }) },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({ vault: mockVault, vaultGlobal: { ensCache: mockEnsCache } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: mockAccountAddress }),
  selectActiveAccountRef: () => mockVault.activeAccount,
  selectActiveAccountAssets: () => ({ ethereum: [] }),
  selectActiveAccountTransactions: () => ({ ethereum: { 1: mockRows } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
  }),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ state: null }) }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: jest.fn() }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({
    getFiatAmount: mockGetFiatAmount,
    isFiatAvailable: mockFiatAvailable,
  }),
}));
jest.mock('../../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: () => 'amount-test',
}));
jest.mock('../utils/useTransactionsInfos', () => ({
  useTransactionsListConfig: () => ({
    filteredTransactions: mockRows,
    formatTimeStamp: () => 'Today',
    getTxStatusIcons: () => null,
    getTxType: () => 'Sent',
    txId: 'hash',
  }),
}));
jest.mock('../useHistoryBrowsingState', () => ({
  useHistoryBrowsingState: () => ({
    extraTransactions: [],
    visibleCount: 50,
    nextPage: 2,
    hasMoreServer: false,
    isRestoringPages: false,
    setExtraTransactions: jest.fn(),
    setVisibleCount: jest.fn(),
    setNextPage: jest.fn(),
    setHasMoreServer: jest.fn(),
  }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('components/Icon/Icon', () => ({ DetailArrowSvg: () => null }));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: () => null,
}));
jest.mock('utils/index', () => ({ getKnownTokenLogo: () => undefined }));

const erc1155Input = (tokenId: string, amount: string) =>
  id('safeTransferFrom(address,address,uint256,uint256,bytes)').slice(0, 10) +
  defaultAbiCoder
    .encode(
      ['address', 'address', 'uint256', 'uint256', 'bytes'],
      [ACCOUNT, TARGET, tokenId, amount, '0x']
    )
    .slice(2);
const erc721Input = (tokenId: string) =>
  id('safeTransferFrom(address,address,uint256)').slice(0, 10) +
  defaultAbiCoder
    .encode(['address', 'address', 'uint256'], [ACCOUNT, TARGET, tokenId])
    .slice(2);
const show = (input: string, hashDigit = 'a') => {
  mockRows = [
    {
      hash: `0x${hashDigit.repeat(64)}`,
      from: ACCOUNT,
      to: CONTRACT,
      value: '0',
      input,
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
};

it.each(['0', '2'])(
  'shows ERC1155 quantity separately from token ID %s',
  async (tokenId) => {
    show(erc1155Input(tokenId, '2'));
    expect(await screen.findByText(`2 NFT #${tokenId}`)).toBeTruthy();
  }
);

it('preserves the exact ERC1155 quantity beyond Number precision', async () => {
  show(erc1155Input('5', '9007199254740993'), 'b');
  expect(await screen.findByText('9007199254740993 NFT #5')).toBeTruthy();
});

it('keeps an unknown ERC20 transferFrom generic instead of displaying its amount as an NFT id', async () => {
  show(
    id('transferFrom(address,address,uint256)').slice(0, 10) +
      defaultAbiCoder
        .encode(['address', 'address', 'uint256'], [ACCOUNT, TARGET, '1000000'])
        .slice(2),
    '8'
  );
  expect(await screen.findByText('0x3333...3333 Transfer')).toBeTruthy();
  expect(screen.queryByText('NFT #1000000')).toBeNull();
});

it.each(['1', '5'])(
  'shows ERC721 token ID %s without a quantity prefix',
  async (tokenId) => {
    show(erc721Input(tokenId), 'c');
    expect(await screen.findByText(`NFT #${tokenId}`)).toBeTruthy();
    expect(screen.queryByText(`1 NFT #${tokenId}`)).toBeNull();
  }
);

const tokenEvent = (tokenTransfer: any, hashDigit = 'd') => ({
  hash: `0x${hashDigit.repeat(64)}`,
  from: ACCOUNT,
  to: CONTRACT,
  value: '0',
  input: '0x',
  chainId: 1,
  timestamp: 1791655200,
  blockNumber: 42,
  confirmations: 1,
  historySource: 'explorer-tokentx',
  tokenTransfer: {
    chainId: 1,
    contractAddress: CONTRACT,
    recipient: TARGET,
    ...tokenTransfer,
  },
});

it('shows an event-only ERC1155 quantity without rounding it or mistaking it for the token id', async () => {
  mockRows = [
    tokenEvent({
      tokenStandard: 'ERC-1155',
      tokenId: '0',
      value: '9007199254740993',
      symbol: 'ART',
    }),
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('9007199254740993 ART #0')).toBeTruthy();
});

it('keeps an event-only ERC721 label free of a quantity prefix', async () => {
  mockRows = [
    tokenEvent({ tokenStandard: 'ERC-721', tokenId: '1', symbol: 'ART' }, 'e'),
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('ART #1')).toBeTruthy();
  expect(screen.queryByText('1 ART #1')).toBeNull();
});

it('refreshes cached event amounts and recipients when only the event payload changes', async () => {
  mockRows = [
    tokenEvent({ decimals: '6', value: '1000000', symbol: 'OLD' }, 'f'),
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('1.0 OLD')).toBeTruthy();
  expect(screen.getByText('first.eth', { exact: false })).toBeTruthy();
  mockRows = [
    tokenEvent(
      { decimals: '6', value: '2000000', symbol: 'NEW', recipient: ACCOUNT },
      'f'
    ),
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('2.0 NEW')).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByText('first.eth', { exact: false })).toBeNull()
  );
  expect(screen.getByText('updated.eth', { exact: false })).toBeTruthy();
});

it('refreshes a legacy token row when explicit event metadata arrives', async () => {
  const enriched = tokenEvent(
    { decimals: '6', value: '1000000', symbol: 'USDC' },
    '9'
  );
  mockRows = [
    { ...enriched, tokenRecipient: TARGET, tokenTransfer: undefined },
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('0x3333...3333 Transfer')).toBeTruthy();
  mockRows = [enriched];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('1.0 USDC')).toBeTruthy();
});

it('updates only native fiat when quote availability changes without replacing the transaction row', async () => {
  mockFiatAvailable = false;
  mockRows = [
    {
      hash: '0x' + '7'.repeat(64),
      from: ACCOUNT,
      to: TARGET,
      value: '2000000000000000000',
      input: '0x',
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  await waitFor(() =>
    expect(view.container.textContent).toMatch(/2(?:\.0+)? ETH/)
  );
  expect(screen.getByText('---')).toBeTruthy();
  expect(screen.queryByText('0 USD')).toBeNull();
  const nativeText = view.container.textContent!.match(/2(?:\.0+)? ETH/)![0];
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('0 USD')).toBeTruthy();
  mockFiatText = '4 USD';
  mockFiatAvailable = false;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  await screen.findByText('---');
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('4 USD')).toBeTruthy();
  mockFiatText = '-4 USD';
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  // Keep the formatter reference stable: availability must itself invalidate memoization.
  mockFiatAvailable = false;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('---')).toBeTruthy();
  mockFiatAvailable = true;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('-4 USD')).toBeTruthy();
  expect(view.container.textContent).toContain(nativeText);
  expect(mockRows[0].value).toBe('2000000000000000000');
});

const showNative = (value: unknown) => {
  mockRows = [
    {
      hash: '0x' + 'f'.repeat(64),
      from: ACCOUNT,
      to: TARGET,
      value,
      input: '0x',
      nonce: 1,
      chainId: 1,
      timestamp: 1791655200,
      blockNumber: 42,
      confirmations: 1,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
};
it('renders one wei as the exact primary amount', async () => {
  showNative('1');
  expect(await screen.findByText('0.000000000000000001 ETH')).toBeTruthy();
});
it('renders a native amount beyond Number precision exactly', async () => {
  showNative('9007199254740993000000000000000001');
  expect(
    await screen.findByText('9007199254740993.000000000000000001 ETH')
  ).toBeTruthy();
});
it.each([undefined, 'invalid', Number.MAX_SAFE_INTEGER + 1])(
  'shows unavailable instead of zero for native input %#',
  async (value) => {
    showNative(value);
    expect(await screen.findByText('? ETH')).toBeTruthy();
    expect(screen.queryByText('0 ETH')).toBeNull();
  }
);
it('keeps valid native zero available', async () => {
  showNative('0');
  expect(await screen.findByText('0 ETH')).toBeTruthy();
});

it('renders a known ERC20 integer beyond Number precision exactly', async () => {
  mockVault.accountAssets.HDAccount[0].ethereum = [
    {
      chainId: 1,
      contractAddress: CONTRACT,
      tokenSymbol: 'EXACT',
      decimals: 0,
    } as never,
  ];
  show(
    id('transfer(address,uint256)').slice(0, 10) +
      defaultAbiCoder
        .encode(['address', 'uint256'], [TARGET, '9007199254740993'])
        .slice(2),
    'e'
  );
  expect(await screen.findByText('9007199254740993 EXACT')).toBeTruthy();
});

it('renders a retained signed token transfer with saved metadata instead of 0 native', async () => {
  mockRows = [
    {
      ...tokenEvent({ decimals: 6, value: '6000000', symbol: 'TST' }),
      historySource: 'local-signed',
      input: undefined,
      dataBytes: 68,
      blockNumber: undefined,
      confirmations: 0,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('6.0 TST')).toBeTruthy();
  expect(screen.queryByText('0 ETH')).toBeNull();
  expect(screen.getByText('send.sent')).toBeTruthy();
});

it('does not report a native amount when a retained token has unknown metadata', async () => {
  mockRows = [
    {
      ...tokenEvent({ value: '6000000' }),
      historySource: 'local-signed',
      input: undefined,
      dataBytes: 68,
      blockNumber: undefined,
      confirmations: 0,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('? 0x3333...3333')).toBeTruthy();
  expect(screen.queryByText('0 ETH')).toBeNull();
  expect(screen.queryByText('6000000 ETH')).toBeNull();
});

it('renders an SDK data-only submitted ERC-20 row with imported metadata instead of 0 native', async () => {
  mockVault.accountAssets.HDAccount[0].ethereum = [
    { chainId: 1, contractAddress: CONTRACT, decimals: 6, tokenSymbol: 'TST' },
  ] as any;
  const data =
    id('transfer(address,uint256)').slice(0, 10) +
    defaultAbiCoder
      .encode(['address', 'uint256'], [TARGET, '6000000'])
      .slice(2);
  mockRows = [
    {
      hash: `0x${'a'.repeat(64)}`,
      chainId: 1,
      from: ACCOUNT,
      to: CONTRACT,
      value: { type: 'BigNumber', hex: '0x00' },
      data,
      timestamp: 1791655200,
      nonce: '7',
      confirmations: 0,
    },
  ];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('6 TST')).toBeTruthy();
  expect(screen.queryByText('0 ETH')).toBeNull();
});

it.each(['ERC-721', 'ERC-1155'] as const)(
  'renders saved %s intent while no explorer row is available',
  async (tokenStandard) => {
    const amountUnits = tokenStandard === 'ERC-721' ? '1' : '9007199254740993';
    mockRows = [
      savedTransactionHistoryRow({
        hash: `0x${'6'.repeat(64)}`,
        chainId: '1',
        from: ACCOUNT,
        to: CONTRACT,
        value: '0',
        nonce: 9,
        createdAt: 1791655200000,
        gasLimit: '100000',
        feePerGas: '1',
        dataBytes: 196,
        type: 2,
        operation: tokenStandard === 'ERC-721' ? 'erc721' : 'erc1155',
        collectibleTransfer: {
          kind: 'nft-transfer',
          chainId: '1',
          from: ACCOUNT,
          contractAddress: CONTRACT,
          recipient: TARGET,
          tokenStandard,
          tokenId: '0',
          amountUnits,
        },
      } as any),
    ];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    expect(
      await screen.findByText(
        tokenStandard === 'ERC-721' ? 'NFT #0' : `${amountUnits} NFT #0`
      )
    ).toBeTruthy();
    expect(screen.queryByText('0 ETH')).toBeNull();
    expect(screen.queryByText('0 USD')).toBeNull();
  }
);

it('labels a saved Smart batch and shows its total native value without a single recipient', async () => {
  const saved: any = {
    hash: `0x${'f'.repeat(64)}`,
    chainId: '1',
    from: CONTRACT,
    to: CONTRACT,
    value: '0',
    nonce: 2,
    type: 2,
    gasLimit: '100000',
    feePerGas: '1',
    createdAt: 1791655200000,
    phase: 'signed',
    operation: 'send',
    dataBytes: 500,
    selector: '0x765e827f',
    smartAccount: {
      account: ACCOUNT,
      callData: '0x1234',
      executions: [
        { target: TARGET, value: '1000000000000000000', data: '0x' },
        { target: CONTRACT, value: '2000000000000000000', data: '0x' },
      ],
    },
  };
  mockRows = [savedTransactionHistoryRow(saved)];
  render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('send.batchTransaction')).toBeTruthy();
  expect(await screen.findByText(/3(?:\.0+)? ETH/)).toBeTruthy();
  expect(screen.getByText('assetTransfer.nativeValue')).toBeTruthy();
  expect(screen.queryByText(/first\.eth/)).toBeNull();
});

const smartIncomingRow = (
  name: string,
  second = '2000000000000000000',
  multiple = false
) => {
  const calls = [
    { target: CONTRACT, value: '7000000000000000000' },
    { target: ACCOUNT, value: '1000000000000000000' },
    { target: ACCOUNT, value: second },
  ];
  const operations = (
    multiple ? [calls.slice(0, 2), calls.slice(2)] : [calls]
  ).map((group, nonce) => {
    const execution = encodeERC7579Executions(group);
    return [
      TARGET,
      nonce,
      '0x',
      paliSmartAccountInterface.encodeFunctionData('execute', [
        execution.mode,
        execution.executionCalldata,
      ]),
      ZERO,
      50000,
      ZERO,
      '0x',
      '0x1234',
    ];
  });
  const input = paliEntryPointInterface.encodeFunctionData('handleOps', [
    operations,
    CONTRACT,
  ]);
  const hash = id(name);
  const blockHash = id('activity-incoming-smart-batch-block');
  const identities = decodeSmartAccountOperations({
    chainId: '1',
    hash,
    payer: CONTRACT,
    nonce: 2,
    to: getPaliEntryPointAddress(1),
    value: '0',
    data: input,
  });
  return {
    hash,
    from: CONTRACT,
    to: getPaliEntryPointAddress(1),
    value: '0',
    input,
    nonce: 2,
    chainId: 1,
    blockNumber: 42,
    blockHash,
    confirmations: 1,
    timestamp: 1791655200,
    success: true,
    smartAccountExecutionFrom: TARGET,
    logs: identities.map((operation) => ({
      ...paliEntryPointInterface.encodeEventLog(
        paliEntryPointInterface.getEvent('UserOperationEvent'),
        [
          operation.operationHash,
          TARGET,
          CONTRACT,
          operation.operationNonce,
          true,
          1,
          1,
        ]
      ),
      address: getPaliEntryPointAddress(1),
      transactionHash: hash,
      blockHash,
      blockNumber: '0x2a',
    })),
  };
};

it.each([false, true])(
  'shows all successful Smart native payments in Activity (multiple operations=%s)',
  async (multiple) => {
    mockRows = [
      smartIncomingRow(
        'activity-incoming-smart-batch-' + multiple,
        undefined,
        multiple
      ),
    ];
    render(<EvmTransactionsList userTransactions={mockRows} />);
    expect(await screen.findByText('3 ETH')).toBeTruthy();
    expect(screen.queryByText('1 ETH')).toBeNull();
  }
);

it('refreshes the cached native total when the same transaction or selected recipient changes', async () => {
  mockRows = [smartIncomingRow('activity-incoming-smart-cache')];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('3 ETH')).toBeTruthy();
  mockRows = [
    smartIncomingRow('activity-incoming-smart-cache', '4000000000000000000'),
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('5 ETH')).toBeTruthy();
  mockAccountAddress = CONTRACT;
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('7 ETH')).toBeTruthy();
  expect(screen.queryByText('5 ETH')).toBeNull();
});

it('does not retain a positive received total when stored outcome becomes pending or failed', async () => {
  const confirmed = smartIncomingRow('activity-incoming-smart-outcome');
  mockRows = [confirmed];
  const view = render(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('3 ETH')).toBeTruthy();
  mockRows = [
    {
      ...confirmed,
      blockNumber: null,
      blockHash: null,
      confirmations: 0,
      success: undefined,
    },
  ];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('? ETH')).toBeTruthy();
  expect(screen.getByText('send.pending')).toBeTruthy();
  expect(screen.queryByText('3 ETH')).toBeNull();
  mockRows = [{ ...confirmed, success: false }];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('send.failed')).toBeTruthy();
  expect(screen.getByText('? ETH')).toBeTruthy();
  mockRows = [confirmed];
  view.rerender(<EvmTransactionsList userTransactions={mockRows} />);
  expect(await screen.findByText('3 ETH')).toBeTruthy();
});
