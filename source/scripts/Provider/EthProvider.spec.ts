jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock(
  'scripts/Background/controllers/message-handler/method-registry',
  () => ({ getUnrestrictedMethods: () => [] })
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

import { getController } from 'scripts/Background';
import { popupPromise } from 'scripts/Background/controllers/message-handler/popup-promise';
import { requestCoordinator } from 'scripts/Background/controllers/message-handler/request-pipeline';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
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

beforeEach(() => {
  jest.clearAllMocks();
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
      EthProvider(HOST).sendTransaction({
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
      EthProvider(HOST).sendTransaction({ ...transaction, ...(fields as any) })
    ).rejects.toMatchObject({ code: -32602 });
    expect(controllerMock).not.toHaveBeenCalled();
    expectNoRpcOrPopup();
  });

  it('also rejects invalid values through restrictedRPCMethods', async () => {
    await expect(
      EthProvider(HOST).restrictedRPCMethods('eth_sendTransaction', [
        { ...transaction, value: 'invalid' },
      ])
    ).rejects.toMatchObject({ code: -32602 });
    expectNoRpcOrPopup();
  });

  it.each(['0x1', '0x3', '0x4'])(
    'rejects unsupported type %s before RPC work',
    async (type) => {
      await expect(
        EthProvider(HOST).sendTransaction({ ...transaction, type } as any)
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

    await expect(EthProvider(HOST).sendTransaction(input as any)).resolves.toBe(
      HASH
    );

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
        EthProvider(HOST).sendTransaction({
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
      await EthProvider(HOST).sendTransaction({
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
      await EthProvider(HOST).sendTransaction({
        ...transaction,
        to,
        data: '0x60806040',
      } as any);
      expect(decodeMock.mock.calls[0][0].to).toBe(to);
      expect(popupMock.mock.calls[0][0].data.tx.to).toBe(to);
    }
  );

  it('injects only an omitted sender and preserves the supplied wallet account', async () => {
    await EthProvider(HOST).sendTransaction({ to: TO, value: 0 } as any);
    expect(connectedAccountMock).toHaveBeenCalledWith(HOST);
    expect(popupMock.mock.calls[0][0].data.tx).toMatchObject({
      from: FROM,
      value: '0x0',
    });

    jest.clearAllMocks();
    // The consent middleware has selected the dapp's requested wallet account.
    vault.accounts.HDAccount[0].address = OTHER_FROM;
    await EthProvider(HOST).sendTransaction({
      ...transaction,
      from: OTHER_FROM,
    } as any);
    expect(connectedAccountMock).not.toHaveBeenCalled();
    expect(decodeMock.mock.calls[0][0].from).toBe(OTHER_FROM);
    expect(popupMock.mock.calls[0][0].data.tx.from).toBe(OTHER_FROM);
  });

  it('preserves a hex address with mixed case without adding checksum rejection', async () => {
    const to = `0x${'aB'.repeat(20)}`;
    await EthProvider(HOST).sendTransaction({ ...transaction, to } as any);
    expect(popupMock.mock.calls[0][0].data.tx.to).toBe(to);
  });

  it('rejects a mismatched chain before RPC decoding or approval', async () => {
    await expect(
      EthProvider(HOST).sendTransaction({
        ...transaction,
        chainId: '0x2',
      } as any)
    ).rejects.toMatchObject({ code: -32602 });
    expectNoRpcOrPopup();
  });

  it('rejects a sender that is no longer selected after consent middleware', async () => {
    await expect(
      EthProvider(HOST).sendTransaction({
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
        EthProvider(HOST).sendTransaction({
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
      EthProvider(HOST).sendTransaction({
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
      EthProvider(HOST).sendTransaction({ ...transaction, type: '0x2' } as any)
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

  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'rejects untyped zero %s before querying network compatibility',
    async (field) => {
      rpc.getBlock.mockResolvedValue({});
      await expect(
        EthProvider(HOST).sendTransaction({
          ...transaction,
          [field]: '0x0',
        } as any)
      ).rejects.toMatchObject({ code: 4200 });
      expect(controllerMock).not.toHaveBeenCalled();
      expectNoRpcOrPopup();
    }
  );

  it('preserves untyped gasPrice-only requests on a legacy network', async () => {
    rpc.getBlock.mockResolvedValue({});
    await expect(
      EthProvider(HOST).sendTransaction({
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
        EthProvider(HOST).sendTransaction({
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
