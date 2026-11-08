import { BigNumber, hexlify } from '../../../../source/utils/ethersV6Compat.ts';
import { getAddress } from 'ethers/address';
import { parseRpcQuantity } from '../platformRpc.ts';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import type { NativeNetworkRegistration } from '../custody/networkContext.ts';

type ReadMethod = Parameters<EvmTransferReadRpc['smartAccountRead']>[0];

/** Ethers-compatible read adapter. Signing and submission use the existing SDK host. */
export function createNativeSmartAccountProvider(
  network: NativeNetworkRegistration,
  rpc: EvmTransferReadRpc,
  signal: AbortSignal,
  assertCurrent: () => void
) {
  const read = (method: ReadMethod, params: readonly unknown[]) =>
    rpc.smartAccountRead(method, params, signal, assertCurrent);
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
    async getNetwork() {
      assertCurrent();
      return { chainId: BigInt(network.chainId) };
    },
    async verifyConfiguredChainId() {
      if (
        parseRpcQuantity(await read('eth_chainId', [])) !==
        BigInt(network.chainId)
      )
        throw new Error('Smart account network changed');
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
      const fees = await rpc.smartAccountFeeData(signal, assertCurrent);
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
