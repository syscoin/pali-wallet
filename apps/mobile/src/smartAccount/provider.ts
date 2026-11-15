import { BigNumber, hexlify } from '../../../../source/utils/ethersV6Compat.ts';
import { getAddress } from 'ethers/address';
import { parseRpcQuantity } from '../platformRpc.ts';
import {
  EvmTransferReadRpc,
  type NativeSmartAccountReadPhase,
} from '../custody/evmTransferReadRpc.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';

type ReadMethod = Parameters<EvmTransferReadRpc['smartAccountRead']>[0];
type NativeSmartAccountProvider = Readonly<{
  send(method: string, params: readonly unknown[]): Promise<unknown>;
  readMany(
    requests: readonly { method: string; params: readonly unknown[] }[]
  ): Promise<PromiseSettledResult<unknown>[]>;
  sendBatch(
    method: string,
    params: readonly (readonly unknown[])[]
  ): Promise<unknown[]>;
  getNetwork(): Promise<{ chainId: bigint }>;
  verifyConfiguredChainId(): Promise<void>;
  withReadPhase<T>(
    work: (provider: NativeSmartAccountProvider) => Promise<T>
  ): Promise<T>;
  getCode(address: string): Promise<string>;
  getBalance(address: string): Promise<BigNumber>;
  estimateGas(input: Record<string, unknown>): Promise<BigNumber>;
  call(input: Record<string, unknown>): Promise<string>;
  getFeeData(): Promise<{
    gasPrice: BigNumber;
    maxFeePerGas: BigNumber | null;
    maxPriorityFeePerGas: BigNumber | null;
    lastBaseFeePerGas: BigNumber | null;
  }>;
}>;

/** Ethers-compatible read adapter. Signing and submission use the existing SDK host. */
export function createNativeSmartAccountProvider(
  network: NativeNetworkRegistration,
  rpc: EvmTransferReadRpc,
  signal: AbortSignal,
  assertCurrent: () => void
) {
  return smartAccountProvider(network, rpc, signal, assertCurrent);
}

function smartAccountProvider(
  network: NativeNetworkRegistration,
  rpc: EvmTransferReadRpc,
  signal: AbortSignal,
  assertCurrent: () => void,
  phase?: NativeSmartAccountReadPhase
): NativeSmartAccountProvider {
  const read = (method: ReadMethod, params: readonly unknown[]) =>
    phase
      ? phase.read(method, params)
      : rpc.smartAccountRead(method, params, signal, assertCurrent);
  const quantity = async (method: ReadMethod, params: readonly unknown[]) =>
    BigNumber.from(parseRpcQuantity(await read(method, params)));
  const transaction = (input: Record<string, unknown>) => {
    const output: Record<string, unknown> = {};
    for (const field of ['to', 'from'] as const)
      if (input[field] !== undefined)
        output[field] = getAddress(String(input[field]));
    if (input.data !== undefined) {
      if (
        typeof input.data !== 'string' ||
        !/^0x(?:[a-f\d]{2})*$/i.test(input.data)
      )
        throw new Error('Invalid smart account call');
      output.data = input.data;
    }
    for (const field of [
      'value',
      'gasPrice',
      'maxFeePerGas',
      'maxPriorityFeePerGas',
    ] as const)
      if (input[field] !== undefined)
        output[field] = `0x${BigNumber.from(input[field] as string)
          .toBigInt()
          .toString(16)}`;
    return output;
  };
  return {
    send(method: string, params: readonly unknown[]) {
      if (
        method === 'eth_getTransactionReceipt' ||
        method === 'eth_getTransactionCount'
      )
        return phase
          ? phase.read(method, params)
          : rpc.retirementRead(method, params, signal, assertCurrent);
      return read(method as ReadMethod, params);
    },
    async readMany(
      requests: readonly { method: string; params: readonly unknown[] }[]
    ) {
      if (!phase)
        return this.withReadPhase((scoped) => scoped.readMany(requests));
      return phase.readMany(
        requests.map((request) => ({
          method: request.method as ReadMethod,
          params: request.params,
        }))
      );
    },
    async sendBatch(method: string, params: readonly (readonly unknown[])[]) {
      if (!phase)
        return this.withReadPhase((scoped) => scoped.sendBatch(method, params));
      const results = await phase.readMany(
        params.map((values) => ({
          method: method as ReadMethod,
          params: values,
        }))
      );
      return results.map((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
    },
    async getNetwork() {
      assertCurrent();
      return { chainId: BigInt(network.chainId) };
    },
    async verifyConfiguredChainId() {
      if (phase) phase.assertCurrent();
      else await rpc.verifyNetwork(signal, assertCurrent);
    },
    async withReadPhase<T>(
      work: (provider: NativeSmartAccountProvider) => Promise<T>
    ): Promise<T> {
      if (phase) {
        phase.assertCurrent();
        const result = await work(
          smartAccountProvider(network, rpc, signal, assertCurrent, phase)
        );
        phase.assertCurrent();
        return result;
      }
      return rpc.smartAccountReadPhase(signal, assertCurrent, (scoped) =>
        work(smartAccountProvider(network, rpc, signal, assertCurrent, scoped))
      );
    },
    async getCode(address: string) {
      const code = await read('eth_getCode', [getAddress(address), 'latest']);
      if (typeof code !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(code))
        throw new Error('Invalid account code');
      return code;
    },
    getBalance: (address: string) =>
      quantity('eth_getBalance', [getAddress(address), 'latest']),
    estimateGas: (input: Record<string, unknown>) =>
      quantity('eth_estimateGas', [transaction(input)]),
    async call(input: Record<string, unknown>) {
      const result = await read('eth_call', [transaction(input), 'latest']);
      if (typeof result !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(result))
        throw new Error('Invalid smart account response');
      return hexlify(result);
    },
    async getFeeData() {
      const fees = await (phase
        ? phase.feeData()
        : rpc.smartAccountFeeData(signal, assertCurrent));
      return {
        gasPrice: BigNumber.from(fees.gasPrice),
        maxFeePerGas:
          fees.baseFeePerGas === undefined
            ? null
            : BigNumber.from(fees.maxFeePerGas),
        maxPriorityFeePerGas:
          fees.baseFeePerGas === undefined
            ? null
            : BigNumber.from(fees.maxPriorityFeePerGas),
        lastBaseFeePerGas:
          fees.baseFeePerGas === undefined
            ? null
            : BigNumber.from(fees.baseFeePerGas),
      };
    },
  };
}
