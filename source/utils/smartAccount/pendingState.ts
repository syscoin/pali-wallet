import { getAddress } from 'ethers/address';

import { evmCallRequest } from '../../shared/evmEstimateRequest.ts';
import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { withEvmReadPhase } from '../../shared/evmReadPhase.ts';
import { observeEvmTransaction } from '../../shared/evmTransactionObservation.ts';
import { BigNumber } from '../ethersV6Compat.ts';

import {
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from './account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from './contracts.ts';
import {
  readSmartAccountBalance,
  readSmartAccountDeposit,
  readSmartAccountNonce,
  type SmartAccountFinancialState,
} from './financialReads.ts';
import { getSmartAccountNativeValue } from './nativeSpendability.ts';
import { SMART_ACCOUNT_PENDING_STATE } from './pendingStateError.ts';
import type { EvmAutoNonceSnapshot } from '../../shared/evmAutoNonce.ts';
import type { SmartAccountPendingRecords } from '../../wallet/evmSignedRecords.ts';

export { SMART_ACCOUNT_PENDING_STATE } from './pendingStateError.ts';
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
  assertCurrent: () => void,
  currentSignedHash?: string,
  phaseScoped = false
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
  const nonceReads = new Map<string, Promise<string>>();
  let balance: Promise<BigNumber> | undefined;
  let deposit: Promise<BigNumber> | undefined;
  const nonceState = (key: bigint) => {
    const identity = key.toString();
    let result = nonceReads.get(identity);
    if (!result) {
      result = readSmartAccountNonce({ send: read }, chainId, account, key);
      nonceReads.set(identity, result);
    }
    return result;
  };
  const financialState = async (key: bigint, includeDeposit = true) => {
    check();
    await provider.verifyConfiguredChainId(true);
    check();
    const nonce = nonceState(key);
    balance ??= readSmartAccountBalance({ send: read }, account);
    if (includeDeposit)
      deposit ??= readSmartAccountDeposit({ send: read }, chainId, account);
    const [observedNonce, observedBalance, observedDeposit] = await Promise.all(
      [
        nonce,
        balance,
        includeDeposit ? deposit : Promise.resolve(BigNumber.from(0)),
      ]
    );
    await provider.verifyConfiguredChainId(true);
    check();
    return Object.freeze({
      nonce: observedNonce,
      balance: observedBalance,
      deposit: observedDeposit!,
    }) satisfies SmartAccountFinancialState;
  };
  const pendingProvider = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'readSmartAccountFinancialState')
        return phaseScoped ? financialState : undefined;
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
      const value = Reflect.get(provider, property, provider);
      return typeof value === 'function' ? value.bind(provider) : value;
    },
  });
  const readNonce = async (
    key: bigint,
    fresh: boolean,
    includeBalances = false,
    includeDeposit = true
  ): Promise<string> => {
    await verify();
    if (key < BigInt(0) || key >= BigInt(1) << BigInt(192))
      throw new Error('Invalid smart account nonce key');
    const data = paliEntryPointInterface.encodeFunctionData('getNonce', [
      account,
      key,
    ]);
    const response = phaseScoped
      ? undefined
      : await hex('eth_call', [{ to: entryPoint, data }, 'pending']);
    if (response !== undefined && !/^0x[0-9a-f]{64}$/i.test(response))
      throw new Error('Invalid smart account nonce response');
    const nonce = phaseScoped
      ? BigInt(
          includeBalances
            ? (await financialState(key, includeDeposit)).nonce
            : await nonceState(key)
        )
      : BigInt(
          paliEntryPointInterface
            .decodeFunctionResult('getNonce', response!)[0]
            .toString()
        );
    if (nonce >> BigInt(64) !== key)
      throw new Error('Invalid smart account nonce key response');
    const retained = await records.read(fresh);
    check();
    for (const operation of retained) {
      if (
        operation.chainId !== String(chainId) ||
        operation.account !== account ||
        operation.operationNonce !== nonce.toString() ||
        operation.hash.toLowerCase() === currentSignedHash?.toLowerCase()
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
    const hasNativeValue = !getSmartAccountNativeValue(operation).isZero();
    if (
      (await readNonce(
        nonce >> BigInt(64),
        true,
        phaseScoped && hasNativeValue,
        hasNativeValue &&
          !getSmartAccountUserOpRequiredPrefund(operation).isZero()
      )) !== operation.nonce
    )
      throw unavailable();
    check();
  };
  return Object.freeze({
    provider: pendingProvider,
    withReadPhase<T>(
      work: (state: SmartAccountPendingState) => Promise<T>
    ): Promise<T> {
      return withEvmReadPhase(provider, check, (phase) =>
        work(
          createSmartAccountPendingState(
            phase,
            records,
            chainId,
            account,
            check,
            currentSignedHash,
            true
          )
        )
      );
    },
    onProvider(
      phase: any,
      signedHash?: string,
      admission?: EvmAutoNonceSnapshot
    ) {
      if (admission && admission.owner !== records.profileId)
        throw unavailable();
      const ownedRecords = admission
        ? {
            profileId: records.profileId,
            read: async () => {
              if (!admission.readSmartAccountOperations) throw unavailable();
              return admission.readSmartAccountOperations(
                String(chainId),
                account
              );
            },
          }
        : records;
      return createSmartAccountPendingState(
        phase,
        ownedRecords,
        chainId,
        account,
        check,
        signedHash,
        true
      );
    },
    verify,
    readNonce: (key: bigint) => readNonce(key, false),
    assertNonce,
    async submit<T>(
      operation: SmartAccountPackedUserOperation,
      action: (assertOperationNonce: () => Promise<void>) => Promise<T>
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
        check();
        // The owned action checks before any prefunding. Its outer-payer
        // quote checks the same nonce in the common read phase before signing.
        return await action(() => assertNonce(operation));
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
