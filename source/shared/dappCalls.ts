import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { errorCodes } from '../helpers/errors/errorConstants.ts';
import {
  assertJsonWorkBudget,
  DAPP_REQUEST_LIMITS,
} from '../utils/requestPayloadBudget.ts';

import { normalizeDappTransaction } from './dappTransaction.ts';

type DappCallCapabilities = Readonly<
  Record<string, Readonly<Record<string, unknown> & { optional: true }>>
>;

export type DappCall = Readonly<{
  capabilities?: DappCallCapabilities;
  data: string;
  to?: string | null;
  value: string;
}>;

export type DappCallsRequest = Readonly<{
  atomicRequired: boolean;
  calls: readonly DappCall[];
  capabilities?: DappCallCapabilities;
  chainId?: string;
  from?: string;
  id?: string;
  version: '1.0' | '2.0.0';
}>;

const invalid = (message: string): never => {
  throw new EthereumRpcErrorHandler(errorCodes.rpc.invalidParams, message);
};

const unsupported = (code: 5700 | 5760, message: string): never => {
  throw new EthereumRpcErrorHandler(code, message);
};

// The batch sender cannot honor these per-call transaction constraints.
const UNSUPPORTED_CALL_TRANSACTION_FIELDS = [
  'from',
  'chainId',
  'nonce',
  'gas',
  'gasLimit',
  'gasPrice',
  'maxFeePerGas',
  'maxPriorityFeePerGas',
  'type',
  'accessList',
  'input',
  'authorizationList',
  'blobVersionedHashes',
  'blobs',
  'maxFeePerBlobGas',
  'kzg',
  'signature',
  'hash',
];

// Atomicity is selected separately. No other required capability is implemented.
const readCapabilities = (input: unknown): DappCallCapabilities | undefined => {
  if (input === undefined) return;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid('Invalid capabilities');
  for (const capability of Object.values(input)) {
    if (
      !capability ||
      typeof capability !== 'object' ||
      Array.isArray(capability) ||
      ('optional' in capability && typeof capability.optional !== 'boolean')
    )
      return invalid('Invalid capability');
    if (!('optional' in capability) || capability.optional !== true)
      return unsupported(5700, 'Unsupported non-optional capability');
  }
  return input as DappCallCapabilities;
};

/** Capture bounded wire data before account selection, approval or reservation. */
export function normalizeDappCallsRequest(input: unknown): DappCallsRequest {
  assertJsonWorkBudget(input, DAPP_REQUEST_LIMITS.batchBytes);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return invalid('Expected one calls request');
  // The budget rejects accessors and custom serialization before this detached
  // JSON snapshot. Non-enumerable fields never become wire request authority.
  const request = JSON.parse(JSON.stringify(input));
  if (request.version !== '1.0' && request.version !== '2.0.0')
    return invalid('Unsupported calls request version');
  if (
    request.atomicRequired !== undefined &&
    typeof request.atomicRequired !== 'boolean'
  )
    return invalid('Invalid atomicRequired');
  if (
    !Array.isArray(request.calls) ||
    request.calls.length === 0 ||
    request.calls.length > DAPP_REQUEST_LIMITS.calls
  )
    return invalid(`Expected between 1 and ${DAPP_REQUEST_LIMITS.calls} calls`);
  if (
    request.id !== undefined &&
    (typeof request.id !== 'string' ||
      !/^0x[0-9a-fA-F]+$/.test(request.id) ||
      request.id.length > 8194)
  )
    return invalid(
      'wallet_sendCalls id must be a 0x-prefixed hex string of at most 4096 bytes.'
    );

  const context = normalizeDappTransaction({
    from: request.from,
    chainId: request.chainId,
  });
  if (
    context.chainId !== undefined &&
    (BigInt(context.chainId) === BigInt(0) ||
      BigInt(context.chainId) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    return invalid('Invalid calls request chainId');
  const capabilities = readCapabilities(request.capabilities);
  const calls = request.calls.map((call: unknown): DappCall => {
    if (!call || typeof call !== 'object' || Array.isArray(call))
      return invalid('Invalid call');
    if (
      UNSUPPORTED_CALL_TRANSACTION_FIELDS.some((field) =>
        Object.hasOwn(call, field)
      )
    )
      return invalid('Unsupported call field');
    const fields = call as Record<string, unknown>;
    const normalized = normalizeDappTransaction({
      to: fields.to,
      value: fields.value,
      data: fields.data,
    });
    const callCapabilities = readCapabilities(fields.capabilities);
    return {
      ...(normalized.to === undefined ? {} : { to: normalized.to }),
      value: normalized.value ?? '0x0',
      data: normalized.data,
      ...(callCapabilities === undefined
        ? {}
        : { capabilities: callCapabilities }),
    };
  });
  const result: DappCallsRequest = {
    version: request.version,
    atomicRequired: request.atomicRequired ?? false,
    calls,
    ...(context.from === undefined ? {} : { from: context.from }),
    ...(context.chainId === undefined ? {} : { chainId: context.chainId }),
    ...(request.id === undefined ? {} : { id: request.id }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
  const pending: object[] = [result];
  while (pending.length) {
    const value = pending.pop()!;
    Object.freeze(value);
    for (const child of Object.values(value))
      if (child && typeof child === 'object') pending.push(child);
  }
  return result;
}

/** The host derives support from the captured account on the selected chain. */
export function assertDappCallsAtomicSupport(
  request: DappCallsRequest,
  atomicSupported: boolean
): void {
  if (request.atomicRequired && !atomicSupported)
    unsupported(
      5760,
      'Atomic wallet_sendCalls requires an active smart account on the selected chain.'
    );
}
