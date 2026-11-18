import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';

import { EVM_SIGNED_RECORD_LIMITS } from '../shared/evmSignedRecordLimits.ts';
import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';
import {
  encodeERC7579Executions,
  type SmartAccountPackedUserOperation,
} from '../utils/smartAccount/account.ts';
import { paliSmartAccountInterface } from '../utils/smartAccount/contracts.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

export type SmartAccountAuthorizationBlock = Readonly<{
  hash: string;
  number: string;
}>;
/** An inner instruction has no outer transaction hash or payer nonce. */
export type SmartAccountAuthorizationSummary = Readonly<{
  account: string;
  chainId: string;
  createdAt: number;
  observedAt: SmartAccountAuthorizationBlock;
  operationHash: string;
  operationNonce: string;
  payer: string;
  replacesOperationHash?: string;
}>;
export type RetainedSmartAccountAuthorization =
  SmartAccountAuthorizationSummary &
    Readonly<{
      signatureDigest?: string;
      userOperation: SmartAccountPackedUserOperation;
    }>;

const encoder = new TextEncoder();
const maximum = (BigInt(1) << BigInt(256)) - BigInt(1);
const fields = [
  'sender',
  'nonce',
  'initCode',
  'callData',
  'accountGasLimits',
  'preVerificationGas',
  'gasFees',
  'paymasterAndData',
  'signature',
] as const;
const invalid = (): never => {
  throw new Error('SMART_ACCOUNT_AUTHORIZATION_CORRUPT');
};

function exact(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return invalid();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
  }
  return value as Record<string, unknown>;
}
function quantity(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,77})$/.test(value) ||
    BigInt(value) > maximum
  )
    return invalid();
  return value;
}
function address(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^0x[\da-f]{40}$/i.test(value) ||
    /^0x0{40}$/i.test(value)
  )
    return invalid();
  try {
    return getAddress(value);
  } catch {
    return invalid();
  }
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[\da-f]{64}$/i.test(value))
    return invalid();
  return value.toLowerCase();
}
function bytes(value: unknown, length?: number): string {
  if (
    typeof value !== 'string' ||
    value.length > EVM_SIGNED_RECORD_LIMITS.bytes ||
    !/^0x(?:[\da-f]{2})*$/i.test(value) ||
    (length !== undefined && value.length !== 2 + length * 2)
  )
    return invalid();
  return value.toLowerCase();
}
export function captureSignedSmartAccountOperation(
  value: unknown
): SmartAccountPackedUserOperation {
  return captureOperation(value, true);
}
function captureOperation(
  value: unknown,
  signed: boolean
): SmartAccountPackedUserOperation {
  const source = exact(value, fields);
  const operation = Object.freeze({
    sender: address(source.sender),
    nonce: quantity(source.nonce),
    initCode: bytes(source.initCode),
    callData: bytes(source.callData),
    accountGasLimits: bytes(source.accountGasLimits, 32),
    preVerificationGas: quantity(source.preVerificationGas),
    gasFees: bytes(source.gasFees, 32),
    paymasterAndData: bytes(source.paymasterAndData),
    signature: bytes(source.signature),
  });
  if (
    (signed ? operation.signature === '0x' : operation.signature !== '0x') ||
    operation.paymasterAndData !== '0x'
  )
    return invalid();
  // Bound the aggregate before encoding or encrypting its chunks.
  if (JSON.stringify(operation).length > EVM_SIGNED_RECORD_LIMITS.bytes)
    return invalid();
  return operation;
}
export function isSmartAccountRevocationOperation(
  operation: SmartAccountPackedUserOperation
): boolean {
  const noop = encodeERC7579Executions([
    { target: getAddress(operation.sender), value: '0x0', data: '0x' },
  ]);
  return (
    operation.paymasterAndData === '0x' &&
    operation.callData.toLowerCase() ===
      paliSmartAccountInterface
        .encodeFunctionData('execute', [noop.mode, noop.executionCalldata])
        .toLowerCase()
  );
}

export function captureSmartAccountAuthorization(
  input: Readonly<{
    chainId: number;
    createdAt: number;
    observedAt: SmartAccountAuthorizationBlock;
    payer: string;
    replacesOperationHash?: string;
    userOperation: SmartAccountPackedUserOperation;
  }>
): RetainedSmartAccountAuthorization {
  return captureAuthorization(input, true);
}
function captureAuthorization(
  input: Parameters<typeof captureSmartAccountAuthorization>[0],
  signed: boolean
): RetainedSmartAccountAuthorization {
  if (
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0
  )
    return invalid();
  const observed = exact(input.observedAt, ['hash', 'number']);
  const userOperation = captureOperation(input.userOperation, signed);
  const operationHash = getSmartAccountUserOpHash(
    userOperation,
    input.chainId
  ).toLowerCase();
  const original =
    input.replacesOperationHash === undefined
      ? undefined
      : hash(input.replacesOperationHash);
  if (
    original === operationHash ||
    (original !== undefined &&
      !isSmartAccountRevocationOperation(userOperation))
  )
    return invalid();
  return Object.freeze({
    account: userOperation.sender,
    chainId: String(input.chainId),
    createdAt: input.createdAt,
    observedAt: Object.freeze({
      hash: hash(observed.hash),
      number: quantity(observed.number),
    }),
    operationHash,
    operationNonce: userOperation.nonce,
    payer: address(input.payer),
    ...(original === undefined ? {} : { replacesOperationHash: original }),
    userOperation,
  });
}
export function smartAccountAuthorizationSummary(
  value: RetainedSmartAccountAuthorization
): SmartAccountAuthorizationSummary {
  const {
    userOperation: _operation,
    signatureDigest: _digest,
    ...summary
  } = value;
  void _digest;
  void _operation;
  return Object.freeze(summary);
}
export function captureSmartAccountAuthorizationSummary(
  value: unknown
): SmartAccountAuthorizationSummary {
  const optional =
    value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'replacesOperationHash');
  const source = exact(value, [
    'account',
    'chainId',
    'createdAt',
    'observedAt',
    'operationHash',
    'operationNonce',
    'payer',
    ...(optional ? ['replacesOperationHash'] : []),
  ]);
  if (
    typeof source.chainId !== 'string' ||
    !/^[1-9]\d*$/.test(source.chainId) ||
    !Number.isSafeInteger(Number(source.chainId)) ||
    !Number.isSafeInteger(source.createdAt) ||
    Number(source.createdAt) < 0
  )
    return invalid();
  const observed = exact(source.observedAt, ['hash', 'number']);
  const summary = Object.freeze({
    account: address(source.account),
    chainId: source.chainId,
    createdAt: Number(source.createdAt),
    observedAt: Object.freeze({
      hash: hash(observed.hash),
      number: quantity(observed.number),
    }),
    operationHash: hash(source.operationHash),
    operationNonce: quantity(source.operationNonce),
    payer: address(source.payer),
    ...(optional
      ? { replacesOperationHash: hash(source.replacesOperationHash) }
      : {}),
  });
  if (
    summary.account !== source.account ||
    summary.payer !== source.payer ||
    summary.operationHash !== source.operationHash ||
    summary.operationHash === summary.replacesOperationHash ||
    observed.hash !== summary.observedAt.hash ||
    (optional && source.replacesOperationHash !== summary.replacesOperationHash)
  )
    return invalid();
  return summary;
}
export function encodeSmartAccountAuthorization(
  value: RetainedSmartAccountAuthorization
): Uint8Array {
  // Randomized revocations reuse their first authenticated proof across restart.
  // Ordinary instructions need only the original proof digest for exact retries.
  const { signature, ...operation } = value.userOperation;
  const serialized = JSON.stringify(
    value.replacesOperationHash
      ? value.userOperation
      : {
          ...operation,
          signatureDigest: value.signatureDigest ?? keccak256(signature),
        }
  );
  if (serialized.length > EVM_SIGNED_RECORD_LIMITS.bytes) return invalid();
  return encoder.encode(serialized);
}
export function decodeSmartAccountAuthorization(
  summary: SmartAccountAuthorizationSummary,
  payload: Uint8Array
): RetainedSmartAccountAuthorization {
  summary = captureSmartAccountAuthorizationSummary(summary);
  if (!payload.length || payload.length > EVM_SIGNED_RECORD_LIMITS.bytes)
    return invalid();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(payload);
  assertJsonTextBudget(text, {
    depth: 3,
    nodes: 32,
    tokenCharacters: EVM_SIGNED_RECORD_LIMITS.bytes,
  });
  const parsed = JSON.parse(text);
  const compact =
    parsed !== null &&
    typeof parsed === 'object' &&
    Object.hasOwn(parsed, 'signatureDigest');
  let signatureDigest: string | undefined;
  if (compact) {
    if (summary.replacesOperationHash) return invalid();
    const stored = exact(parsed, [
      ...fields.filter((field) => field !== 'signature'),
      'signatureDigest',
    ]);
    signatureDigest = hash(stored.signatureDigest);
  }
  const { signatureDigest: _digest, ...unsigned } = compact ? parsed : {};
  void _digest;
  const userOperation = compact
    ? captureOperation({ ...unsigned, signature: '0x' }, false)
    : captureSignedSmartAccountOperation(parsed);
  const { signature: _signature, ...canonicalUnsigned } = userOperation;
  void _signature;
  if (
    JSON.stringify(
      compact ? { ...canonicalUnsigned, signatureDigest } : userOperation
    ) !== text
  )
    return invalid();
  const captured = captureAuthorization(
    {
      chainId: Number(summary.chainId),
      createdAt: summary.createdAt,
      observedAt: summary.observedAt,
      payer: summary.payer,
      userOperation,
      ...(summary.replacesOperationHash === undefined
        ? {}
        : { replacesOperationHash: summary.replacesOperationHash }),
    },
    !compact
  );
  if (
    captured.chainId !== summary.chainId ||
    captured.account !== summary.account ||
    captured.operationHash !== summary.operationHash ||
    captured.operationNonce !== summary.operationNonce
  )
    return invalid();
  return compact ? Object.freeze({ ...captured, signatureDigest }) : captured;
}
