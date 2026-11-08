import { getAddress } from 'ethers/address';

import { evmCallRequest } from '../../shared/evmEstimateRequest.ts';
import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeApproval.ts';
import { observeEvmTransaction } from '../../shared/evmTransactionObservation.ts';
import { BigNumber } from '../ethersV6Compat.ts';

import type { SmartAccountPackedUserOperation } from './account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
import type { SmartAccountPendingRecords } from '../../wallet/evmSignedRecords.ts';

export const SMART_ACCOUNT_PENDING_STATE = 'SMART_ACCOUNT_PENDING_STATE';
export const isSmartAccountPendingStateError = (error: unknown) =>
  error instanceof Error && error.message === SMART_ACCOUNT_PENDING_STATE;
const unavailable = () =>
  Object.assign(new Error(SMART_ACCOUNT_PENDING_STATE), {
    transactionNotBroadcast: true,
  });
const lanes = new Map<string, { tail: Promise<void>; users: number }>();
const quantity = (value: unknown): string => {
  const number = BigInt(String(value));
  if (number < BigInt(0) || number >= BigInt(1) << BigInt(256))
    throw new Error('Invalid smart account quantity');
  return `0x${number.toString(16)}`;
};
const rpcQuantity = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
  )
    throw new Error('Invalid smart account RPC quantity');
  return BigInt(value);
};

/** Preserve fee-neutral calls and explicit legacy fee fields without inventing a nonce. */
function callRequest(input: Record<string, any>) {
  const request: Record<string, unknown> = evmCallRequest({
    ...(input.from === undefined ? {} : { from: getAddress(input.from) }),
    ...(input.nonce === undefined ? {} : { nonce: String(input.nonce) }),
    to:
      input.to === undefined || input.to === null ? null : getAddress(input.to),
    data: input.data ?? '0x',
    value: String(input.value ?? 0),
    ...(input.accessList === undefined ? {} : { accessList: input.accessList }),
  });
  for (const field of [
    'gasPrice',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
  ] as const)
    if (input[field] !== undefined) request[field] = quantity(input[field]);
  if (input.gasLimit !== undefined) request.gas = quantity(input.gasLimit);
  return request;
}

/** The same pending state is used for code, nonce, balances and both preflights. */
export function createSmartAccountPendingState(
  provider: any,
  records: SmartAccountPendingRecords,
  chainId: number,
  address: string,
  assertCurrent: () => void
) {
  if (
    !/^0x[0-9a-f]{64}$/.test(records.profileId) ||
    typeof records.read !== 'function'
  )
    throw new Error('Smart account records are unavailable');
  if (
    typeof provider?.send !== 'function' ||
    typeof provider.verifyConfiguredChainId !== 'function'
  )
    throw new Error('Smart account RPC is unavailable');
  const account = getAddress(address);
  const entryPoint = getPaliEntryPointAddress(chainId);
  const check = () => assertSynchronousEvmFeeGuard(assertCurrent);
  const verify = async () => {
    check();
    await provider.verifyConfiguredChainId(true);
    check();
  };
  const read = async (method: string, params: readonly unknown[]) => {
    check();
    const result = await provider.send(method, params);
    check();
    return result;
  };
  const hex = async (method: string, params: readonly unknown[]) => {
    const value = await read(method, params);
    if (typeof value !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(value))
      throw new Error('Invalid smart account RPC data');
    return value;
  };
  const pendingProvider = new Proxy(provider, {
    get(target, property) {
      if (property === 'send') return read;
      if (property === 'call')
        return (input: Record<string, any>) =>
          hex('eth_call', [callRequest(input), 'pending']);
      if (property === 'getCode')
        return (owner: string) =>
          hex('eth_getCode', [getAddress(owner), 'pending']);
      if (property === 'getBalance')
        return async (owner: string) =>
          BigNumber.from(
            rpcQuantity(
              await read('eth_getBalance', [getAddress(owner), 'pending'])
            )
          );
      if (property === 'estimateGas')
        return async (input: Record<string, any>) =>
          BigNumber.from(
            rpcQuantity(
              await read('eth_estimateGas', [callRequest(input), 'pending'])
            )
          );
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const readNonce = async (key: bigint, fresh: boolean): Promise<string> => {
    await verify();
    if (key < BigInt(0) || key >= BigInt(1) << BigInt(192))
      throw new Error('Invalid smart account nonce key');
    const data = paliEntryPointInterface.encodeFunctionData('getNonce', [
      account,
      key,
    ]);
    const response = await hex('eth_call', [
      { to: entryPoint, data },
      'pending',
    ]);
    if (!/^0x[0-9a-f]{64}$/i.test(response))
      throw new Error('Invalid smart account nonce response');
    const decoded = paliEntryPointInterface.decodeFunctionResult(
      'getNonce',
      response
    )[0];
    const nonce = BigInt(decoded.toString());
    if (nonce >> BigInt(64) !== key)
      throw new Error('Invalid smart account nonce key response');
    const retained = await records.read(fresh);
    check();
    for (const operation of retained) {
      if (
        operation.chainId !== String(chainId) ||
        operation.account !== account ||
        operation.operationNonce !== nonce.toString()
      )
        continue;
      const observation = await observeEvmTransaction(
        {
          chainId: String(chainId),
          from: operation.payer,
          hash: operation.hash,
          nonce: String(operation.payerNonce),
          to: entryPoint,
        },
        read,
        check
      );
      // A freshly canonical reverted outer transaction never executed the UserOperation.
      if (
        observation.status !== 'mined' ||
        observation.outcome !== 'reverted' ||
        observation.transactionIndex === undefined
      )
        throw unavailable();
    }
    await verify();
    return nonce.toString();
  };
  const assertNonce = async (operation: SmartAccountPackedUserOperation) => {
    if (getAddress(operation.sender) !== account) throw unavailable();
    const nonce = BigInt(operation.nonce);
    if ((await readNonce(nonce >> BigInt(64), true)) !== operation.nonce)
      throw unavailable();
    check();
  };
  return Object.freeze({
    provider: pendingProvider,
    verify,
    readNonce: (key: bigint) => readNonce(key, false),
    assertNonce,
    async submit<T>(
      operation: SmartAccountPackedUserOperation,
      action: () => Promise<T>
    ): Promise<T> {
      const key = `${records.profileId}:${chainId}:${account}`;
      const lane = lanes.get(key) ?? { tail: Promise.resolve(), users: 0 };
      lanes.set(key, lane);
      lane.users++;
      const previous = lane.tail;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      lane.tail = previous.then(() => held);
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        // Only authority is polled while queued. RPC work starts after ownership.
        await new Promise<void>((resolve, reject) => {
          timer = setInterval(() => {
            try {
              check();
            } catch (error) {
              reject(error);
            }
          }, 100);
          previous.then(resolve, reject);
        });
        clearInterval(timer);
        await assertNonce(operation);
        return await action();
      } finally {
        clearInterval(timer);
        release();
        if (--lane.users === 0 && lanes.get(key) === lane) lanes.delete(key);
      }
    },
  });
}
export type SmartAccountPendingState = ReturnType<
  typeof createSmartAccountPendingState
>;
