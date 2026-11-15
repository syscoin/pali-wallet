import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';

import { ERC20_MULTICALL_RUNTIME_HASH } from '../../shared/erc20BalanceBatch.ts';
import { BigNumber } from '../ethersV6Compat.ts';

import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
import {
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from './deploymentMetadata.ts';

type FinancialProvider = {
  send(method: string, params: readonly unknown[]): Promise<unknown>;
};
export type SmartAccountFinancialState = Readonly<{
  balance: BigNumber;
  deposit: BigNumber;
  nonce: string;
}>;
const multicall = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
  'function getEthBalance(address account) view returns (uint256 balance)',
]);
const word = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid smart account financial response');
  return BigInt(value);
};
const quantity = (value: unknown): bigint => {
  if (
    typeof value !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
  )
    throw new Error('Invalid smart account balance');
  return BigInt(value);
};

/** Fixed pending getters only. The owner supplies a fresh, guarded read phase. */
export async function readSmartAccountFinancialState(
  provider: FinancialProvider,
  chainId: number,
  address: string,
  nonceKey = BigInt(0)
): Promise<SmartAccountFinancialState> {
  const account = getAddress(address);
  if (nonceKey < BigInt(0) || nonceKey >= BigInt(1) << BigInt(192))
    throw new Error('Invalid smart account nonce key');
  const entryPoint = getPaliEntryPointAddress(chainId);
  const nonceData = paliEntryPointInterface.encodeFunctionData('getNonce', [
    account,
    nonceKey,
  ]);
  const depositData = paliEntryPointInterface.encodeFunctionData('balanceOf', [
    account,
  ]);
  let aggregateAddress: string | undefined;
  for (const candidate of [
    PALI_INFRASTRUCTURE_METADATA_BY_ID.multicall3.address,
    PALI_MULTICALL3_CANONICAL_ADDRESS,
  ]) {
    const code = await provider.send('eth_getCode', [candidate, 'pending']);
    if (typeof code !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(code))
      throw new Error('Invalid smart account aggregation runtime');
    if (code !== '0x' && keccak256(code) === ERC20_MULTICALL_RUNTIME_HASH) {
      aggregateAddress = candidate;
      break;
    }
  }
  let aggregated: Array<bigint | undefined> = [];
  if (aggregateAddress) {
    try {
      const response = await provider.send('eth_call', [
        {
          to: aggregateAddress,
          data: multicall.encodeFunctionData('aggregate3', [
            [
              { target: entryPoint, allowFailure: true, callData: nonceData },
              {
                target: aggregateAddress,
                allowFailure: true,
                callData: multicall.encodeFunctionData('getEthBalance', [
                  account,
                ]),
              },
              { target: entryPoint, allowFailure: true, callData: depositData },
            ],
          ]),
        },
        'pending',
      ]);
      if (
        typeof response !== 'string' ||
        response.length > 4098 ||
        !/^0x(?:[a-f\d]{2})*$/i.test(response)
      )
        throw new Error('Invalid smart account aggregate');
      const results = multicall.decodeFunctionResult('aggregate3', response)[0];
      if (results.length !== 3)
        throw new Error('Invalid smart account aggregate count');
      aggregated = Array.from(
        results,
        (result: { returnData: string; success: boolean }) => {
          try {
            return result.success ? word(result.returnData) : undefined;
          } catch {
            return undefined;
          }
        }
      );
    } catch {
      // A failed aggregate cannot authenticate any member. Each raw getter
      // remains bound to the same owner and pending selector below.
    }
  }
  const [nonce, balance, deposit] = await Promise.all([
    aggregated[0] ??
      provider
        .send('eth_call', [{ to: entryPoint, data: nonceData }, 'pending'])
        .then(word),
    aggregated[1] ??
      provider.send('eth_getBalance', [account, 'pending']).then(quantity),
    aggregated[2] ??
      provider
        .send('eth_call', [{ to: entryPoint, data: depositData }, 'pending'])
        .then(word),
  ]);
  if (nonce >> BigInt(64) !== nonceKey)
    throw new Error('Invalid smart account nonce key response');
  return Object.freeze({
    nonce: nonce.toString(),
    balance: BigNumber.from(balance),
    deposit: BigNumber.from(deposit),
  });
}
