/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { getErc20Abi, getErc21Abi, getErc55Abi } from '@sidhujag/sysweb3-utils';
import {
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { EthProvider } from 'scripts/Provider/EthProvider';
import { BigNumber, Interface, formatEther } from 'utils/ethersV6Compat';

import { SendTransaction } from './SendTransaction';

const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const originalFetch = globalThis.fetch;
const mockCopy = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
const mockState = {
  vault: {
    isBitcoinBased: false,
    activeAccount: { type: 'HDAccount', id: 0 },
    accounts: {
      HDAccount: { 0: { id: 0, address: FROM, balances: { ethereum: '100' } } },
    },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      currency: 'ETH',
      url: 'https://review.synthetic.invalid',
    },
  },
  vaultGlobal: { activeSlip44: 60, advancedSettings: { autolock: 30 } },
};
let mockQuery: any;
const mockPopup = jest.fn(async (request: any) => {
  mockQuery = {
    ...request.data,
    eventName: request.eventName,
    host: request.host,
  };
  return 'captured-review-only';
});
const mockRpc = {
  getBlock: jest.fn(async () => ({ baseFeePerGas: '1000000000' })),
  call: jest.fn(async () => `0x${'0'.repeat(64)}`),
};
const mockWallet = {
  ethereumTransaction: { web3Provider: mockRpc },
  getWalletSessionGeneration: () => 1,
  getErc20Abi,
  getErc721Abi: getErc21Abi,
  getErc1155Abi: getErc55Abi,
};
const mockEmitter = jest.fn(
  async (path: string[], args: any[] = []): Promise<unknown> => {
    switch (path.join('.')) {
      case 'wallet.refreshActiveAccountBalances':
        return { nativeBalance: '100' };
      case 'wallet.checkAddressBlacklist':
        return { isBlacklisted: false };
      case 'wallet.isContractAddress':
        return true;
      case 'wallet.getRecommendedEvmNonce':
        return 0;
      case 'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas':
        return {
          gasPrice: BigNumber.from('2000000000'),
          maxFeePerGas: BigNumber.from('3000000000'),
          maxPriorityFeePerGas: BigNumber.from('1000000000'),
        };
      case 'wallet.ethereumTransaction.web3Provider.send':
        if (args[0] === 'eth_getBlockByNumber')
          return { gasLimit: '30000000', baseFeePerGas: '1000000000' };
        if (args[0] === 'eth_estimateGas') return '21000';
        if (args[0] === 'eth_call') return '0x';
        throw Error(`Denied RPC: ${args[0]}`);
      default:
        throw Error(
          `Denied irreversible or unexpected controller call: ${path.join('.')}`
        );
    }
  }
);
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
  useUtils: () => ({ alert: mockAlert, navigate: jest.fn() }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    alert: mockAlert,
    navigate: jest.fn(),
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (path: string[], args?: any[]) => mockEmitter(path, args),
}));
jest.mock('state/vault/selectors', () => ({
  selectEnsNameToAddress: () => ({}),
  selectValidEnsCache: () => ({}),
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({
    wallet: mockWallet,
    dapp: { getAccount: () => ({ address: FROM }) },
  }),
}));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({ popupPromise: (request: any) => mockPopup(request) })
);
jest.mock(
  'scripts/Background/controllers/message-handler/method-registry',
  () => ({ getUnrestrictedMethods: () => [] })
);
jest.mock(
  'scripts/Background/controllers/message-handler/request-pipeline',
  () => ({ requestCoordinator: { coordinatePopupRequest: jest.fn() } })
);
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  clearTransactionNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/smartAccount', () => ({
  getSmartAccountLocalOwnerContexts: () => [],
  prepareSmartAccountFeeQuote: () => {
    throw Error('Denied smart account execution');
  },
  signAndSubmitSmartAccountExecutions: () => {
    throw Error('Denied signing');
  },
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

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(() => {
    throw Error('Denied public HTTP');
  }) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

const prepare = async (
  value: string,
  data = '0x',
  to: string | null = TO,
  automatic = false
) => {
  const input = {
    from: FROM,
    ...(to ? { to } : {}),
    value,
    data,
    ...(automatic ? {} : { nonce: 0 }),
  };
  const original = JSON.stringify(input);
  await EthProvider('https://review-dapp.synthetic.invalid').sendTransaction(
    input as any
  );
  expect(JSON.stringify(input)).toBe(original);
  expect(mockQuery.tx.value).toBe(`0x${BigInt(value).toString(16)}`);
  expect(mockQuery.tx.data).toBe(data);
  const view = render(<SendTransaction />);
  await screen.findByRole('button', { name: 'buttons.confirm' });
  const header = view.container.querySelector('p.text-base')?.textContent;
  const estimates = mockEmitter.mock.calls.filter(
    ([path, args]) =>
      path.join('.') === 'wallet.ethereumTransaction.web3Provider.send' &&
      args[0] === 'eth_estimateGas'
  );
  expect(estimates.length).toBeGreaterThan(0);
  expect(estimates[0][1][1][0].value).toBe(mockQuery.tx.value);
  expect(
    mockEmitter.mock.calls.every(
      ([path]) =>
        !path.join('.').includes('sign') &&
        !path.join('.').includes('sendTransaction')
    )
  ).toBe(true);
  return { view, header };
};

it.each([
  ['whole native unit', '1000000000000000000', '1'],
  ['one wei', '1', '0.000000000000000001'],
  [
    'one native unit plus one wei',
    '1000000000000000001',
    '1.000000000000000001',
  ],
  ['ordinary 18-decimal amount', '1234567890123456789', '1.234567890123456789'],
])(
  'retains an exact non-approximate amount heading for %s',
  async (_label, value, expected) => {
    const { header, view } = await prepare(value);
    const exactTotal = formatEther(BigNumber.from(value).add('75600000000000'));
    expect(view.container.textContent).toContain(`${exactTotal} ETH`);
    expect(header).toBe(`${expected} ETH`);
  }
);

it('retains normalized composite integers and exact hex through actual decoder and review tabs', async () => {
  const iface = new Interface(getErc55Abi());
  const ids = ['0', '123456789012345678901234567890'];
  const data = iface.encodeFunctionData('safeBatchTransferFrom', [
    FROM,
    RECIPIENT,
    ids,
    ['1', '2'],
    '0x1234567890abcdef',
  ]);
  await prepare('0', data);
  fireEvent.click(screen.getByRole('tab', { name: 'send.data' }));
  const decoded = JSON.parse(
    document.querySelector('#dataTab pre')!.textContent!
  );
  expect(decoded.inputs).toEqual([
    FROM,
    RECIPIENT,
    ids,
    ['1', '2'],
    '0x1234567890abcdef',
  ]);
  fireEvent.click(screen.getByRole('tab', { name: 'send.hex' }));
  expect(document.querySelector('#hexTab')!.textContent).toBe(data);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('retains contract deployment bytes without falsely decoding initcode parameters', async () => {
  const data = '0x60006000f3';
  await prepare('0', data, null);
  expect(mockQuery.decodedTx).toEqual({
    method: 'Contract Deployment',
    types: [],
    inputs: [],
    names: [],
  });
  fireEvent.click(screen.getByRole('tab', { name: 'send.hex' }));
  expect(document.querySelector('#hexTab')!.textContent).toBe(data);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('reconfirms an original explicit zero on each deliberate retry', async () => {
  const previous = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path: string[], args: any[] = []) => {
    if (path.join('.') === 'wallet.authorizeDappManualNonce') return true;
    if (path.join('.') === 'wallet.sendAndSaveEthTransaction')
      throw Object.assign(new Error('conflict'), {
        code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
        transactionNotBroadcast: true,
      });
    return previous(path, args);
  });
  try {
    await prepare('1');
    const confirm = screen.getByRole('button', { name: 'buttons.confirm' });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
        )
      ).toHaveLength(1)
    );
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
        )
      ).toHaveLength(2)
    );
    const grants = mockEmitter.mock.calls.filter(
      ([path]) => path.join('.') === 'wallet.authorizeDappManualNonce'
    );
    expect(grants.map(([, args]) => args[0])).toEqual(['0x0', '0x0']);
  } finally {
    mockEmitter.mockImplementation(previous);
  }
});

it('recommends and displays a fresh automatic nonce before retrying a definite failure', async () => {
  const previous = mockEmitter.getMockImplementation()!;
  let quoteCount = 0;
  let resolveQuote!: (nonce: number) => void;
  const heldQuote = new Promise<number>((resolve) => {
    resolveQuote = resolve;
  });
  mockEmitter.mockImplementation(async (path: string[], args: any[] = []) => {
    if (path.join('.') === 'wallet.getRecommendedEvmNonce')
      return ++quoteCount === 1 ? 0 : heldQuote;
    if (path.join('.') === 'wallet.sendAndSaveEthTransaction') {
      const attempts = mockEmitter.mock.calls.filter(
        ([route]) => route.join('.') === 'wallet.sendAndSaveEthTransaction'
      );
      if (attempts.length === 1)
        throw Object.assign(new Error('conflict'), {
          code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT',
          transactionNotBroadcast: true,
        });
      return { hash: `0x${'ab'.repeat(32)}` };
    }
    return previous(path, args);
  });
  try {
    await prepare('1', '0x', TO, true);
    const confirm = screen.getByRole('button', { name: 'buttons.confirm' });
    fireEvent.click(confirm);
    await waitFor(() => expect(quoteCount).toBe(2));
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(
      mockEmitter.mock.calls.filter(
        ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
      )
    ).toHaveLength(1);
    resolveQuote(1);
    await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveValue(1));
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.filter(
          ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
        )
      ).toHaveLength(2)
    );
    const sends = mockEmitter.mock.calls.filter(
      ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
    );
    expect(sends.map(([, args]) => args[0].nonce)).toEqual([0, 1]);
    expect(
      mockEmitter.mock.calls.some(
        ([path]) => path.join('.') === 'wallet.authorizeDappManualNonce'
      )
    ).toBe(false);
  } finally {
    resolveQuote(1);
    mockEmitter.mockImplementation(previous);
  }
});

it.each([
  ['EVM_LEGACY_PENDING', 'send.legacyPendingNonce'],
  [
    'EVM_LEGACY_VERIFICATION_UNAVAILABLE',
    'send.legacyNonceVerificationUnavailable',
  ],
])(
  'shows %s on an initial quote failure and retries the full review',
  async (code, messageKey) => {
    const previous = mockEmitter.getMockImplementation()!;
    let quotes = 0;
    mockEmitter.mockImplementation(async (path: string[], args: any[] = []) => {
      if (path.join('.') === 'wallet.getRecommendedEvmNonce' && ++quotes === 1)
        throw Object.assign(new Error('legacy nonce guard'), {
          code,
          transactionNotBroadcast: true,
        });
      return previous(path, args);
    });
    try {
      await EthProvider(
        'https://review-dapp.synthetic.invalid'
      ).sendTransaction({ from: FROM, to: TO, value: '1', data: '0x' } as any);
      render(<SendTransaction />);
      expect(await screen.findByText(messageKey)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'buttons.confirm' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'buttons.cancel' })
      ).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
      expect(
        await screen.findByRole('button', { name: 'buttons.confirm' })
      ).toBeEnabled();
      expect(quotes).toBe(2);
      expect(
        mockEmitter.mock.calls.some(
          ([path]) => path.join('.') === 'wallet.sendAndSaveEthTransaction'
        )
      ).toBe(false);
    } finally {
      mockEmitter.mockImplementation(previous);
    }
  }
);
