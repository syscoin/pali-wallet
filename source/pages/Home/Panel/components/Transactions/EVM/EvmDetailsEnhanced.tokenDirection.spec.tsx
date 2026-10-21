/** @jest-environment jsdom */
import { retryableFetch } from '@sidhujag/sysweb3-network';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { DetailsView } from 'pages/Home/Panel/components/Details';
import { EvmTransactionsList } from 'pages/Home/Panel/components/Transactions/EVM/EvmList';
import MainController from 'scripts/Background/controllers/MainController';
import EvmTransactionsController from 'scripts/Background/controllers/transactions/evm';
import { validateAndManageUserTransactions } from 'scripts/Background/controllers/transactions/utils';
import { defaultAbiCoder, id, Interface } from 'utils/ethersV6Compat';
import { navigateBack } from 'utils/navigationState';

const OWNER = `0x${'11'.repeat(20)}`;
const SPENDER = `0x${'22'.repeat(20)}`;
const OTHER = `0x${'33'.repeat(20)}`;
const TOKEN = `0x${'44'.repeat(20)}`;
const API = 'https://explorer.synthetic.invalid/api';
const RPC = 'https://rpc.synthetic.invalid';
const BLOCK_HASH = `0x${'55'.repeat(32)}`;
let mockState: any;
let mockRows: any[];
let mockWallet: MainController;
let mockInput = '0x';
const mockReads = jest.fn();
const mockAlert = {
  success: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};
const mockT = (key: string) =>
  ({
    'send.sent': 'Sent',
    'send.received': 'Received',
    'notifications.clickToView': 'View details',
    'send.confirmed': 'Confirmed',
  }[key] || key);
const originalFetch = globalThis.fetch;

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('@ant-design/icons', () => ({}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: jest.fn(),
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock(
  'scripts/Background/controllers/providers/patchFetchWithPaliHeaders',
  () => ({ patchFetchWithPaliHeaders: jest.fn() })
);
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
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: jest.requireActual('hooks/useSafeNavigate').useSafeNavigate(),
    alert: mockAlert,
  }),
}));
jest.mock('hooks/usePrice', () => ({
  usePrice: () => ({ getFiatAmount: () => 'test fiat' }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockReads }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockReads(...args),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => jest.requireMock('hooks/useUtils').useUtils(),
  useTransactionsListConfig: (...args: any[]) =>
    jest
      .requireActual(
        'pages/Home/Panel/components/Transactions/utils/useTransactionsInfos'
      )
      .useTransactionsListConfig(...args),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  getKnownTokenLogo: () => undefined,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/TransactionOptions', () => ({
  TransactionOptions: () => null,
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/TransactionDetails', () => ({
  TransactionHeader: (props: any) => {
    const Header = jest.requireActual(
      'components/TransactionDetails/TransactionHeader'
    ).TransactionHeader;
    return (
      <section data-testid="details-header">
        <Header {...props} />
      </section>
    );
  },
  TransactionDetailsList: ({ details }: any) => (
    <section data-testid="details-fields">
      {details.map((item: any) => (
        <span key={item.label} data-testid={item.label}>
          {String(item.value)}
        </span>
      ))}
    </section>
  ),
  TransactionEventLogs: () => null,
  DecodedTransactionParams: () => null,
}));
jest.mock('pages/Home/Panel/components/AssetDetails', () => ({
  AssetDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/Nfts', () => ({
  NftsDetails: () => null,
}));
jest.mock('pages/Home/Panel/components/Transactions', () => ({
  SyscoinTransactionDetails: () => null,
}));

const Back = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return <button onClick={() => navigateBack(navigate, location)}>Back</button>;
};
const show = () =>
  render(
    <MemoryRouter initialEntries={['/home?tab=activity']}>
      <Routes>
        <Route
          path="/home"
          element={<EvmTransactionsList userTransactions={mockRows} />}
        />
        <Route
          path="/home/details"
          element={
            <>
              <DetailsView />
              <Back />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async () => {
    throw new Error('Network forbidden');
  });
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            type: 'HDAccount',
            address: OWNER,
            evmTxCountByChainId: { 1: 1 },
          },
        },
      },
      accountAssets: {
        HDAccount: {
          0: {
            ethereum: [
              {
                chainId: 1,
                contractAddress: TOKEN,
                tokenSymbol: 'TOK',
                decimals: 6,
                isNft: false,
              },
            ],
            syscoin: [],
          },
        },
      },
      accountTransactions: { HDAccount: { 0: { ethereum: {}, syscoin: {} } } },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        currency: 'eth',
        url: RPC,
        apiUrl: API,
      },
      isBitcoinBased: false,
    },
    vaultGlobal: { ensCache: {}, activeSlip44: 60 },
  };
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const cases = [
  {
    name: 'delegated outgoing transferFrom',
    hash: 'a',
    token: true,
    from: OWNER,
    to: OTHER,
    outerFrom: SPENDER,
    transferFrom: true,
    expected: 'Sent',
  },
  {
    name: 'delegated incoming transferFrom',
    hash: 'b',
    token: true,
    from: OTHER,
    to: OWNER,
    outerFrom: SPENDER,
    transferFrom: true,
    expected: 'Received',
  },
  {
    name: 'owner-submitted outgoing transferFrom',
    hash: 'c',
    token: true,
    from: OWNER,
    to: OTHER,
    outerFrom: OWNER,
    transferFrom: true,
    expected: 'Sent',
  },
  {
    name: 'ordinary incoming token transfer',
    hash: 'd',
    token: true,
    from: OTHER,
    to: OWNER,
    outerFrom: OTHER,
    transferFrom: false,
    expected: 'Received',
  },
  {
    name: 'ordinary outgoing native transfer',
    hash: 'e',
    token: false,
    from: OWNER,
    to: OTHER,
    outerFrom: OWNER,
    transferFrom: false,
    expected: 'Sent',
  },
  {
    name: 'ordinary incoming native transfer',
    hash: 'f',
    token: false,
    from: OTHER,
    to: OWNER,
    outerFrom: OTHER,
    transferFrom: false,
    expected: 'Received',
  },
  {
    name: 'native history row with a matching token event',
    hash: '7',
    token: true,
    from: OTHER,
    to: OWNER,
    outerFrom: OWNER,
    transferFrom: true,
    expected: 'Sent',
    basePresent: true,
  },
];

it.each(cases)(
  '$name retains its direction from Activity through details and Back',
  async (scenario) => {
    const basePresent = 'basePresent' in scenario && scenario.basePresent;
    const hash = `0x${scenario.hash.repeat(64)}`;
    mockInput = !scenario.token
      ? '0x'
      : scenario.transferFrom
      ? id('transferFrom(address,address,uint256)').slice(0, 10) +
        defaultAbiCoder
          .encode(
            ['address', 'address', 'uint256'],
            [scenario.from, scenario.to, '1000000']
          )
          .slice(2)
      : id('transfer(address,uint256)').slice(0, 10) +
        defaultAbiCoder
          .encode(['address', 'uint256'], [scenario.to, '1000000'])
          .slice(2);
    const wire = {
      hash,
      from: scenario.from,
      to: scenario.to,
      value: scenario.token ? '1000000' : '1000000000000000000',
      input: '0x',
      timeStamp: '1700000000',
      blockNumber: '42',
      blockHash: BLOCK_HASH,
      confirmations: '3',
      nonce: '7',
      gasPrice: '20000000000',
      isError: '0',
      // eslint-disable-next-line camelcase -- Explorer wire field.
      txreceipt_status: '1',
      contractAddress: TOKEN,
      tokenDecimal: '6',
      tokenSymbol: 'TOK',
    };
    const nativeWire = scenario.token
      ? {
          ...wire,
          from: scenario.outerFrom,
          to: TOKEN,
          value: '0',
          input: mockInput,
        }
      : wire;
    jest.mocked(retryableFetch).mockImplementation(async (endpoint) => {
      const url = new URL(String(endpoint));
      expect(url.origin + url.pathname).toBe(API);
      expect(url.searchParams.get('address')).toBe(OWNER);
      const action = url.searchParams.get('action');
      expect(['txlist', 'tokentx']).toContain(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          message: 'OK',
          result:
            action === 'txlist'
              ? !scenario.token || basePresent
                ? [nativeWire]
                : []
              : scenario.token
              ? [wire]
              : [],
        }),
      } as Response;
    });
    const result = await EvmTransactionsController().fetchTransactionsFromAPI(
      OWNER,
      1,
      API
    );
    expect(result.error).toBeUndefined();
    expect(result.transactions).toHaveLength(1);
    mockRows = validateAndManageUserTransactions(result.transactions!) as any[];
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].direction).toBe(
      scenario.expected === 'Sent' ? 'sent' : 'received'
    );
    mockState.vault.accountTransactions.HDAccount[0].ethereum[1] = mockRows;
    if (scenario.token && !basePresent)
      expect(mockRows[0]).toMatchObject({
        from: scenario.from,
        to: TOKEN,
        historySource: 'explorer-tokentx',
        tokenTransfer: { recipient: scenario.to, value: '1000000' },
      });
    if (basePresent) {
      expect(mockRows[0]).toMatchObject({
        from: OWNER,
        historySource: 'explorer-txlist',
      });
      expect(mockRows[0].tokenTransfer).toBeUndefined();
    }
    const tokenInterface = new Interface([
      'event Transfer(address indexed from,address indexed to,uint256 value)',
    ]);
    const logs = scenario.token
      ? [
          {
            ...tokenInterface.encodeEventLog(
              tokenInterface.getEvent('Transfer'),
              [scenario.from, scenario.to, '1000000']
            ),
            address: TOKEN,
            transactionHash: hash,
            blockHash: BLOCK_HASH,
            blockNumber: 42,
            index: 0,
            transactionIndex: 0,
          },
        ]
      : [];
    const provider = {
      getTransaction: jest.fn(async (requested: string) => {
        expect(requested).toBe(hash);
        return {
          hash,
          from: scenario.outerFrom,
          to: scenario.token ? TOKEN : scenario.to,
          value: BigInt(scenario.token ? '0' : '1000000000000000000'),
          chainId: BigInt(1),
          data: mockInput,
          gasPrice: BigInt('20000000000'),
          gasLimit: BigInt(50000),
          nonce: 7,
          type: 0,
        };
      }),
      getTransactionReceipt: jest.fn(async (requested: string) => {
        expect(requested).toBe(hash);
        return {
          blockNumber: 42,
          blockHash: BLOCK_HASH,
          gasUsed: BigInt(45000),
          status: 1,
          effectiveGasPrice: BigInt('20000000000'),
          logs,
        };
      }),
      getBlockNumber: jest.fn(async () => 44),
      getBlock: jest.fn(async (block: number) => {
        expect(block).toBe(42);
        return { timestamp: 1700000000 };
      }),
    };
    mockWallet = Object.create(MainController.prototype);
    Object.defineProperty(mockWallet, 'ethereumTransaction', {
      value: { web3Provider: provider },
    });
    mockReads.mockImplementation(
      async ([owner, method]: string[], args: any[]) => {
        expect(owner).toBe('wallet');
        if (method === 'getEvmTransactionFromAPI') {
          expect(args).toEqual([hash, API]);
          return null;
        }
        if (method === 'getEvmTransactionFromProvider')
          return mockWallet.getEvmTransactionFromProvider(args[0]);
        if (method === 'decodeEvmTransactionData')
          return {
            method: scenario.token ? 'transferFrom' : 'Send',
            types: [],
            inputs: [],
            names: [],
          };
        throw new Error(`Forbidden controller action ${method}`);
      }
    );
    const snapshot = JSON.stringify(mockState);
    show();
    const expectedAmount = scenario.token
      ? basePresent
        ? '1 TOK'
        : '1.0 TOK'
      : '1 ETH';
    await screen.findByText(expectedAmount);
    if (!basePresent) expect(screen.getByText(scenario.expected)).toBeTruthy();
    const amount = screen.getByText(expectedAmount);
    expect(amount.parentElement?.textContent).toContain(
      `${scenario.expected === 'Sent' ? '-' : '+'}${expectedAmount}`
    );
    fireEvent.click(screen.getByLabelText('View details'));
    await waitFor(() =>
      expect(provider.getTransaction).toHaveBeenCalledWith(hash)
    );
    await waitFor(() =>
      expect(screen.getByTestId('Gas Used').textContent).toBe('45,000')
    );
    const header = screen.getByTestId('details-header');
    expect(within(header).getByText(expectedAmount)).toBeTruthy();
    expect(screen.getByTestId('To').textContent).toBe(scenario.to);
    expect(screen.getByTestId('From').textContent).toBe(scenario.outerFrom);
    expect(screen.getByTestId('Hash').textContent).toBe(hash);
    expect(screen.getByTestId('Gas Price').textContent).toBe('20.00 Gwei');
    expect(JSON.stringify(mockState)).toBe(snapshot);
    expect(within(header).getByText(scenario.expected)).toBeTruthy();
    fireEvent.click(screen.getByText('Back'));
    await screen.findByText(expectedAmount);
    if (!basePresent) expect(screen.getByText(scenario.expected)).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }
);
