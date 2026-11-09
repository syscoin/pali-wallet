import {
  TypedDataEncoder,
  getAddress,
  isHexString,
} from '../ethersV6Compat.ts';

import type { LedgerTypedData } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types';

export type SmartAccountTypedData = Readonly<LedgerTypedData>;
export type SmartAccountOwnerSigningPurpose =
  | 'user-operation'
  | 'erc7739-personal'
  | 'erc7739-typed-data'
  | 'recovery';
/** Raw-only is an explicit software capability, never a hardware signing fallback. */
export type SmartAccountOwnerSigningIntent = Readonly<
  {
    actionHash: string;
    purpose: SmartAccountOwnerSigningPurpose;
  } & (
    | { representation: 'eip712'; typedData: SmartAccountTypedData }
    | {
        reason: 'unrepresentable-types' | 'recovery-digest';
        representation: 'raw-only';
      }
  )
>;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Ethers owns canonical EIP-712 conversion, including domain fields and numeric bytes. */
export function createSmartAccountTypedSigningIntent(
  purpose: SmartAccountOwnerSigningPurpose,
  data: {
    domain: Record<string, unknown>;
    message: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
  },
  expectedHash: string
): SmartAccountOwnerSigningIntent {
  if (!isHexString(expectedHash, 32))
    throw new Error('Invalid Smart account signing digest');
  const typedData = TypedDataEncoder.getPayload(
    data.domain,
    data.types,
    data.message
  ) as SmartAccountTypedData;
  if (
    TypedDataEncoder.hash(
      data.domain,
      data.types,
      data.message
    ).toLowerCase() !== expectedHash.toLowerCase()
  )
    throw new Error('Smart account typed-data digest changed');
  return freeze({
    actionHash: expectedHash,
    purpose,
    representation: 'eip712' as const,
    typedData,
  });
}

export function createSmartAccountRawSigningIntent(
  purpose: SmartAccountOwnerSigningPurpose,
  actionHash: string,
  reason: 'unrepresentable-types' | 'recovery-digest'
): SmartAccountOwnerSigningIntent {
  if (!isHexString(actionHash, 32))
    throw new Error('Invalid Smart account signing digest');
  return Object.freeze({
    actionHash,
    purpose,
    representation: 'raw-only',
    reason,
  });
}

/** Recheck the full canonical payload before handing it to a device. */
export function assertSmartAccountOwnerSigningIntent(
  intent: SmartAccountOwnerSigningIntent
): void {
  if (
    !intent ||
    ![
      'user-operation',
      'erc7739-personal',
      'erc7739-typed-data',
      'recovery',
    ].includes(intent.purpose) ||
    !isHexString(intent.actionHash, 32)
  )
    throw new Error('Invalid Smart account signing intent');
  if (intent.representation === 'raw-only') {
    if (
      (intent.reason === 'recovery-digest' && intent.purpose === 'recovery') ||
      (intent.reason === 'unrepresentable-types' &&
        intent.purpose === 'erc7739-typed-data')
    )
      return;
    throw new Error('Invalid Smart account raw signing purpose');
  }
  if (intent.representation !== 'eip712' || intent.purpose === 'recovery')
    throw new Error('Invalid Smart account signing intent');
  const types = { ...intent.typedData.types };
  delete types.EIP712Domain;
  if (
    TypedDataEncoder.from(types).primaryType !== intent.typedData.primaryType ||
    TypedDataEncoder.hash(
      intent.typedData.domain,
      types,
      intent.typedData.message
    ).toLowerCase() !== intent.actionHash.toLowerCase()
  )
    throw new Error('Smart account typed-data digest changed');
  if (intent.purpose === 'erc7739-personal')
    getAddress(intent.typedData.domain.verifyingContract);
}
