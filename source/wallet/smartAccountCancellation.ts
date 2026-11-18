import { Transaction } from 'ethers/transaction';

import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';
import {
  observeEvmTransaction,
  readEvmRpcQuantity,
} from '../shared/evmTransactionObservation.ts';
import { getAddress, toBeHex } from '../utils/ethersV6Compat.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
} from '../utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

import type {
  EvmRetainedSignedRecord,
  SmartAccountPendingRecords,
} from './evmSignedRecords.ts';
import {
  captureSmartAccountAuthorization,
  isSmartAccountRevocationOperation,
  type RetainedSmartAccountAuthorization,
  type SmartAccountAuthorizationBlock,
} from './smartAccountAuthorization.ts';
import type { SmartAccountPackedUserOperation } from '../utils/smartAccount/account.ts';

export type SmartAccountCancellationRequest = Readonly<{
  operationHash?: string;
  originalHash: string;
}>;
export type SmartAccountCancellation = Readonly<{
  account: string;
  authorization: RetainedSmartAccountAuthorization;
  chainId: number;
  nonceKey: string;
  originalHash: string;
  originalKind: 'transaction' | 'authorization';
  outer?: EvmRetainedSignedRecord;
  referenceHash: string;
  validator: string;
}>;
export type SmartAccountCancellationMetadata = Readonly<{
  account: string;
  chainId: string;
  operationHash: string;
  operationNonce: string;
  originalHash: string;
  originalKind: 'transaction' | 'authorization';
  originalOperationHash: string;
}>;
const issued = new WeakSet<SmartAccountCancellation>();
const HASH = /^0x[\da-f]{64}$/i;
const unavailable = (): never => {
  throw Object.assign(
    new Error(
      'Unable to revoke this Smart account operation. Refresh its on-chain status.'
    ),
    { transactionNotBroadcast: true }
  );
};

export function decodeCancellationOuter(raw: string, chainId: number) {
  const tx = Transaction.from(raw);
  if (
    !tx.isSigned() ||
    tx.chainId !== BigInt(chainId) ||
    tx.to?.toLowerCase() !== getPaliEntryPointAddress(chainId).toLowerCase() ||
    tx.value !== BigInt(0)
  )
    return unavailable();
  const decoded = paliEntryPointInterface.decodeFunctionData(
    'handleOps',
    tx.data
  );
  if (
    decoded[0].length !== 1 ||
    paliEntryPointInterface
      .encodeFunctionData('handleOps', decoded)
      .toLowerCase() !== tx.data.toLowerCase()
  )
    return unavailable();
  const value = decoded[0][0];
  const operation: SmartAccountPackedUserOperation = Object.freeze({
    sender: getAddress(value.sender),
    nonce: value.nonce.toString(),
    initCode: value.initCode,
    callData: value.callData,
    accountGasLimits: value.accountGasLimits,
    preVerificationGas: value.preVerificationGas.toString(),
    gasFees: value.gasFees,
    paymasterAndData: value.paymasterAndData,
    signature: value.signature,
  });
  return { tx, operation };
}

/** Inputs must come from authenticated retained records, never a renderer. */
export function captureSmartAccountCancellation(
  input: Readonly<{
    account: string;
    authorization?: RetainedSmartAccountAuthorization;
    chainId: number;
    observedAt: SmartAccountAuthorizationBlock;
    operationHash?: string;
    outer?: EvmRetainedSignedRecord;
    referenceHash: string;
  }>
): SmartAccountCancellation {
  const account = getAddress(input.account);
  if (
    !HASH.test(input.referenceHash) ||
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0
  )
    return unavailable();
  const decoded =
    input.outer &&
    decodeCancellationOuter(input.outer.rawTransaction, input.chainId);
  if (
    decoded &&
    (decoded.tx.hash !== input.outer!.hash ||
      (input.outer!.hash !== input.referenceHash.toLowerCase() &&
        input.authorization?.operationHash !==
          input.referenceHash.toLowerCase()) ||
      decoded.tx.from!.toLowerCase() !== input.outer!.from.toLowerCase() ||
      decoded.tx.nonce !== input.outer!.nonce)
  )
    return unavailable();
  const original =
    input.authorization ??
    (decoded &&
      captureSmartAccountAuthorization({
        chainId: input.chainId,
        createdAt: input.outer!.createdAt,
        observedAt: input.observedAt,
        payer: decoded.tx.from!,
        userOperation: decoded.operation,
      }));
  if (
    !original ||
    original.chainId !== String(input.chainId) ||
    original.account !== account ||
    original.userOperation.sender !== account ||
    original.userOperation.paymasterAndData !== '0x' ||
    (input.operationHash !== undefined &&
      input.operationHash.toLowerCase() !== original.operationHash) ||
    (decoded
      ? getSmartAccountUserOpHash(
          decoded.operation,
          input.chainId
        ).toLowerCase() !== original.operationHash
      : input.referenceHash.toLowerCase() !== original.operationHash)
  )
    return unavailable();
  const nonce = BigInt(original.operationNonce);
  const result: SmartAccountCancellation = Object.freeze({
    account,
    authorization: original,
    chainId: input.chainId,
    nonceKey: (nonce >> BigInt(64)).toString(),
    originalHash: input.outer?.hash ?? input.referenceHash.toLowerCase(),
    referenceHash: input.referenceHash.toLowerCase(),
    originalKind: decoded ? 'transaction' : 'authorization',
    ...(input.outer ? { outer: Object.freeze({ ...input.outer }) } : {}),
    validator: getAddress(toBeHex(nonce >> BigInt(96), 20)),
  });
  issued.add(result);
  return result;
}
export function assertSmartAccountCancellation(
  value: SmartAccountCancellation
): void {
  if (!value || !issued.has(value)) unavailable();
}
export function smartAccountCancellationExecutions(
  value: SmartAccountCancellation
) {
  assertSmartAccountCancellation(value);
  return [{ target: value.account, value: '0x0', data: '0x' }];
}
export function assertSmartAccountCancellationOperation(
  value: SmartAccountCancellation,
  operation: SmartAccountPackedUserOperation,
  activeValidator: string
): void {
  assertSmartAccountCancellation(value);
  if (
    getAddress(activeValidator) !== value.validator ||
    getAddress(operation.sender) !== value.account ||
    operation.nonce !== value.authorization.operationNonce ||
    !isSmartAccountRevocationOperation(operation)
  )
    unavailable();
}

/** Revoke only this account's full nonce; other keys/nonces remain guarded. */
export function smartAccountCancellationPendingRecords(
  records: SmartAccountPendingRecords,
  value: SmartAccountCancellation,
  assertCurrent: () => void
): SmartAccountPendingRecords {
  assertSmartAccountCancellation(value);
  const keep = (operation: {
    account: string;
    chainId: string;
    operationNonce: string;
  }) =>
    !(
      operation.account === value.account &&
      operation.chainId === String(value.chainId) &&
      operation.operationNonce === value.authorization.operationNonce
    );
  const wrap = (
    source: SmartAccountPendingRecords
  ): SmartAccountPendingRecords =>
    Object.freeze({
      ...source,
      async read(fresh: boolean) {
        assertSynchronousEvmFeeGuard(assertCurrent);
        const entries = await source.read(fresh);
        assertSynchronousEvmFeeGuard(assertCurrent);
        return Object.freeze(entries.filter(keep));
      },
      async readAuthorizations(fresh: boolean) {
        assertSynchronousEvmFeeGuard(assertCurrent);
        const entries = (await source.readAuthorizations?.(fresh)) ?? [];
        assertSynchronousEvmFeeGuard(assertCurrent);
        return Object.freeze(entries.filter(keep));
      },
      filterPendingOperations(operations) {
        assertSynchronousEvmFeeGuard(assertCurrent);
        return (
          source.filterPendingOperations?.(operations) ?? operations
        ).filter(keep);
      },
      filterPendingAuthorizations(operations) {
        assertSynchronousEvmFeeGuard(assertCurrent);
        return (
          source.filterPendingAuthorizations?.(operations) ?? operations
        ).filter(keep);
      },
      ...(source.forAuthorization
        ? {
            forAuthorization: (
              receipt: import('./evmSignedRecords.ts').SmartAccountAuthorizationReceipt
            ) => wrap(source.forAuthorization!(receipt)),
          }
        : {}),
    });
  return wrap(records);
}
export function smartAccountCancellationMetadata(
  value: SmartAccountCancellation,
  operationHash: string
): SmartAccountCancellationMetadata {
  assertSmartAccountCancellation(value);
  if (!HASH.test(operationHash)) return unavailable();
  return Object.freeze({
    account: value.account,
    chainId: String(value.chainId),
    originalHash: value.originalHash,
    originalKind: value.originalKind,
    originalOperationHash: value.authorization.operationHash,
    operationNonce: value.authorization.operationNonce,
    operationHash: operationHash.toLowerCase(),
  });
}
/** Authenticated metadata must also describe the exact signed no-op. */
export function decodeSmartAccountCancellation(
  entry: Pick<
    EvmRetainedSignedRecord,
    'rawTransaction' | 'metadata' | 'chainId' | 'hash'
  >
): SmartAccountCancellationMetadata | null {
  try {
    const data = entry.metadata?.smartAccountOperationCancellation as
      | SmartAccountCancellationMetadata
      | undefined;
    if (
      !data ||
      Object.keys(data).sort().join() !==
        'account,chainId,operationHash,operationNonce,originalHash,originalKind,originalOperationHash' ||
      data.chainId !== entry.chainId ||
      !HASH.test(data.originalHash) ||
      !HASH.test(data.originalOperationHash) ||
      !HASH.test(data.operationHash) ||
      !['transaction', 'authorization'].includes(data.originalKind) ||
      !/^(0|[1-9]\d{0,77})$/.test(data.operationNonce)
    )
      return null;
    const { tx, operation } = decodeCancellationOuter(
      entry.rawTransaction,
      Number(data.chainId)
    );
    if (
      tx.hash !== entry.hash ||
      getAddress(data.account) !== operation.sender ||
      operation.nonce !== data.operationNonce ||
      !isSmartAccountRevocationOperation(operation) ||
      getSmartAccountUserOpHash(
        operation,
        Number(data.chainId)
      ).toLowerCase() !== data.operationHash.toLowerCase()
    )
      return null;
    return Object.freeze({ ...data, account: getAddress(data.account) });
  } catch {
    return null;
  }
}

export type SmartAccountCancellationDispatch = Readonly<{
  cancellation: SmartAccountCancellation;
  replaceOuter: boolean;
  userOperation: SmartAccountPackedUserOperation;
}>;

/** Inspect only inside the caller's fresh, owned read phase. */
export async function inspectSmartAccountCancellationPayer(
  value: SmartAccountCancellation,
  provider: {
    getFeeData(): Promise<any>;
    send(method: string, params: unknown[]): Promise<any>;
  },
  assertCurrent: () => void
) {
  assertSmartAccountCancellation(value);
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (!value.outer) return Object.freeze({ replaceOuter: false as const });
  const original = Transaction.from(value.outer.rawTransaction);
  // The journal proves the original envelope, even before this RPC sees it.
  const observed = await observeEvmTransaction(
    {
      chainId: String(value.chainId),
      from: original.from!,
      hash: value.outer.hash,
      nonce: String(original.nonce),
      to: original.to,
    },
    (method, params) => provider.send(method, [...params]),
    () => assertSynchronousEvmFeeGuard(assertCurrent)
  );
  const nonce =
    observed.status === 'missing'
      ? BigInt(observed.latestNonce)
      : readEvmRpcQuantity(
          await provider.send('eth_getTransactionCount', [
            original.from,
            'latest',
          ])
        );
  assertSynchronousEvmFeeGuard(assertCurrent);
  const originalNonce = BigInt(original.nonce);
  if (nonce > originalNonce)
    return Object.freeze({ replaceOuter: false as const });
  if (nonce < originalNonce || observed.status === 'mined')
    return unavailable();
  const current = await provider.getFeeData();
  assertSynchronousEvmFeeGuard(assertCurrent);
  const { planEvmCancellationFees } = await import(
    '@sidhujag/sysweb3-keyring/cjs/evm-fees.js'
  );
  assertSynchronousEvmFeeGuard(assertCurrent);
  const rates =
    original.type === 0
      ? planEvmCancellationFees({
          type: 0,
          originalGasPrice: original.gasPrice!,
          currentGasPrice: BigInt(current.gasPrice.toString()),
        })
      : original.type === 2
      ? planEvmCancellationFees({
          type: 2,
          originalMaxFeePerGas: original.maxFeePerGas!,
          originalMaxPriorityFeePerGas: original.maxPriorityFeePerGas!,
          currentMaxFeePerGas: BigInt(current.maxFeePerGas.toString()),
          currentMaxPriorityFeePerGas: BigInt(
            current.maxPriorityFeePerGas.toString()
          ),
        })
      : unavailable();
  return Object.freeze({
    replaceOuter: true as const,
    payer: Object.freeze({
      address: original.from!,
      id: value.outer.signer.id,
      type: value.outer.signer.type,
    }),
    feeOverrides: Object.freeze(
      rates.type === 0
        ? { gasPrice: rates.gasPrice.toString() }
        : {
            maxFeePerGas: rates.maxFeePerGas.toString(),
            maxPriorityFeePerGas: rates.maxPriorityFeePerGas.toString(),
          }
    ),
  });
}
