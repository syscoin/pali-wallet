jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));

// Each host has its own TypeScript target; run the actual mobile modules here.
const { prepareNativeConnectionTransaction } = jest.requireActual(
  '../../apps/mobile/src/connections/transactionRuntime'
);
const { EvmTransferReadRpc } = jest.requireActual(
  '../../apps/mobile/src/custody/evmTransferReadRpc'
);
const { createNativeNetwork } = jest.requireActual(
  '../../apps/mobile/src/custody/networkContext'
);
import { fetchGasAndDecodeFunction } from '../utils/fetchGasAndDecodeFunction';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';
import { KeyringAccountType, type INetwork } from 'types/network';
import { BigNumber } from 'utils/ethersV6Compat';

const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const cases = [
  {
    name: 'creation and ordered access list',
    estimate: 60001,
    fields: {
      to: null,
      data: '0x60006000',
      accessList: [
        {
          address: TO,
          storageKeys: [`0x${'33'.repeat(32)}`, `0x${'33'.repeat(32)}`],
        },
      ],
    },
    gas: '72002',
    maxFee: '7',
  },
  {
    name: 'custom-chain explicit block overflow',
    chainId: 123,
    estimate: 21001,
    block: 25000,
    fields: { gas: '25001' },
    reject: true,
  },

  {
    name: 'ceil default headroom',
    estimate: 21001,
    fields: {},
    gas: '25202',
    maxFee: '7',
  },
  {
    name: 'sufficient explicit gas',
    estimate: 21001,
    fields: { gas: '30000' },
    gas: '30000',
    maxFee: '7',
  },
  {
    name: 'insufficient explicit gas adjusted for review',
    estimate: 22000,
    fields: { gas: '21000' },
    gas: '26400',
    maxFee: '7',
  },
  {
    name: 'recommendation clamped to block',
    estimate: 22000,
    block: 25000,
    fields: {},
    gas: '25000',
    maxFee: '7',
  },
  {
    name: 'recommendation clamped to protocol',
    estimate: 14000000,
    fields: {},
    gas: '16777216',
    maxFee: '7',
  },
  {
    name: 'valid lower fee cap and zero tip',
    estimate: 21001,
    fields: { type: '0x2', maxFeePerGas: '2', maxPriorityFeePerGas: '0' },
    gas: '25202',
    maxFee: '2',
  },
  {
    name: 'insufficient fee cap adjusted for review',
    estimate: 21001,
    fields: { type: '0x2', maxFeePerGas: '1', maxPriorityFeePerGas: '0' },
    gas: '25202',
    maxFee: '7',
  },
  {
    name: 'insufficient legacy price adjusted for review',
    estimate: 21001,
    fields: { type: '0x0', gasPrice: '1' },
    gas: '25202',
    gasPrice: '4',
  },
  {
    name: 'sufficient explicit legacy price',
    estimate: 21001,
    fields: { type: '0x0', gasPrice: '3' },
    gas: '25202',
    gasPrice: '3',
  },
  {
    name: 'explicit protocol overflow',
    estimate: 14000000,
    fields: { gas: '16777217' },
    reject: true,
  },
  {
    name: 'explicit block overflow',
    estimate: 21001,
    block: 25000,
    fields: { gas: '25001' },
    reject: true,
  },
];

it.each(cases)('shares initial quote policy for $name', async (fixture) => {
  const chainId = fixture.chainId ?? 1,
    blockLimit = fixture.block ?? 30000000;
  const registration = createNativeNetwork({
    id: 'fee-fixture',
    name: 'Fee fixture',
    kind: 'evm',
    chainId: String(chainId),
    slip44: 60,
    rpcUrl: 'https://rpc.invalid',
    symbol: 'ETH',
    decimals: 18,
    testnet: false,
  });
  const network = { chainId, url: registration.rpcUrl } as INetwork;
  (store.getState as jest.Mock).mockReturnValue({
    vault: {
      isBitcoinBased: false,
      activeNetwork: network,
      activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
      accounts: { HDAccount: { 0: { address: FROM } } },
    },
    vaultGlobal: { activeSlip44: 60 },
  });
  const header = {
    number: '0x10',
    hash: `0x${'aa'.repeat(32)}`,
    gasLimit: String(blockLimit),
    baseFeePerGas: '2',
  };
  const extensionEstimates: unknown[] = [],
    nativeEstimates: unknown[] = [];
  (controllerEmitter as jest.Mock).mockImplementation(async (path, args) => {
    if (path.join('.') === 'wallet.getRecommendedEvmNonce') return 9;
    if (
      path.join('.') ===
      'wallet.ethereumTransaction.getFeeDataWithDynamicMaxPriorityFeePerGas'
    )
      return {
        gasPrice: BigNumber.from(4),
        maxFeePerGas: BigNumber.from(7),
        maxPriorityFeePerGas: BigNumber.from(2),
      };
    if (args[0] === 'eth_getBlockByNumber') return header;
    if (args[0] === 'eth_call') return '0x';
    if (args[0] === 'eth_estimateGas') {
      extensionEstimates.push(args[1][0]);
      return BigNumber.from(fixture.estimate);
    }
    throw new Error('Unexpected extension RPC');
  });
  const read = new EvmTransferReadRpc(registration, {
    monotonicMilliseconds: () => 1,
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      let result: unknown;
      if (request.method === 'eth_chainId')
        result = `0x${chainId.toString(16)}`;
      else if (request.method === 'eth_getBlockByNumber')
        result = {
          ...header,
          number: request.params[0] === '0x10' ? '0x10' : header.number,
          gasLimit: `0x${blockLimit.toString(16)}`,
          baseFeePerGas: '0x2',
        };
      else if (request.method === 'eth_getTransactionCount') result = '0x9';
      else if (request.method === 'eth_getBalance')
        result = `0x${BigInt('1000000000000000000000000000000').toString(16)}`;
      else if (request.method === 'eth_gasPrice') result = '0x4';
      else if (request.method === 'eth_maxPriorityFeePerGas') result = '0x2';
      else if (request.method === 'eth_estimateGas') {
        nativeEstimates.push(request.params[0]);
        result = `0x${fixture.estimate.toString(16)}`;
      } else throw new Error(`Unexpected native RPC ${request.method}`);
      return {
        ok: true,
        redirected: false,
        url: '',
        headers: {
          get: (name: string) =>
            name === 'content-type' ? 'application/json' : null,
        },
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
      } as Response;
    },
  });
  const input = {
    from: FROM,
    to: TO,
    data: '0x',
    value: '0x0',
    ...fixture.fields,
  };
  const extension = fetchGasAndDecodeFunction(input, network);
  const native = prepareNativeConnectionTransaction(input, {
    network: registration,
    rpc: read,
    signal: new AbortController().signal,
    assertCurrent: jest.fn(),
    now: () => 1,
    planner: async (sample) => ({
      kind: 'ready',
      nonce: sample.nonceOverride ?? 9,
      balanceState: 'pending',
      nativeReservations: { canonical: BigInt(0), pending: BigInt(0) },
    }),
    async sign() {
      throw new Error('No signing in quote test');
    },
    async submit() {
      throw new Error('No submission in quote test');
    },
  });
  if ('reject' in fixture) {
    await Promise.all([
      expect(extension).rejects.toThrow(),
      expect(native).rejects.toThrow(),
    ]);
    return;
  }
  const [ext, mobile] = await Promise.all([extension, native]);
  expect(ext.formTx.gasLimit.toString()).toBe(fixture.gas);
  expect(mobile.transaction.gasLimit).toBe(fixture.gas);
  if ('gasPrice' in fixture) {
    expect(ext.formTx.gasPrice).toBe(fixture.gasPrice);
    expect(mobile.transaction.type === 0 && mobile.transaction.gasPrice).toBe(
      fixture.gasPrice
    );
  } else {
    expect(ext.formTx.maxFeePerGas.toString()).toBe(fixture.maxFee);
    expect(
      mobile.transaction.type === 2 && mobile.transaction.maxFeePerGas
    ).toBe(fixture.maxFee);
    expect(
      mobile.transaction.type === 2 && mobile.transaction.maxPriorityFeePerGas
    ).toBe(ext.formTx.maxPriorityFeePerGas.toString());
  }
  expect(nativeEstimates).toEqual(extensionEstimates);
  if (input.to === null) expect(nativeEstimates[0]).not.toHaveProperty('to');
  expect(nativeEstimates[0]).not.toHaveProperty('gasPrice');
  expect(nativeEstimates[0]).not.toHaveProperty('maxFeePerGas');
});
