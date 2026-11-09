jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/message-handler/method-registry',
  () => ({ getUnrestrictedMethods: jest.fn(() => []) })
);
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({ popupPromise: jest.fn() })
);
jest.mock(
  'scripts/Background/controllers/message-handler/request-pipeline',
  () => ({
    requestCoordinator: { coordinatePopupRequest: jest.fn() },
  })
);
jest.mock('utils/ethUtil', () => ({ decodeTransactionData: jest.fn() }));

import { createNativeDappRpcReadHost } from '../../../apps/mobile/src/custody/dappRpcReads';
import { createNativeNetwork } from '../../../apps/mobile/src/custody/networkContext';
import { normalizeDappRpcRequest } from '../../shared/dappRpcReads';
import { getController } from 'scripts/Background';
import { getUnrestrictedMethods } from 'scripts/Background/controllers/message-handler/method-registry';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { requestCoordinator } from 'scripts/Background/controllers/message-handler/request-pipeline';
import {
  MethodRoute,
  MethodHandlerType,
  NetworkEnforcement,
  NetworkPreference,
  type IEnhancedRequestContext,
} from 'scripts/Background/controllers/message-handler/types';
import store from 'state/store';
import { KeyringAccountType } from 'types/network';
import { decodeTransactionData } from 'utils/ethUtil';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';

import { EthProvider } from './EthProvider';

const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const OTHER_FROM = `0x${'33'.repeat(20)}`;
const HOST = 'https://transaction.test';
const HASH = `0x${'44'.repeat(32)}`;
const NODE_PUBLIC_CASES = [
  ['eth_coinbase', [], OTHER_FROM],
  ['web3_sha3', ['0Xabcd'], HASH],
  ['eth_getFilterChanges', ['0x0000aBcD'], []],
  ['eth_getFilterLogs', ['opaque-filter-ID'], []],
  ['eth_newBlockFilter', [], 'opaque-block-filter'],
  ['eth_newFilter', [{ topics: [null] }], '0x0000aBcD'],
  ['eth_newPendingTransactionFilter', [true], 'opaque-pending-filter'],
  ['eth_uninstallFilter', ['0x0000aBcD'], false],
  ['eth_getWork', [], [HASH, HASH, HASH, '0x1']],
  ['eth_hashrate', [], '0x0'],
  ['eth_mining', [], false],
  ['eth_submitHashrate', [`0x${'00'.repeat(31)}01`, HASH], false],
  ['eth_submitWork', ['0x0000000000000001', HASH, HASH], false],
] as const;
const transaction = { from: FROM, to: TO, value: '0x0' };
const controllerMock = getController as jest.Mock;
const stateMock = store.getState as jest.Mock;
const popupMock = popupPromise as jest.Mock;
const decodeMock = decodeTransactionData as jest.Mock;
const coordinateMock = requestCoordinator.coordinatePopupRequest as jest.Mock;
const rpc = { getBlock: jest.fn(), send: jest.fn() };
const connectedAccountMock = jest.fn();
const sessionGenerationMock = jest.fn();
let wallet: any;
let vault: any;
let vaultGlobal: any;
let requestLifetime: AbortController;
const readContext = (): IEnhancedRequestContext => ({
  methodConfig: {
    name: 'public-read-test',
    allowHardwareWallet: true,
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    networkPreference: NetworkPreference.EVM,
    networkEnforcement: NetworkEnforcement.Never,
    hasPopup: false,
  },
  originalRequest: {
    host: HOST,
    method: 'public-read-test',
    type: 'ethereum',
    sender: {},
    signal: requestLifetime.signal,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  requestLifetime = new AbortController();
  (getUnrestrictedMethods as jest.Mock).mockReturnValue([]);
  rpc.getBlock.mockResolvedValue({ baseFeePerGas: '0x3b9aca00' });
  popupMock.mockResolvedValue(HASH);
  decodeMock.mockResolvedValue({
    method: 'Contract Interaction',
    inputs: [],
    names: [],
    types: [],
  });
  coordinateMock.mockImplementation(async (_context, openPopup) => openPopup());
  connectedAccountMock.mockReturnValue({ address: FROM });
  sessionGenerationMock.mockReturnValue(1);
  wallet = {
    ethereumTransaction: { web3Provider: rpc },
    getWalletSessionGeneration: sessionGenerationMock,
  };
  controllerMock.mockReturnValue({
    wallet,
    dapp: { getAccount: connectedAccountMock },
  });
  vault = {
    activeNetwork: { chainId: 1, url: 'https://rpc.example' },
    activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
    accounts: { HDAccount: { 0: { address: FROM } } },
  };
  vaultGlobal = { activeSlip44: 60 };
  stateMock.mockImplementation(() => ({ vault, vaultGlobal }));
});

describe('EthProvider public RPC admission and errors', () => {
  beforeEach(() => {
    (getUnrestrictedMethods as jest.Mock).mockReturnValue([
      'eth_getTransactionReceipt',
    ]);
  });

  it.each([
    [
      'eth_getLogs',
      [{ fromBlock: '0x00', toBlock: 'pending', topics: [null, [HASH, null]] }],
      [],
    ],
    ['eth_getProof', [FROM, ['0XABC', '0x', HASH], null], { storageProof: [] }],
    [
      'eth_getProof',
      [FROM, [], `0x${'00'.repeat(31)}01`],
      { storageProof: [] },
    ],
    ['web3_clientVersion', [], 'Example/v1'],
    ['net_listening', [], false],
    ['net_peerCount', [], '0x0'],
    ...NODE_PUBLIC_CASES,
  ])(
    'shares %s request/result semantics with the native owned read host',
    async (method, params, result) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue([method]);
      rpc.send.mockResolvedValue(result);
      const expected = normalizeDappRpcRequest(method as string, params);
      const extensionResult = await EthProvider(
        HOST,
        readContext()
      ).unrestrictedRPCMethods(method as string, params as any[]);
      const observed: { method: string; params: unknown[] }[] = [];
      const registration = createNativeNetwork({
        id: 'custom-provider',
        name: 'Example',
        kind: 'evm',
        chainId: '31337',
        slip44: 60,
        rpcUrl: 'https://custom.example',
        symbol: 'TEST',
        decimals: 18,
        testnet: true,
      });
      const native = createNativeDappRpcReadHost({
        registration: () => registration,
        verifyPersonalMessage() {
          throw Error('RPC reads must not recover');
        },
        async fetch(_url, init) {
          const request = JSON.parse(init.body as string);
          observed.push(request);
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: request.method === 'eth_chainId' ? '0x7a69' : result,
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        },
      });
      expect(
        await native.read(expected, new AbortController().signal, () => {})
      ).toEqual(extensionResult);
      expect(rpc.send).toHaveBeenCalledTimes(1);
      expect(rpc.send).toHaveBeenCalledWith(method, [...expected.params]);
      expect(observed.map((value) => value.method)).toEqual([
        'eth_chainId',
        method,
        'eth_chainId',
      ]);
      expect(observed[1]!.params).toEqual(expected.params);
      expect(popupMock).not.toHaveBeenCalled();
    }
  );

  it.each(NODE_PUBLIC_CASES)(
    'preserves node capability errors for %s without fallback/retry',
    async (method, params) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue([method]);
      const failure = {
        code: -32601,
        message: 'Method unavailable on this node',
      };
      rpc.send.mockRejectedValueOnce(failure);
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(method, [
          ...params,
        ])
      ).rejects.toBe(failure);
      expect(rpc.send).toHaveBeenCalledTimes(1);
      expect(popupMock).not.toHaveBeenCalled();
    }
  );
  it.each([
    'future_unclassified',
    'eth_accounts',
    'eth_chainId',
    'net_version',
    'eth_subscribe',
    'eth_unsubscribe',
  ])(
    'never sends unclassified/custom/unsupported %s to the generic node transport',
    async (method) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue([method]);
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(method, [])
      ).rejects.toMatchObject({ code: 4200 });
      expect(rpc.send).not.toHaveBeenCalled();
    }
  );
  it.each(NODE_PUBLIC_CASES)(
    'drops a stale %s response after dispatch without repeating a node operation',
    async (method, params, result) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue([method]);
      rpc.send.mockImplementationOnce(async () => {
        vault.activeNetwork = {
          ...vault.activeNetwork,
          url: 'https://new.example',
        };
        return result;
      });
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(method, [
          ...params,
        ])
      ).rejects.toMatchObject({ code: 4100 });
      expect(rpc.send).toHaveBeenCalledTimes(1);
    }
  );

  it('uses the common local recovery/checksum path without a node request or popup', async () => {
    (getUnrestrictedMethods as jest.Mock).mockReturnValue([
      'personal_ecRecover',
    ]);
    wallet.ethereumTransaction.verifyPersonalMessage = jest.fn(
      () => '0x52908400098527886e0f7030069857d2e4169ee7'
    );
    await expect(
      EthProvider(HOST, readContext()).unrestrictedRPCMethods(
        'personal_ecRecover',
        ['0xabc', 'compact-signature']
      )
    ).resolves.toBe('0x52908400098527886E0F7030069857D2E4169EE7');
    expect(
      wallet.ethereumTransaction.verifyPersonalMessage
    ).toHaveBeenCalledWith('0xabc', 'compact-signature');
    expect(rpc.send).not.toHaveBeenCalled();
    expect(popupMock).not.toHaveBeenCalled();
  });

  it('requires an explicit request lifetime before public read execution', async () => {
    (getUnrestrictedMethods as jest.Mock).mockReturnValue(['net_listening']);
    const context = readContext();
    delete context.originalRequest.signal;
    await expect(
      EthProvider(HOST, context).unrestrictedRPCMethods('net_listening', [])
    ).rejects.toMatchObject({ code: 4001 });
    expect(rpc.send).not.toHaveBeenCalled();
  });

  it.each(['network', 'account', 'session', 'provider', 'document'])(
    'retires a held public read after %s changes',
    async (change) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue(['eth_getLogs']);
      let release!: (value: unknown) => void;
      rpc.send.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const reading = EthProvider(HOST, readContext()).unrestrictedRPCMethods(
        'eth_getLogs',
        [{}]
      );
      const rejected = expect(reading).rejects.toMatchObject({
        code: change === 'document' ? 4001 : 4100,
      });
      if (change === 'network')
        vault.activeNetwork = {
          ...vault.activeNetwork,
          url: 'https://replacement.example',
        };
      else if (change === 'account')
        vault.activeAccount = { ...vault.activeAccount, id: 1 };
      else if (change === 'session') sessionGenerationMock.mockReturnValue(2);
      else if (change === 'provider')
        wallet.ethereumTransaction.web3Provider = { send: jest.fn() };
      else requestLifetime.abort();
      release([]);
      await rejected;
    }
  );

  it.each(['eth_call', 'eth_estimateGas'])(
    'forwards a bounded type-1 %s simulation without signing approval',
    async (method) => {
      (getUnrestrictedMethods as jest.Mock).mockReturnValue([method]);
      const params = [
        {
          from: FROM,
          to: TO,
          type: '0x1',
          gasPrice: '0x1',
          accessList: [{ address: TO, storageKeys: [HASH] }],
          data: '0x1234',
        },
        'pending',
      ];
      const original = JSON.parse(JSON.stringify(params));
      rpc.send.mockResolvedValueOnce('0x5208');
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(method, params)
      ).resolves.toBe('0x5208');
      expect(rpc.send).toHaveBeenCalledTimes(1);
      expect(rpc.send).toHaveBeenCalledWith(method, original);
      expect(params).toEqual(original);
      expect(popupMock).not.toHaveBeenCalled();
      expect(coordinateMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    [],
    [null],
    [undefined],
    [{}],
    ['0x1234'],
    [`0x${'z'.repeat(64)}`],
    [HASH, 'unexpected'],
  ])(
    'rejects malformed receipt params %p before RPC work',
    async (...params) => {
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(
          'eth_getTransactionReceipt',
          params
        )
      ).rejects.toMatchObject({ code: -32602 });
      expect(rpc.send).not.toHaveBeenCalled();
    }
  );

  it.each([[HASH], [{ hash: HASH }]])(
    'preserves a pending receipt result and does not mutate params %p',
    async (param) => {
      const params = [param];
      const original = JSON.parse(JSON.stringify(params));
      rpc.send.mockResolvedValueOnce(null);
      await expect(
        EthProvider(HOST, readContext()).unrestrictedRPCMethods(
          'eth_getTransactionReceipt',
          params
        )
      ).resolves.toBeNull();
      expect(rpc.send).toHaveBeenCalledTimes(1);
      expect(rpc.send).toHaveBeenCalledWith('eth_getTransactionReceipt', [
        HASH,
      ]);
      expect(params).toEqual(original);
    }
  );

  it.each([
    new Error('Network unavailable'),
    {
      code: -32005,
      message: 'Request limit exceeded',
      data: { retryAfter: 1 },
    },
    { code: 4900, message: 'Disconnected' },
  ])('does not mask a raw-transaction RPC failure %p', async (error) => {
    rpc.send.mockRejectedValueOnce(error);
    await expect(
      EthProvider(HOST, readContext()).restrictedRPCMethods(
        'eth_sendRawTransaction',
        ['0x00']
      )
    ).rejects.toBe(error);
    expect(rpc.send).toHaveBeenCalledTimes(1);
  });
});

const expectNoRpcOrPopup = () => {
  expect(rpc.getBlock).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
  expect(decodeMock).not.toHaveBeenCalled();
  expect(popupMock).not.toHaveBeenCalled();
  expect(coordinateMock).not.toHaveBeenCalled();
};

describe('EthProvider transaction admission', () => {
  it.each([
    'value',
    'gas',
    'gasLimit',
    'gasPrice',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
    'nonce',
    'chainId',
    'type',
  ])('rejects malformed %s before controller or popup work', async (field) => {
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        [field]: 'invalid',
      } as any)
    ).rejects.toMatchObject({ code: -32602 });
    expect(controllerMock).not.toHaveBeenCalled();
    expect(stateMock).not.toHaveBeenCalled();
    expectNoRpcOrPopup();
  });

  it.each([
    ['unsafe number', { value: Number.MAX_SAFE_INTEGER + 1 }],
    ['object quantity', { value: { _hex: '0x1' } }],
    ['null quantity', { maxFeePerGas: null }],
    ['invalid sender', { from: [] }],
    ['invalid destination', { to: 'invalid' }],
    ['odd byte data', { data: '0x0' }],
    ['conflicting calldata', { data: '0x00', input: '0x01' }],
    ['conflicting gas', { gas: '0x5208', gasLimit: '0x5209' }],
    ['conflicting fees', { gasPrice: '0x1', maxFeePerGas: '0x2' }],
    [
      'invalid access list',
      { accessList: [{ address: TO, storageKeys: ['0x0'] }] },
    ],
  ])('rejects %s before controller or popup work', async (_label, fields) => {
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        ...(fields as any),
      })
    ).rejects.toMatchObject({ code: -32602 });
    expect(controllerMock).not.toHaveBeenCalled();
    expectNoRpcOrPopup();
  });

  it('also rejects invalid values through restrictedRPCMethods', async () => {
    await expect(
      EthProvider(HOST, readContext()).restrictedRPCMethods(
        'eth_sendTransaction',
        [{ ...transaction, value: 'invalid' }]
      )
    ).rejects.toMatchObject({ code: -32602 });
    expectNoRpcOrPopup();
  });

  it.each(['0x1', '0x3', '0x4'])(
    'rejects unsupported type %s before RPC work',
    async (type) => {
      await expect(
        EthProvider(HOST, readContext()).sendTransaction({
          ...transaction,
          type,
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expect(controllerMock).not.toHaveBeenCalled();
      expectNoRpcOrPopup();
    }
  );

  it('passes exact input, quantities and ordered access lists to decoding and approval', async () => {
    const slot = `0x${'55'.repeat(32)}`;
    const entry = { address: TO, storageKeys: [slot, slot] };
    const accessList = [entry, entry];
    const input = {
      from: FROM,
      to: TO,
      input: '0xa9059cbb',
      value: '9007199254740993123456789',
      gas: 90000,
      gasLimit: '0x015f90',
      maxFeePerGas: '5000000000',
      maxPriorityFeePerGas: 1,
      nonce: '0x0007',
      chainId: '1',
      type: '0x02',
      accessList,
    };
    const original = JSON.parse(JSON.stringify(input));

    await expect(
      EthProvider(HOST, readContext()).sendTransaction(input as any)
    ).resolves.toBe(HASH);

    const approvedTx = popupMock.mock.calls[0][0].data.tx;
    expect(approvedTx).toEqual({
      from: FROM,
      to: TO,
      data: '0xa9059cbb',
      value: `0x${BigInt(input.value).toString(16)}`,
      gas: '0x15f90',
      gasLimit: '0x15f90',
      maxFeePerGas: '0x12a05f200',
      maxPriorityFeePerGas: '0x1',
      nonce: '0x7',
      chainId: '0x1',
      type: '0x2',
      accessList,
    });
    expect(decodeMock).toHaveBeenCalledWith(approvedTx, rpc, wallet);
    expect(popupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: HOST,
        route: MethodRoute.SendEthTx,
        eventName: 'txSend',
        data: expect.objectContaining({
          tx: approvedTx,
          external: true,
          approvedContext: {
            account: {
              address: FROM,
              id: 0,
              type: KeyringAccountType.HDAccount,
            },
            chainId: 1,
            rpcUrl: 'https://rpc.example',
            sessionGeneration: 1,
            slip44: 60,
          },
        }),
      })
    );
    expect(input).toEqual(original);
  });

  it.each([{ type: '0x0' }, { gasPrice: '0x1' }])(
    'rejects unsupported smart-account legacy fees before RPC or approval: %p',
    async (fees) => {
      vault.accounts.HDAccount[0].isSmartAccount = true;
      await expect(
        EthProvider(HOST, readContext()).sendTransaction({
          ...transaction,
          ...fees,
          data: '0x',
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expectNoRpcOrPopup();
    }
  );

  it.each(['0x0', '0xba43b7400'])(
    'keeps an untyped gasPrice-only request legacy on an EIP-1559 network: %s',
    async (gasPrice) => {
      await EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        gasPrice,
        data: '0x',
      } as any);
      const data = popupMock.mock.calls[0][0].data;
      expect(data.tx.gasPrice).toBe(gasPrice);
      expect(data.tx.type).toBeUndefined();
      expect(data.txMetadata.isLegacyTx).toBe(true);
    }
  );

  it.each(['Example.eth', '🚀.eth', TO, null, undefined])(
    'preserves ENS, address and creation recipient %p',
    async (to) => {
      await EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        to,
        data: '0x60806040',
      } as any);
      expect(decodeMock.mock.calls[0][0].to).toBe(to);
      expect(popupMock.mock.calls[0][0].data.tx.to).toBe(to);
    }
  );

  it('injects only an omitted sender and preserves the supplied wallet account', async () => {
    await EthProvider(HOST, readContext()).sendTransaction({
      to: TO,
      value: 0,
    } as any);
    expect(connectedAccountMock).toHaveBeenCalledWith(HOST);
    expect(popupMock.mock.calls[0][0].data.tx).toMatchObject({
      from: FROM,
      value: '0x0',
    });

    jest.clearAllMocks();
    // The consent middleware has selected the dapp's requested wallet account.
    vault.accounts.HDAccount[0].address = OTHER_FROM;
    await EthProvider(HOST, readContext()).sendTransaction({
      ...transaction,
      from: OTHER_FROM,
    } as any);
    expect(connectedAccountMock).not.toHaveBeenCalled();
    expect(decodeMock.mock.calls[0][0].from).toBe(OTHER_FROM);
    expect(popupMock.mock.calls[0][0].data.tx.from).toBe(OTHER_FROM);
  });

  it('preserves a hex address with mixed case without adding checksum rejection', async () => {
    const to = `0x${'aB'.repeat(20)}`;
    await EthProvider(HOST, readContext()).sendTransaction({
      ...transaction,
      to,
    } as any);
    expect(popupMock.mock.calls[0][0].data.tx.to).toBe(to);
  });

  it('rejects a mismatched chain before RPC decoding or approval', async () => {
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        chainId: '0x2',
      } as any)
    ).rejects.toMatchObject({ code: -32602 });
    expectNoRpcOrPopup();
  });

  it('rejects a sender that is no longer selected after consent middleware', async () => {
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        data: '0x',
        from: OTHER_FROM,
      })
    ).rejects.toMatchObject({
      code: 4100,
      message: EVM_TRANSACTION_CONTEXT_CHANGED,
    });
    expectNoRpcOrPopup();
  });

  it.each(
    ['block', 'decode', 'coordinator'].flatMap((pauseAt) =>
      ['chain', 'rpc', 'account', 'flags', 'slip44', 'session'].map(
        (change) => [pauseAt, change]
      )
    )
  )(
    'rejects when %s work observes a changed %s context',
    async (pauseAt, change) => {
      let release!: () => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => (markStarted = resolve));
      const paused = new Promise<void>((resolve) => (release = resolve));
      const pause = async () => {
        markStarted();
        await paused;
      };
      if (pauseAt === 'block')
        rpc.getBlock.mockImplementationOnce(async () => {
          await pause();
          return { baseFeePerGas: '0x3b9aca00' };
        });
      if (pauseAt === 'decode')
        decodeMock.mockImplementationOnce(async () => {
          await pause();
          return { method: 'Contract Interaction' };
        });
      if (pauseAt === 'coordinator')
        coordinateMock.mockImplementationOnce(async (_context, openPopup) => {
          await pause();
          return openPopup();
        });

      const context = { originalRequest: {} } as any;
      const sending = EthProvider(HOST, context).sendTransaction({
        ...transaction,
        chainId: '0x1',
        nonce: '0x7',
        accessList: [{ address: TO, storageKeys: [] }],
      } as any);
      const rejection = expect(sending).rejects.toMatchObject({
        code: 4100,
        message: EVM_TRANSACTION_CONTEXT_CHANGED,
      });
      await started;
      if (change === 'chain') vault.activeNetwork.chainId = 2;
      if (change === 'rpc')
        vault.activeNetwork.url = 'https://other-rpc.example';
      if (change === 'account') {
        vault.accounts.SmartAccount = {
          1: { address: FROM, isSmartAccount: true },
        };
        vault.activeAccount = { type: KeyringAccountType.SmartAccount, id: 1 };
      }
      if (change === 'flags') vault.accounts.HDAccount[0].isLedgerWallet = true;
      if (change === 'slip44') vaultGlobal.activeSlip44 = 57;
      if (change === 'session') sessionGenerationMock.mockReturnValue(2);
      release();
      await rejection;
      expect(popupMock).not.toHaveBeenCalled();
      if (pauseAt === 'block') expect(decodeMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    [KeyringAccountType.Ledger, {}],
    [KeyringAccountType.Trezor, {}],
    [KeyringAccountType.SmartAccount, {}],
    [KeyringAccountType.HDAccount, { isLedgerWallet: true }],
    [KeyringAccountType.HDAccount, { isTrezorWallet: true }],
    [KeyringAccountType.HDAccount, { isSmartAccount: true }],
  ])(
    'rejects explicit nonce for unsupported account %s %p',
    async (type, flags) => {
      vault.activeAccount.type = type;
      vault.accounts[type] = { 0: { address: FROM, ...flags } };
      await expect(
        EthProvider(HOST, readContext()).sendTransaction({
          ...transaction,
          nonce: '0x0',
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expectNoRpcOrPopup();
    }
  );

  it('rejects nonempty access lists for smart accounts before RPC or approval', async () => {
    vault.activeAccount.type = KeyringAccountType.SmartAccount;
    vault.accounts.SmartAccount = { 0: { address: FROM } };
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        type: '0x2',
        accessList: [{ address: TO, storageKeys: [] }],
      } as any)
    ).rejects.toMatchObject({ code: 4200 });
    expectNoRpcOrPopup();
  });

  it('rejects explicit type 2 on a legacy network before decoding or approval', async () => {
    rpc.getBlock.mockResolvedValue({});
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        type: '0x2',
      } as any)
    ).rejects.toMatchObject({ code: 4200 });
    expect(rpc.getBlock).toHaveBeenCalledWith('latest');
    expect(decodeMock).not.toHaveBeenCalled();
    expect(popupMock).not.toHaveBeenCalled();
  });

  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'rejects untyped %s on a legacy network before decoding or approval',
    async (field) => {
      rpc.getBlock.mockResolvedValue({});
      const context = { originalRequest: {} } as any;
      await expect(
        EthProvider(HOST, context).sendTransaction({
          ...transaction,
          [field]: '0x1',
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expect(rpc.getBlock).toHaveBeenCalledTimes(1);
      expect(rpc.getBlock).toHaveBeenCalledWith('latest');
      expect(rpc.send).not.toHaveBeenCalled();
      expect(decodeMock).not.toHaveBeenCalled();
      expect(coordinateMock).not.toHaveBeenCalled();
      expect(popupMock).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, '0x0'])(
    'rejects an untyped zero maximum fee with priority %s before RPC work',
    async (priority) => {
      await expect(
        EthProvider(HOST, readContext()).sendTransaction({
          ...transaction,
          maxFeePerGas: '0x0',
          ...(priority === undefined ? {} : { maxPriorityFeePerGas: priority }),
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expect(controllerMock).not.toHaveBeenCalled();
      expectNoRpcOrPopup();
    }
  );

  it('rejects an untyped zero priority fee on a legacy network after checking compatibility', async () => {
    rpc.getBlock.mockResolvedValue({});
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        maxPriorityFeePerGas: '0x0',
      } as any)
    ).rejects.toMatchObject({ code: 4200 });
    expect(rpc.getBlock).toHaveBeenCalledTimes(1);
    expect(rpc.getBlock).toHaveBeenCalledWith('latest');
    expect(rpc.send).not.toHaveBeenCalled();
    expect(decodeMock).not.toHaveBeenCalled();
    expect(coordinateMock).not.toHaveBeenCalled();
    expect(popupMock).not.toHaveBeenCalled();
  });

  it('preserves an untyped positive fee cap and zero priority for London approval', async () => {
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        maxFeePerGas: '0x77359400',
        maxPriorityFeePerGas: '0x0',
      } as any)
    ).resolves.toBe(HASH);
    const data = popupMock.mock.calls[0][0].data;
    expect(data.tx).toEqual({
      ...transaction,
      data: '0x',
      maxFeePerGas: '0x77359400',
      maxPriorityFeePerGas: '0x0',
    });
    expect(data.txMetadata.isLegacyTx).toBe(false);
    expect(decodeMock).toHaveBeenCalledWith(data.tx, rpc, wallet);
  });

  it('preserves untyped gasPrice-only requests on a legacy network', async () => {
    rpc.getBlock.mockResolvedValue({});
    await expect(
      EthProvider(HOST, readContext()).sendTransaction({
        ...transaction,
        gasPrice: '0x3b9aca00',
      } as any)
    ).resolves.toBe(HASH);
    const data = popupMock.mock.calls[0][0].data;
    expect(data.tx).toEqual({
      ...transaction,
      data: '0x',
      gasPrice: '0x3b9aca00',
    });
    expect(data.txMetadata.isLegacyTx).toBe(true);
  });

  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'preserves untyped %s for EIP-1559 approval',
    async (field) => {
      await expect(
        EthProvider(HOST, readContext()).sendTransaction({
          ...transaction,
          [field]: '0x1',
        } as any)
      ).resolves.toBe(HASH);
      const data = popupMock.mock.calls[0][0].data;
      expect(data.tx).toEqual({ ...transaction, data: '0x', [field]: '0x1' });
      expect(data.txMetadata.isLegacyTx).toBe(false);
      expect(decodeMock).toHaveBeenCalledWith(data.tx, rpc, wallet);
    }
  );

  it('uses the request coordinator with the normalized transaction', async () => {
    const context = { originalRequest: { sender: { tab: { id: 7 } } } } as any;
    await EthProvider(HOST, context).sendTransaction({
      ...transaction,
      value: 0,
    } as any);
    expect(coordinateMock).toHaveBeenCalledWith(
      context,
      expect.any(Function),
      MethodRoute.SendEthTx
    );
    expect(popupMock.mock.calls[0][0]).toMatchObject({
      sender: context.originalRequest.sender,
      data: { tx: { value: '0x0' } },
    });
  });
});
