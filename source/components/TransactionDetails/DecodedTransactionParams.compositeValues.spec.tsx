/** @jest-environment jsdom */
import { getErc20Abi, getErc21Abi, getErc55Abi } from '@sidhujag/sysweb3-utils';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import { EvmTransactionDetailsEnhanced } from 'pages/Home/Panel/components/Transactions/EVM/EvmDetailsEnhanced';
import MainController from 'scripts/Background/controllers/MainController';
import { Interface } from 'utils/ethersV6Compat';
import { decodeTransactionData } from 'utils/ethUtil';
import { pegasysABI } from 'utils/pegasys';
import {
  paliSmartAccountFactoryInterface,
  paliSmartAccountInterface,
} from 'utils/smartAccount/contracts';

import { DecodedTransactionParams } from './DecodedTransactionParams';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ content, children }: any) => (
    <span data-testid="parameter-tooltip" data-content={String(content)}>
      {children}
    </span>
  ),
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
  camelCaseToText: (value: string) =>
    value
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (letter) => letter.toUpperCase()),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ useCopyClipboard: () => [false, jest.fn()], alert: {} }),
  useTransactionsListConfig: () => ({
    getTxType: () => 'Sent',
    getTxStatusIcons: () => null,
    getTxStatus: () => 'Confirmed',
  }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: ACCOUNT,
    network: 'composite-native',
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ id: 0, address: ACCOUNT }),
  selectActiveAccountTransactions: () => ({ ethereum: { 5700: mockHistory } }),
  selectValidEnsCache: () => ({}),
}));
jest.mock('utils/addressPoisoning', () => ({
  getTrustedEvmRecipients: () => new Set(),
  getEvmHistoryAddressCopyRisk: () => null,
}));
jest.mock('utils/transactions', () => ({
  getSmartAccountDisplayTransaction: (tx: any) => tx,
  getSmartAccountExecutionTransactions: () => [],
  getTransactionDisplayInfo: async () => ({
    formattedValue: '0',
    displayValue: '0',
    displaySymbol: 'ETH',
    actualRecipient: TARGET,
    isErc20Transfer: false,
    isNft: false,
  }),
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: () => <div data-testid="header" />,
  TransactionDetailsList: ({ details }: any) => (
    <div>
      {details.map((item: any, index: number) => (
        <span key={index}>
          {item.label}:{String(item.value)}|
        </span>
      ))}
    </div>
  ),
  TransactionEventLogs: () => null,
  DecodedTransactionParams: jest.requireActual(
    'components/TransactionDetails/DecodedTransactionParams'
  ).DecodedTransactionParams,
}));

const ACCOUNT = `0x${'11'.repeat(20)}`;
const TARGET = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const OTHER = `0x${'44'.repeat(20)}`;
const ZERO = `0x${'00'.repeat(20)}`;
const provider = { call: jest.fn(async () => `0x${'0'.repeat(64)}`) };
const controller = {
  getErc20Abi,
  getErc721Abi: getErc21Abi,
  getErc1155Abi: getErc55Abi,
};
const mockState: any = {
  vaultGlobal: { activeSlip44: 60 },
  vault: {
    activeNetwork: {
      chainId: 5700,
      kind: 'ethereum',
      currency: 'ETH',
      url: 'https://synthetic.invalid',
    },
  },
};
let mockHistory: any[] = [];
const mockEmitter = jest.fn();
const erc1155 = new Interface(getErc55Abi());
const decode = (data: string) =>
  decodeTransactionData(
    { from: ACCOUNT, to: TARGET, data },
    provider,
    controller
  );
const batch = (ids: string[], amounts: string[]) =>
  erc1155.encodeFunctionData('safeBatchTransferFrom', [
    ACCOUNT,
    RECIPIENT,
    ids,
    amounts,
    '0x',
  ]);
const contents = () =>
  screen
    .getAllByTestId('parameter-tooltip')
    .map((node) => node.getAttribute('data-content'));

beforeEach(() => {
  jest.clearAllMocks();
  mockHistory = [];
});
afterEach(cleanup);

it('keeps empty ERC1155 arrays exact through the real SDK ABI and ethers decoder', async () => {
  const data = batch([], []);
  const result = await decode(data);
  expect(result).toMatchObject({
    method: 'safeBatchTransferFrom',
    types: ['address', 'address', 'uint256[]', 'uint256[]', 'bytes'],
    inputs: [ACCOUNT, RECIPIENT, [], [], '0x'],
  });
  expect(data).toBe(batch([], []));
});

it('distinguishes empty token-id and amount arrays from actual zero-valued elements', async () => {
  render(
    <DecodedTransactionParams decodedData={await decode(batch([], []))} />
  );
  const empty = contents().slice(2, 4);
  cleanup();
  render(
    <DecodedTransactionParams decodedData={await decode(batch(['0'], ['0']))} />
  );
  const singletonZero = contents().slice(2, 4);
  // A zero token ID and an empty token list are different ABI values.
  expect(empty).toEqual(['[]', '[]']);
  expect(singletonZero).toEqual(['["0"]', '["0"]']);
});

it('does not display empty ERC1155 token arrays as the scalar zero', async () => {
  render(
    <DecodedTransactionParams decodedData={await decode(batch([], []))} />
  );
  const values = contents();
  expect(values.slice(2, 4)).toEqual(['[]', '[]']);
});

it('retains all nonempty batch integers without precision loss', async () => {
  const large = '123456789012345678901234567890';
  const decoded = await decode(batch(['0', large], ['1', '2']));
  expect(decoded?.inputs.slice(2, 4)).toEqual([
    ['0', large],
    ['1', '2'],
  ]);
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(contents().slice(2, 4)).toEqual([
    JSON.stringify(['0', large]),
    JSON.stringify(['1', '2']),
  ]);
  expect(decoded?.inputs.slice(2, 4)).toEqual([
    ['0', large],
    ['1', '2'],
  ]);
});

it('keeps distinct addresses in the actual router path array', async () => {
  const router = new Interface(pegasysABI);
  const data = router.encodeFunctionData('swapExactTokensForTokens', [
    '7',
    '6',
    [RECIPIENT, OTHER],
    ACCOUNT,
    '1000',
  ]);
  const decoded = await decode(data);
  expect(decoded).toMatchObject({ method: 'swapExactTokensForTokens' });
  expect(decoded?.inputs[2]).toEqual([RECIPIENT, OTHER]);
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(contents()[2]).toBe(JSON.stringify([RECIPIENT, OTHER]));
});

it('keeps nested module tuple values from the built-in factory ABI', async () => {
  const data = paliSmartAccountFactoryInterface.encodeFunctionData(
    'createAccountWithModules',
    [
      `0x${'ab'.repeat(32)}`,
      [
        [RECIPIENT, '0x1234'],
        [OTHER, '0xabcd'],
      ],
      [],
      [ZERO, '0x'],
      [],
    ]
  );
  const decoded = await decode(data);
  expect(decoded?.method).toBe('createAccountWithModules');
  expect(decoded?.inputs[1]).toEqual([
    [RECIPIENT, '0x1234'],
    [OTHER, '0xabcd'],
  ]);
  expect(decoded?.inputs[2]).toEqual([]);
  expect(decoded?.inputs[3]).toEqual([ZERO, '0x']);
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(contents()[1]).toBe(
    JSON.stringify([
      [RECIPIENT, '0x1234'],
      [OTHER, '0xabcd'],
    ])
  );
  expect(contents()[2]).toBe('[]');
  expect(contents()[3]).toBe(JSON.stringify([ZERO, '0x']));
  expect(contents()[4]).toBe('[]');
});

it('retains the real approval boolean false as the explicit revoked state', async () => {
  const data = erc1155.encodeFunctionData('setApprovalForAll', [
    RECIPIENT,
    false,
  ]);
  const decoded = await decode(data);
  expect(decoded).toMatchObject({
    inputs: [RECIPIENT, false],
    approvalType: 'nft-all',
  });
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(screen.getByText('✗ transactions.revoked')).toBeTruthy();
});

it('keeps normalized nested user-operation integers JSON-safe and exact', async () => {
  const zeroBytes32 = `0x${'00'.repeat(32)}`;
  const userOperation = [
    ACCOUNT,
    '123456789012345678901234567890',
    '0x',
    '0x1234',
    zeroBytes32,
    '21000',
    zeroBytes32,
    '0x',
    '0xabcd',
  ];
  const data = paliSmartAccountInterface.encodeFunctionData('validateUserOp', [
    userOperation,
    zeroBytes32,
    '7',
  ]);
  const decoded = await decode(data);
  expect(decoded?.method).toBe('validateUserOp');
  expect(decoded?.inputs[0]).toEqual(userOperation);
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(contents()[0]).toBe(JSON.stringify(userOperation));
  expect(decoded?.inputs[0]).toEqual(userOperation);
});

it('preserves empty arrays through the real enhanced details/controller path', async () => {
  const tx = {
    hash: `0x${'ab'.repeat(32)}`,
    from: ACCOUNT,
    to: TARGET,
    input: batch([], []),
    value: '0',
    chainId: 5700,
    blockNumber: 42,
    confirmations: 3,
  };
  mockHistory = [tx];
  const wallet: any = Object.create(MainController.prototype);
  wallet.keyrings = new Map([
    [60, { ethereumTransaction: { web3Provider: provider } }],
  ]);
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'getEvmTransactionFromProvider') return Promise.resolve(tx);
    if (method === 'decodeEvmTransactionData')
      return wallet.decodeEvmTransactionData(args[0]);
    throw new Error(`Unexpected controller call: ${method}`);
  });
  render(<EvmTransactionDetailsEnhanced hash={tx.hash} tx={tx as any} />);
  await screen.findByText(/Method:SafeBatchTransferFrom/);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'decodeEvmTransactionData'],
    [expect.objectContaining({ input: tx.input })]
  );
  const decoded = await wallet.decodeEvmTransactionData(tx);
  expect(decoded.inputs.slice(2, 4)).toEqual([[], []]);
  expect(contents().slice(2, 4)).toEqual(['[]', '[]']);
});

it('retains an ordinary scalar integer alongside composite formatting', async () => {
  const token = new Interface(getErc20Abi());
  const decoded = await decode(
    token.encodeFunctionData('transfer', [OTHER, '19'])
  );
  render(<DecodedTransactionParams decodedData={decoded} />);
  expect(contents()[1]).toBe('19');
});
