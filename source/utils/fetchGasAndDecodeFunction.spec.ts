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
let pendingBlock: any;
let networkFees: any;
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
  pendingBlock = { gasLimit: '30000000', baseFeePerGas: '1000000000' };
  networkFees = {
    gasPrice: BigNumber.from('2000000000'),
    maxFeePerGas: BigNumber.from('3000000000'),
    maxPriorityFeePerGas: BigNumber.from('1000000000'),
  };
  emitterMock.mockImplementation(async (path, args) => {
    switch (path.join('.')) {
      case 'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas':
        return networkFees;
      case 'wallet.getRecommendedEvmNonce':
        return 9;
      case 'wallet.ethereumTransaction.web3Provider.send':
        if (args[0] === 'eth_getBlockByNumber') return pendingBlock;
        if (args[0] === 'eth_estimateGas') return BigNumber.from(estimatedGas);
        if (args[0] === 'eth_call') return '0x';
        throw new Error('Unexpected RPC method');
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
const rpcCalls = (method: string) =>
  callsFor('wallet.ethereumTransaction.web3Provider.send').filter(
    ([, args]) => args[0] === method
  );

describe('dapp transaction fee preparation', () => {
  it.each([
    'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas',
    'wallet.ethereumTransaction.web3Provider.send',
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
    pendingBlock.gasLimit = estimatedGas;
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
    expect(rpcCalls('eth_call')[0][1]).toEqual([
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
    expect(rpcCalls('eth_estimateGas')[0][1]).toEqual([
      'eth_estimateGas',
      [
        {
          from: FROM,
          to: TO,
          data,
          value,
          nonce: '0x7',
          accessList,
        },
      ],
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

  it.each([21000, 42000, 58000, 70000])(
    'preserves exact sufficient app gas %s without the SDK margin or wallet floor',
    async (gas) => {
      estimatedGas = gas;
      const result = await prepare({ gas, gasPrice: '2000000000' });
      expect(result.formTx.gasLimit.toString()).toBe(String(gas));
      expect(result.feeDetails.minimumGasLimit).toBe(gas);
      expect(result.feeSafety.gasLimit).toBeUndefined();
      expect(callsFor('wallet.ethereumTransaction.getTxGasLimit')).toHaveLength(
        0
      );
    }
  );

  it('uses a recommendation margin only when app gas is omitted', async () => {
    estimatedGas = 21000;
    const result = await prepare();
    expect(result.formTx.gasLimit.toString()).toBe('25200');
    expect(result.feeDetails.minimumGasLimit).toBe(21000);
    expect(result.feeSafety.gasLimit).toBeUndefined();
  });

  it('preserves a valid app fee cap below the SDK recommendation and displays the actual base fee', async () => {
    const result = await prepare({
      type: '0x2',
      gas: 70000,
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '1000000000',
    });
    expect(result.formTx.maxFeePerGas.toString()).toBe('2000000000');
    expect(result.feeDetails.baseFee).toBe(1);
    expect(result.feeSafety.maxFeePerGas).toEqual({
      requested: 2,
      recommended: 3,
    });
    expect(result.recommendationOnly).toBe(true);
  });

  it('does not replace a structurally valid app tip with an unknown miner-floor suggestion', async () => {
    const result = await prepare({
      type: '0x2',
      gas: 70000,
      maxFeePerGas: '1000000000',
      maxPriorityFeePerGas: '0',
    });
    expect(result.formTx.maxFeePerGas.toString()).toBe('1000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('0');
    expect(result.feeSafety.maxPriorityFeePerGas).toEqual({
      requested: 0,
      recommended: 1,
    });
    expect(result.recommendationOnly).toBe(true);
  });

  it('preserves a valid legacy app price below eth_gasPrice without claiming miner inclusion', async () => {
    const result = await prepare({ gas: 70000, gasPrice: '1500000000' });
    expect(result.formTx.gasPrice).toBe('1500000000');
    expect(result.feeSafety.gasPrice).toEqual({
      requested: 1.5,
      recommended: 2,
    });
    expect(result.recommendationOnly).toBe(true);
  });

  it('recommends raising a legacy price below the actual pending base fee', async () => {
    const result = await prepare({ gas: 70000, gasPrice: '500000000' });
    expect(result.formTx.gasPrice).toBe('2000000000');
    expect(result.recommendationOnly).toBe(false);
    expect(rpcCalls('eth_estimateGas')[0][1][1][0]).not.toHaveProperty(
      'gasPrice'
    );
  });

  it('retains affirmative legacy-chain pricing without synthesizing EIP-1559 fees', async () => {
    delete pendingBlock.baseFeePerGas;
    networkFees.maxFeePerGas = BigNumber.from(0);
    networkFees.maxPriorityFeePerGas = BigNumber.from(0);
    const result = await prepare({ gas: 70000, gasPrice: '1500000000' });
    expect(result.formTx.gasPrice).toBe('1500000000');
    expect(rpcCalls('eth_estimateGas')[0][1][1][0]).not.toHaveProperty('type');
    await expect(prepare({ type: '0x2' })).rejects.toThrow(
      'EIP-1559 fees are unavailable'
    );
  });

  it('accepts SDK fee quantities after the actual Chrome JSON messaging boundary', async () => {
    networkFees = JSON.parse(JSON.stringify(networkFees));
    expect(networkFees.gasPrice).toEqual({
      type: 'BigNumber',
      hex: '0x77359400',
    });
    const result = await prepare({
      gas: 70000,
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '0',
    });
    expect(result.formTx.maxFeePerGas.toString()).toBe('2000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('0');
    expect(result.formTx.gasLimit.toString()).toBe('70000');
    expect(result.recommendationOnly).toBe(true);
  });

  it('accepts serialized SDK gasPrice and zero-cap legacy fee data', async () => {
    delete pendingBlock.baseFeePerGas;
    networkFees.maxFeePerGas = BigNumber.from(0);
    networkFees.maxPriorityFeePerGas = BigNumber.from(0);
    networkFees = JSON.parse(JSON.stringify(networkFees));
    const result = await prepare({ gas: 70000, gasPrice: '1500000000' });
    expect(result.formTx.gasPrice).toBe('1500000000');
    expect(result.recommendationOnly).toBe(true);
  });

  it.each([
    { type: 'BigNumber' },
    { type: 'BigNumber', hex: '' },
    { type: 'BigNumber', hex: 'malformed' },
    { type: 'BigNumber', hex: '2000000000' },
    { type: 'BigNumber', hex: '-0x1' },
    { type: 'BigNumber', hex: `0x1${'00'.repeat(32)}` },
    { hex: '0x77359400' },
  ])(
    'rejects malformed serialized SDK fee data %j without estimating',
    async (value) => {
      networkFees.gasPrice = value;
      await expect(prepare()).rejects.toThrow('Invalid network gas price');
      expect(rpcCalls('eth_estimateGas')).toHaveLength(0);
    }
  );

  it.each(['null', 'absent'])(
    'accepts gasPrice-only legacy fee data with %s EIP-1559 fields',
    async (shape) => {
      delete pendingBlock.baseFeePerGas;
      networkFees = { gasPrice: BigNumber.from('2000000000') };
      if (shape === 'null') {
        networkFees.baseFeePerGas = null;
        networkFees.maxFeePerGas = null;
        networkFees.maxPriorityFeePerGas = null;
      }
      const result = await prepare({ gas: 70000 });
      expect(result.formTx.gasPrice).toBe('2000000000');
      expect(result.feeDetails).toMatchObject({ gasPrice: 2, baseFee: 0 });
      expect(rpcCalls('eth_estimateGas')).toHaveLength(1);
      await expect(prepare({ type: '0x2' })).rejects.toThrow(
        'EIP-1559 fees are unavailable'
      );
    }
  );

  it.each(['null', 'absent'])(
    'preserves an explicit legacy app price with %s EIP-1559 fields',
    async (shape) => {
      pendingBlock.baseFeePerGas = null;
      networkFees = { gasPrice: BigNumber.from('2000000000') };
      if (shape === 'null') {
        networkFees.baseFeePerGas = null;
        networkFees.maxFeePerGas = null;
        networkFees.maxPriorityFeePerGas = null;
      }
      const result = await prepare({
        gas: 70000,
        gasPrice: '1500000000',
        type: '0x0',
      });
      expect(result.formTx.gasPrice).toBe('1500000000');
      expect(result.recommendationOnly).toBe(true);
      expect(result.feeSafety.gasPrice).toEqual({
        requested: 1.5,
        recommended: 2,
      });
    }
  );

  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'does not default a null post-London %s even for an explicit legacy request',
    async (field) => {
      networkFees[field] = null;
      await expect(
        prepare({ gas: 70000, gasPrice: '1500000000', type: '0x0' })
      ).rejects.toThrow('Invalid network');
      expect(rpcCalls('eth_estimateGas')).toHaveLength(0);
    }
  );

  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'does not default a malformed legacy-network %s',
    async (field) => {
      delete pendingBlock.baseFeePerGas;
      networkFees = { gasPrice: BigNumber.from('2000000000') };
      networkFees[field] = 'malformed';
      await expect(prepare()).rejects.toThrow('Invalid network');
      expect(rpcCalls('eth_estimateGas')).toHaveLength(0);
    }
  );

  it('refuses a missing post-London basefee instead of silently switching to legacy', async () => {
    delete pendingBlock.baseFeePerGas;
    await expect(prepare()).rejects.toThrow('Inconsistent network fee data');
  });

  it('rejects a priority fee above the requested cap instead of changing the request', async () => {
    await expect(
      prepare({ type: '0x2', maxFeePerGas: '1', maxPriorityFeePerGas: '2' })
    ).rejects.toThrow('Invalid dApp priority fee exceeds fee cap');
  });

  it.each(['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'])(
    'fails closed when actual network %s is missing',
    async (field) => {
      delete networkFees[field];
      await expect(prepare()).rejects.toThrow('Invalid network');
      expect(rpcCalls('eth_estimateGas')).toHaveLength(0);
    }
  );

  it.each(['eth_getBlockByNumber', 'eth_estimateGas'])(
    'never invents a quote when %s fails',
    async (method) => {
      const execute = emitterMock.getMockImplementation()!;
      const failure = new Error('RPC unavailable');
      emitterMock.mockImplementation((path, args) => {
        if (
          path.join('.') === 'wallet.ethereumTransaction.web3Provider.send' &&
          args[0] === method
        )
          throw failure;
        return execute(path, args);
      });
      await expect(prepare()).rejects.toBe(failure);
    }
  );

  it('never invents a recommendation when the fee-data RPC fails', async () => {
    const execute = emitterMock.getMockImplementation()!;
    const failure = new Error('Fee provider unavailable');
    emitterMock.mockImplementation((path, args) => {
      if (
        path.join('.') ===
        'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas'
      )
        throw failure;
      return execute(path, args);
    });
    await expect(prepare()).rejects.toBe(failure);
    expect(rpcCalls('eth_estimateGas')).toHaveLength(0);
  });

  it('estimates the exact smart-account inner call without imposing EOA gas-payer affordability', async () => {
    state.vault.accounts.HDAccount[0].isSmartAccount = true;
    state.vault.accounts.HDAccount[0].smartAccount = { chainId: 1 };
    const result = await prepare({ gasPrice: '1500000000', gas: 70000 });
    const request = rpcCalls('eth_estimateGas')[0][1][1][0];
    expect(request).toMatchObject({
      from: FROM,
      to: TO,
      value: '0x0',
      data: '0x',
    });
    expect(request).not.toHaveProperty('gasPrice');
    expect(request).not.toHaveProperty('maxFeePerGas');
    expect(request).not.toHaveProperty('maxPriorityFeePerGas');
    expect(result.formTx.gasPrice).toBe('1500000000');
  });

  it('keeps gas estimation fee-neutral when zkSYS rejects a fee-inflated omitted-gas affordability ceiling', async () => {
    const execute = emitterMock.getMockImplementation()!;
    estimatedGas = 21000;
    emitterMock.mockImplementation((path, args) => {
      if (
        path.join('.') === 'wallet.ethereumTransaction.web3Provider.send' &&
        args[0] === 'eth_estimateGas'
      ) {
        const request = args[1][0];
        if (
          request.gasPrice !== undefined ||
          request.maxFeePerGas !== undefined ||
          request.maxPriorityFeePerGas !== undefined
        )
          throw new Error('LackOfFundForMaxFee at the RPC-derived gas ceiling');
      }
      return execute(path, args);
    });
    const result = await prepare({
      gas: 21000,
      type: '0x2',
      maxFeePerGas: '2000000000',
      maxPriorityFeePerGas: '1000000000',
    });
    expect(result.formTx.gasLimit.toString()).toBe('21000');
    expect(result.formTx.maxFeePerGas.toString()).toBe('2000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('1000000000');
    expect(rpcCalls('eth_estimateGas')).toHaveLength(1);
  });

  it.each([5700, 57057])(
    'retains source-bound fees and raw gas on chain %s without chain-specific overrides',
    async (chainId) => {
      const selectedNetwork = { ...network, chainId };
      state.vault.activeNetwork = selectedNetwork;
      estimatedGas = 21000;
      const result = await fetchGasAndDecodeFunction(
        {
          from: FROM,
          to: TO,
          value: '0x0',
          data: '0x',
          gas: '0x5208',
          gasPrice: '1500000000',
          chainId,
        } as ITransactionParams,
        selectedNetwork
      );
      expect(result.formTx.chainId).toBe(chainId);
      expect(result.formTx.gasPrice).toBe('1500000000');
      expect(result.formTx.gasLimit.toString()).toBe('21000');
      expect(result.recommendationOnly).toBe(true);
    }
  );

  it.each(['eth_call', 'eth_estimateGas'])(
    'checks the wallet context after the %s result, not only the pending-header read',
    async (method) => {
      const execute = emitterMock.getMockImplementation()!;
      emitterMock.mockImplementation(async (path, args) => {
        const result = await execute(path, args);
        if (
          path.join('.') === 'wallet.ethereumTransaction.web3Provider.send' &&
          args[0] === method
        )
          state.vault.activeNetwork.url = 'https://changed-rpc.example';
        return result;
      });
      await expect(
        prepare({ data: '0xa9059cbb' }, approvedContext)
      ).rejects.toThrow(EVM_TRANSACTION_CONTEXT_CHANGED);
    }
  );

  it.each([null, undefined, '1.5', '-1', 'garbage', '0x0'])(
    'refuses malformed or missing actual gas %s even when app gas exists',
    async (invalidGas) => {
      const execute = emitterMock.getMockImplementation()!;
      emitterMock.mockImplementation((path, args) => {
        if (
          path.join('.') === 'wallet.ethereumTransaction.web3Provider.send' &&
          args[0] === 'eth_estimateGas'
        )
          return invalidGas;
        return execute(path, args);
      });
      await expect(prepare({ gas: 70000 })).rejects.toThrow(
        'Invalid transaction gas limit'
      );
    }
  );

  it('reports gas and fee increases for low dapp requests instead of losing the requested values', async () => {
    const result = await prepare({
      type: '0x2',
      gas: '0x5208',
      maxFeePerGas: '0x0',
      maxPriorityFeePerGas: '0x0',
    });
    expect(result.formTx.gasLimit.toString()).toBe('84000');
    expect(result.formTx.maxFeePerGas.toString()).toBe('3000000000');
    expect(result.formTx.maxPriorityFeePerGas.toString()).toBe('0');
    expect(result.feeSafety).toMatchObject({
      gasLimit: { requested: 21000, recommended: 84000 },
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
    expect(rpcCalls('eth_call')).toHaveLength(0);
    expect(rpcCalls('eth_estimateGas')).toHaveLength(1);
  });

  it('estimates contract creation without a destination while preserving initcode', async () => {
    const data = '0x608060405260006000f3';
    const result = await prepare({ to: null, data, nonce: '0x0' });
    expect(result.formTx.to).toBeNull();
    expect(result.formTx.data).toBe(data);
    expect(rpcCalls('eth_call')[0][1]).toEqual([
      'eth_call',
      [{ from: FROM, data, value: '0x0', nonce: '0x0' }, 'latest'],
    ]);
    expect(rpcCalls('eth_estimateGas')[0][1][1][0]).toMatchObject({
      from: FROM,
      to: null,
      data,
      nonce: '0x0',
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
      'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas',
      'wallet.getRecommendedEvmNonce',
      'wallet.ethereumTransaction.web3Provider.send',
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
