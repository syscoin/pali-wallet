import { Interface } from 'ethers/abi';
import { keccak256 } from 'ethers/crypto';

import {
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from '../utils/smartAccount/deploymentMetadata.ts';

// Runtime returned by the canonical Multicall3 creation bytecode already
// bundled in deployment.ts (offset 0x20, length 0xee0). Both deployment
// addresses execute this same constructor without arguments.
export const ERC20_MULTICALL_RUNTIME_HASH =
  '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
const abi = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
]);
export type Erc20BalanceCall = Readonly<{ data: string; target: string }>;
type Reader = Readonly<{
  read(
    method: 'eth_getCode' | 'eth_call',
    params: readonly unknown[]
  ): Promise<unknown>;
  readMany(
    requests: readonly Readonly<{
      method: 'eth_call';
      params: readonly unknown[];
    }>[]
  ): Promise<PromiseSettledResult<unknown>[]>;
}>;

/** Scoped display getters only. An endpoint owner creates this for one reader. */
export function createErc20BalanceBatch(clock = () => performance.now()) {
  let verified: string | null | undefined;
  let expires = 0;
  return async (
    read: Reader,
    calls: readonly Erc20BalanceCall[],
    block: string
  ): Promise<PromiseSettledResult<unknown>[]> => {
    if (!calls.length) return [];
    if (calls.length > 512) throw new Error('Too many token balance reads');
    if (!/^0x(?:0|[1-9a-f][a-f\d]*)$/i.test(block))
      throw new Error('Invalid token balance block');
    for (const call of calls) {
      if (
        !/^0x[a-f\d]{40}$/i.test(call.target) ||
        !/^0x(?:313ce567|70a082310{24}[a-f\d]{40})$/i.test(call.data)
      )
        throw new Error('Invalid token balance getter');
    }
    if (clock() >= expires) verified = undefined;
    if (verified === undefined) {
      for (const address of [
        PALI_MULTICALL3_CANONICAL_ADDRESS,
        PALI_INFRASTRUCTURE_METADATA_BY_ID.multicall3.address,
      ]) {
        const code = await read.read('eth_getCode', [address, block]);
        if (typeof code !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(code))
          throw new Error('Invalid aggregation runtime');
        if (code !== '0x' && keccak256(code) === ERC20_MULTICALL_RUNTIME_HASH) {
          verified = address;
          break;
        }
      }
      verified ??= null;
      expires = clock() + 30_000;
    }
    if (verified) {
      // Forty results fit the native scalar response budget even when every
      // uint256 value is returned with the full aggregate3 ABI envelope.
      const chunks: Erc20BalanceCall[][] = [];
      for (let offset = 0; offset < calls.length; offset += 40)
        chunks.push(calls.slice(offset, offset + 40));
      const observations = await read.readMany(
        chunks.map((chunk) => ({
          method: 'eth_call',
          params: [
            {
              to: verified,
              data: abi.encodeFunctionData('aggregate3', [
                chunk.map((call) => ({
                  target: call.target,
                  allowFailure: true,
                  callData: call.data,
                })),
              ]),
            },
            block,
          ],
        }))
      );
      return observations.flatMap(
        (observation, index): PromiseSettledResult<unknown>[] => {
          const chunk = chunks[index]!;
          try {
            if (observation.status === 'rejected') throw observation.reason;
            if (
              typeof observation.value !== 'string' ||
              !/^0x(?:[a-f\d]{2})*$/i.test(observation.value)
            )
              throw new Error('Invalid aggregated balances');
            const values = abi.decodeFunctionResult(
              'aggregate3',
              observation.value
            )[0];
            if (values.length !== chunk.length)
              throw new Error('Invalid aggregated balance count');
            return Array.from(
              values,
              (value: { returnData: string; success: boolean }) =>
                value.success
                  ? { status: 'fulfilled' as const, value: value.returnData }
                  : {
                      status: 'rejected' as const,
                      reason: new Error('Token balance read reverted'),
                    }
            );
          } catch (reason) {
            return chunk.map(() => ({ status: 'rejected' as const, reason }));
          }
        }
      );
    }

    return read.readMany(
      calls.map((call) => ({
        method: 'eth_call',
        params: [{ to: call.target, data: call.data }, block],
      }))
    );
  };
}
