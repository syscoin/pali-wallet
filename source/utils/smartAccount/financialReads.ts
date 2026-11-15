import { getAddress } from 'ethers/address';

import { BigNumber } from '../ethersV6Compat.ts';

import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
type FinancialProvider = {
  send(method: string, params: readonly unknown[]): Promise<unknown>;
};
export type SmartAccountFinancialState = Readonly<{
  balance: BigNumber;
  deposit: BigNumber;
  nonce: string;
}>;
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

/** Three independent pending getters share the owner's bounded read phase. */
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
  const [nonce, balance, deposit] = await Promise.all([
    provider
      .send('eth_call', [{ to: entryPoint, data: nonceData }, 'pending'])
      .then(word),
    provider.send('eth_getBalance', [account, 'pending']).then(quantity),
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
