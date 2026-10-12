jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { INetwork, KeyringAccountType } from 'types/network';
import { ITransactionParams } from 'types/transactions';
import { BigNumber } from 'utils/ethersV6Compat';
import {
  EVM_TRANSACTION_CONTEXT_CHANGED,
  IEvmTransactionContext,
} from 'utils/evmTransactionContext';

import { fetchGasAndDecodeFunction } from './fetchGasAndDecodeFunction';

const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const network = { chainId: 1, url: 'https://rpc.example' } as INetwork;
const approvedContext: IEvmTransactionContext = {
  account: { address: FROM, id: 0, type: KeyringAccountType.HDAccount },
  chainId: 1,
  rpcUrl: network.url,
  sessionGeneration: 1,
  slip44: 60,
};
const emitterMock = controllerEmitter as jest.Mock;
let estimatedGas: number | string;
let state: any;

beforeEach(() => {
  jest.clearAllMocks();
  state = {
    vault: {
      isBitcoinBased: false,
      activeNetwork: { ...network },
      activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
      accounts: { HDAccount: { 0: { address: FROM } } },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  (store.getState as jest.Mock).mockImplementation(() => state);
  estimatedGas = 70000;
  emitterMock.mockImplementation(async (path, args) => {
    switch (path.join('.')) {
      case 'wallet.getCurrentBlock':
        return { gasLimit: '30000000', baseFeePerGas: '1000000000' };
      case 'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas':
        return {
          gasPrice: BigNumber.from('2000000000'),
          maxFeePerGas: BigNumber.from('3000000000'),
          maxPriorityFeePerGas: BigNumber.from('1000000000'),
        };
      case 'wallet.getRecommendedEvmNonce':
        return 9;
      case 'wallet.ethereumTransaction.web3Provider.send':
        if (args[0] !== 'eth_call') throw new Error('Unexpected RPC method');
        return '0x';
      case 'wallet.ethereumTransaction.getTxGasLimit':
        return BigNumber.from(estimatedGas);
      default:
        throw new Error(`Unexpected controller operation ${path.join('.')}`);
    }
  });
});

const prepare = (
  fields: Record<string, unknown> = {},
  context?: IEvmTransactionContext
) =>
  fetchGasAndDecodeFunction(
    {
      from: FROM,
      to: TO,
      data: '0x',
      value: '0x0',
      ...fields,
    } as ITransactionParams,
    network,
    context
  );

const callsFor = (operation: string) =>
  emitterMock.mock.calls.filter(([path]) => path.join('.') === operation);

describe('dapp transaction fee preparation', () => {
  it.each([
    'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas',
    'wallet.ethereumTransaction.web3Provider.send',
    'wallet.ethereumTransaction.getTxGasLimit',
  ])(
    'propagates a flattened RPC integrity error from %s without inventing a quote',
    async (operation) => {
      const previous = emitterMock.getMockImplementation();
      const error = new Error(
        '[SYSWEB3_RPC_RESPONSE_INVALID] Wrong response id'
      );
      emitterMock.mockImplementation((path, args) => {
        if (path.join('.') === operation) throw error;
        return previous(path, args);
      });
      await expect(prepare({ to: undefined, data: '0x60016000' })).rejects.toBe(
        error
      );
    }
  );

  it.each([
    ['inexact', (BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)).toString()],
    ['overflowing', `0x${'ff'.repeat(512)}`],
  ])(
    'rejects an unsafe estimated gas limit before creating fee state (%s)',
    async (_case, gasLimit) => {
      estimatedGas = gasLimit;
      await expect(
        prepare({ to: undefined, data: '0x60016000' })
      ).rejects.toThrow('Invalid transaction gas limit');
    }
  );

  it('rejects a wide provided gas limit without rounding or replacing the approved gas', async () => {
    await expect(
      prepare({ gas: `0x${(BigInt(1) << BigInt(200)).toString(16)}` })
    ).rejects.toThrow('Invalid transaction gas limit');
  });

  it('keeps the exact largest supported numeric gas limit', async () => {
    estimatedGas = String(Number.MAX_SAFE_INTEGER);
    const result = await prepare();
    expect(result.feeDetails.gasLimit).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.formTx.gasLimit.toString()).toBe(
      String(Number.MAX_SAFE_INTEGER)
    );
  });

  it('preserves exact calldata, wide values, explicit nonce and ordered duplicate access lists', async () => {
    const slot = `0x${'33'.repeat(32)}`;
    const secondSlot = `0x${'44'.repeat(32)}`;
    const accessList = [
      { address: TO, storageKeys: [slot, slot, secondSlot] },
      { address: TO, storageKeys: [slot] },
    ];
    const value = `0x${(BigInt(1) << BigInt(200)).toString(16)}`;
    const data = '0xa9059cbb00010200ff';
    const result = await prepare({
      data,
      value,
      nonce: '0x7',
      type: '0x2',
      gasLimit: '0x15f90',
      maxFeePerGas: '0x12a05f200',
      maxPriorityFeePerGas: '0x77359400',
      accessList,
    });

    expect(result.formTx).toMatchObject({
      from: FROM,
      to: TO,
      data,
      nonce: 7,
      accessList,
      type: '0x2',
    });
    expect(result.formTx.value.toString()).toBe(BigInt(value).toString());
    expect(result.formTx.gasLimit.toString()).toBe('90000');
    expect(result.formTx.maxFeePerGas.toString()).toBe('5000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('2000000000');
    expect(result.nonce).toBe(7);
    expect(callsFor('wallet.getRecommendedEvmNonce')).toHaveLength(0);
    expect(
      callsFor('wallet.ethereumTransaction.web3Provider.send')[0][1]
    ).toEqual([
      'eth_call',
      [
        {
          from: FROM,
          to: TO,
          data,
          value,
          nonce: '0x7',
          type: '0x2',
          accessList,
        },
        'latest',
      ],
    ]);
    expect(callsFor('wallet.ethereumTransaction.getTxGasLimit')[0][1]).toEqual([
      { from: FROM, to: TO, data, value, nonce: 7, accessList },
    ]);
    expect(result.feeSafety.gasLimit).toBeUndefined();
    expect(result.gasLimitError).toBe(false);
    expect(result.isInvalidTxData).toBe(false);
  });

  it('honors explicit legacy type even when the dapp omits gasPrice', async () => {
    const result = await prepare({ type: '0x0', gas: '0x15f90' });
    expect(result.formTx.gasPrice).toBe('2000000000');
    expect(result.formTx.type).toBe('0x0');
    expect(result.feeDetails).toMatchObject({
      gasLimit: 90000,
      gasPrice: 2,
      baseFee: 0,
    });
    expect(result.formTx.gasLimit.toString()).toBe('90000');
  });

  it.each(['gas', 'gasLimit'])(
    'preserves a sufficient dapp %s request',
    async (field) => {
      const result = await prepare({
        [field]: '0x15f90',
        gasPrice: '0xee6b2800',
      });
      expect(result.formTx.gasLimit.toString()).toBe('90000');
      expect(result.formTx.gasPrice).toBe('4000000000');
      expect(result.feeDetails).toMatchObject({ gasLimit: 90000, gasPrice: 4 });
      expect(result.feeSafety.gasLimit).toBeUndefined();
      expect(result.feeSafety.gasPrice).toBeUndefined();
    }
  );

  it('reports gas and fee increases for low dapp requests instead of losing the requested values', async () => {
    const result = await prepare({
      type: '0x2',
      gas: '0x5208',
      maxFeePerGas: '0x0',
      maxPriorityFeePerGas: '0x0',
    });
    expect(result.formTx.gasLimit.toString()).toBe('70000');
    expect(result.formTx.maxFeePerGas.toString()).toBe('3000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('1000000000');
    expect(result.feeSafety).toMatchObject({
      gasLimit: { requested: 21000, recommended: 70000 },
      maxFeePerGas: { requested: 0, recommended: 3 },
      maxPriorityFeePerGas: { requested: 0, recommended: 1 },
    });
  });

  it('uses a recommended nonce only when nonce was omitted', async () => {
    const result = await prepare();
    expect(result.nonce).toBe(9);
    expect(result.formTx.nonce).toBe(9);
    expect(callsFor('wallet.getRecommendedEvmNonce')).toEqual([
      [['wallet', 'getRecommendedEvmNonce'], [FROM]],
    ]);
    expect(
      callsFor('wallet.ethereumTransaction.web3Provider.send')
    ).toHaveLength(0);
  });

  it('estimates contract creation without a destination while preserving initcode', async () => {
    const data = '0x608060405260006000f3';
    const result = await prepare({ to: null, data, nonce: '0x0' });
    expect(result.formTx.to).toBeNull();
    expect(result.formTx.data).toBe(data);
    expect(
      callsFor('wallet.ethereumTransaction.web3Provider.send')[0][1]
    ).toEqual([
      'eth_call',
      [{ from: FROM, data, value: '0x0', nonce: '0x0' }, 'latest'],
    ]);
    expect(
      callsFor('wallet.ethereumTransaction.getTxGasLimit')[0][1][0]
    ).toMatchObject({
      from: FROM,
      to: null,
      data,
      nonce: 0,
    });
  });

  it('rejects a requested chain mismatch before any background work', async () => {
    await expect(prepare({ chainId: '0x2' }, approvedContext)).rejects.toThrow(
      EVM_TRANSACTION_CONTEXT_CHANGED
    );
    expect(emitterMock).not.toHaveBeenCalled();
  });

  it('rejects preparing an original approval against a newly selected network', async () => {
    state.vault.activeNetwork.chainId = 2;
    await expect(
      fetchGasAndDecodeFunction(
        {
          from: FROM,
          to: TO,
          data: '0x',
          chainId: '0x1',
        } as ITransactionParams,
        state.vault.activeNetwork,
        approvedContext
      )
    ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    expect(emitterMock).not.toHaveBeenCalled();
  });

  it.each(
    [
      'wallet.getCurrentBlock',
      'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas',
      'wallet.getRecommendedEvmNonce',
      'wallet.ethereumTransaction.web3Provider.send',
      'wallet.ethereumTransaction.getTxGasLimit',
    ].flatMap((operation) =>
      ['chain', 'rpc', 'account', 'flags', 'slip44'].map((change) => [
        operation,
        change,
      ])
    )
  )(
    'rejects a stale approval after delayed %s changes %s',
    async (operation, change) => {
      const execute = emitterMock.getMockImplementation()!;
      let release!: () => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => (markStarted = resolve));
      const paused = new Promise<void>((resolve) => (release = resolve));
      emitterMock.mockImplementation(async (path, args) => {
        if (path.join('.') === operation) {
          markStarted();
          await paused;
        }
        return execute(path, args);
      });
      const preparing = prepare(
        {
          chainId: '0x1',
          data: '0xa9059cbb',
          accessList: [{ address: TO, storageKeys: [] }],
        },
        approvedContext
      );
      const rejection = expect(preparing).rejects.toThrow(
        EVM_TRANSACTION_CONTEXT_CHANGED
      );
      await started;
      if (change === 'chain') state.vault.activeNetwork.chainId = 2;
      if (change === 'rpc')
        state.vault.activeNetwork.url = 'https://other-rpc.example';
      if (change === 'account') {
        state.vault.accounts.SmartAccount = {
          1: { address: FROM, isSmartAccount: true },
        };
        state.vault.activeAccount = {
          type: KeyringAccountType.SmartAccount,
          id: 1,
        };
      }
      if (change === 'flags')
        state.vault.accounts.HDAccount[0].isSmartAccount = true;
      if (change === 'slip44') state.vaultGlobal.activeSlip44 = 57;
      release();
      await rejection;
      const calls = emitterMock.mock.calls;
      expect(calls[calls.length - 1][0].join('.')).toBe(operation);
    }
  );

  it.each([
    'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas',
    'wallet.ethereumTransaction.web3Provider.send',
    'wallet.ethereumTransaction.getTxGasLimit',
  ])(
    'does not swallow a context change when %s also rejects',
    async (operation) => {
      const execute = emitterMock.getMockImplementation()!;
      emitterMock.mockImplementation(async (path, args) => {
        if (path.join('.') === operation) {
          state.vault.activeNetwork.chainId = 2;
          throw new Error('RPC stopped during the network switch');
        }
        return execute(path, args);
      });
      await expect(
        prepare({ data: '0xa9059cbb' }, approvedContext)
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    }
  );
});
