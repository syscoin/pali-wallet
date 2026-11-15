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
export type SmartAccountBalances = Pick<
  SmartAccountFinancialState,
  'balance' | 'deposit'
>;
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

export async function readSmartAccountNonce(
  provider: FinancialProvider,
  chainId: number,
  address: string,
  nonceKey = BigInt(0)
): Promise<string> {
  const account = getAddress(address);
  if (nonceKey < BigInt(0) || nonceKey >= BigInt(1) << BigInt(192))
    throw new Error('Invalid smart account nonce key');
  const entryPoint = getPaliEntryPointAddress(chainId);
  const nonceData = paliEntryPointInterface.encodeFunctionData('getNonce', [
    account,
    nonceKey,
  ]);
  const nonce = word(
    await provider.send('eth_call', [
      { to: entryPoint, data: nonceData },
      'pending',
    ])
  );
  if (nonce >> BigInt(64) !== nonceKey)
    throw new Error('Invalid smart account nonce key response');
  return nonce.toString();
}

export async function readSmartAccountBalance(
  provider: FinancialProvider,
  address: string
): Promise<BigNumber> {
  return BigNumber.from(
    quantity(
      await provider.send('eth_getBalance', [getAddress(address), 'pending'])
    )
  );
}

export async function readSmartAccountDeposit(
  provider: FinancialProvider,
  chainId: number,
  address: string
): Promise<BigNumber> {
  const data = paliEntryPointInterface.encodeFunctionData('balanceOf', [
    getAddress(address),
  ]);
  return BigNumber.from(
    word(
      await provider.send('eth_call', [
        { to: getPaliEntryPointAddress(chainId), data },
        'pending',
      ])
    )
  );
}

export async function readSmartAccountBalances(
  provider: FinancialProvider,
  chainId: number,
  address: string,
  includeDeposit = true
): Promise<SmartAccountBalances> {
  const [balance, deposit] = await Promise.all([
    readSmartAccountBalance(provider, address),
    includeDeposit
      ? readSmartAccountDeposit(provider, chainId, address)
      : Promise.resolve(BigNumber.from(0)),
  ]);
  return Object.freeze({ balance, deposit });
}

/** Independent pending getters share the owner's bounded read phase when needed. */
export async function readSmartAccountFinancialState(
  provider: FinancialProvider,
  chainId: number,
  address: string,
  nonceKey = BigInt(0)
): Promise<SmartAccountFinancialState> {
  const [nonce, balances] = await Promise.all([
    readSmartAccountNonce(provider, chainId, address, nonceKey),
    readSmartAccountBalances(provider, chainId, address),
  ]);
  return Object.freeze({ nonce, ...balances });
}
