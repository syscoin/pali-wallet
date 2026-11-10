import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { getAddress } from '../ethersV6Compat.ts';

import {
  createSmartAccountTypedSigningIntent,
  assertSmartAccountOwnerSigningIntent,
  type SmartAccountOwnerSigningIntent,
  type SmartAccountTypedData,
} from './ownerSigningIntent.ts';
import type { KeyringManager } from '@sidhujag/sysweb3-keyring';
import type { EvmSigningIdentity } from '@sidhujag/sysweb3-keyring/cjs/transactions/prepared-evm';

// The SDK's enum is a wire string. Keep the shared software/native module free
// of the device SDK's runtime dependency; V4 is the only canonical device intent.
type OwnerTypedVersion = Extract<
  Parameters<
    KeyringManager['ledgerSigner']['evm']['signTypedData']
  >[0]['version'],
  'V4'
>;
const TYPED_DATA_V4 = 'V4' as OwnerTypedVersion;

export type SmartAccountOwnerIdentity = Readonly<{
  address: string;
  id: number;
  type: EvmSigningIdentity['type'];
}>;
export type SmartAccountSelectedIdentity = EvmSigningIdentity;
export type SmartAccountOwnerAuthority = Readonly<{
  assertCurrent(): void;
  signal: AbortSignal;
}>;
/** Explicit unavailable hardware ports retain the native software capability boundary. */
export type SmartAccountOwnerSigningSdk = Readonly<{
  ledger: null | Readonly<{
    signTypedData(
      request: {
        accountIndex: number;
        data: SmartAccountTypedData;
        expectedAddress: string;
        version: OwnerTypedVersion;
      },
      authority: SmartAccountOwnerAuthority
    ): Promise<string>;
  }>;
  rawSign(
    params: string[],
    options: {
      assertCurrent(): void;
      selectedAccount: SmartAccountSelectedIdentity;
      signal: AbortSignal;
      targetAccount: SmartAccountSelectedIdentity;
    }
  ): Promise<string>;
  trezor: null | Readonly<{
    signTypedData(
      request: {
        address: string;
        data: SmartAccountTypedData;
        index: number;
        version: OwnerTypedVersion;
      },
      authority: SmartAccountOwnerAuthority
    ): Promise<string>;
  }>;
}>;

/** One owner route for both hosts; no account mutation or personal-prefix fallback. */
export async function signSmartAccountOwnerIntent(
  params: Readonly<{
    authority: SmartAccountOwnerAuthority;
    intent: SmartAccountOwnerSigningIntent;
    owner: SmartAccountOwnerIdentity;
    sdk: SmartAccountOwnerSigningSdk;
    selectedSmart: SmartAccountSelectedIdentity;
  }>
): Promise<string> {
  const { sdk } = params;
  const suppliedIntent = params.intent;
  assertSmartAccountOwnerSigningIntent(suppliedIntent);
  const types =
    suppliedIntent.representation === 'eip712'
      ? { ...suppliedIntent.typedData.types }
      : {};
  delete types.EIP712Domain;
  const intent =
    suppliedIntent.representation === 'eip712'
      ? createSmartAccountTypedSigningIntent(
          suppliedIntent.purpose,
          {
            domain: { ...suppliedIntent.typedData.domain },
            types,
            message: suppliedIntent.typedData.message,
          },
          suppliedIntent.actionHash
        )
      : Object.freeze({ ...suppliedIntent });
  const selectedSmart = Object.freeze({
    ...params.selectedSmart,
    expectedAddress: getAddress(params.selectedSmart.expectedAddress),
  });
  const owner = Object.freeze({
    ...params.owner,
    address: getAddress(params.owner.address),
  });
  const { signal, assertCurrent } = params.authority;
  const check = () => {
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (
      !signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function'
    )
      throw new Error('Smart account owner authority is required');
    if (signal.aborted) throw new Error('Smart account owner approval expired');
  };
  check();
  if (
    typeof sdk?.rawSign !== 'function' ||
    !Object.hasOwn(sdk, 'ledger') ||
    !Object.hasOwn(sdk, 'trezor') ||
    (sdk.ledger !== null && typeof sdk.ledger?.signTypedData !== 'function') ||
    (sdk.trezor !== null && typeof sdk.trezor?.signTypedData !== 'function')
  )
    throw new Error('Smart account owner signing ports are required');
  const rawSign = sdk.rawSign.bind(sdk),
    ledger = sdk.ledger,
    trezor = sdk.trezor;
  if (
    selectedSmart.type !== 'SmartAccount' ||
    !Number.isSafeInteger(selectedSmart.id) ||
    selectedSmart.id < 0 ||
    !Number.isSafeInteger(owner.id) ||
    owner.id < 0 ||
    !['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(owner.type)
  )
    throw new Error('Smart account owner identity changed');
  assertSmartAccountOwnerSigningIntent(intent);
  if (intent.representation === 'eip712') {
    const account =
      intent.purpose === 'user-operation'
        ? intent.typedData.message.sender
        : intent.purpose === 'erc7739-personal'
        ? intent.typedData.domain.verifyingContract
        : intent.typedData.message.verifyingContract;
    if (getAddress(account) !== selectedSmart.expectedAddress)
      throw new Error('Smart account signing intent account changed');
  }
  const authority = Object.freeze({ signal, assertCurrent: check });
  let result: string;
  if (owner.type === 'HDAccount' || owner.type === 'Imported') {
    result = await rawSign([owner.address, intent.actionHash], {
      selectedAccount: selectedSmart,
      targetAccount: {
        id: owner.id,
        type: owner.type,
        expectedAddress: owner.address,
      },
      assertCurrent: check,
      signal,
    });
  } else {
    if (intent.representation !== 'eip712')
      throw new Error(
        'This Smart account signing intent is not supported by hardware wallets'
      );
    check();
    if (owner.type === 'Ledger') {
      if (ledger === null)
        throw new Error('Ledger Smart account owner signing is unavailable');
      result = await ledger!.signTypedData(
        {
          accountIndex: owner.id,
          expectedAddress: owner.address,
          data: intent.typedData,
          version: TYPED_DATA_V4,
        },
        authority
      );
    } else {
      if (trezor === null)
        throw new Error('Trezor Smart account owner signing is unavailable');
      result = await trezor!.signTypedData(
        {
          index: owner.id,
          address: owner.address,
          data: intent.typedData,
          version: TYPED_DATA_V4,
        },
        authority
      );
    }
  }
  check();
  return result;
}
