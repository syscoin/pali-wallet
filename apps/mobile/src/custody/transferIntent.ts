import {
  encodeErc20Transfer,
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import {
  encodeNftTransferData,
  snapshotNftTransferIntent,
  type NftTransferIntent,
} from '../../../../source/shared/nftTransfer.ts';
import {
  normalizeErc20Address,
  parseErc20Metadata,
} from '../portfolio/erc20Metadata.ts';

/** Saved interpretation of a reviewed token transfer; never reloaded on retry. */
export type Erc20TransferIntent = Readonly<{
  kind: 'erc20-transfer';
  chainId: string;
  token: Erc20Metadata;
  recipient: string;
  amountUnits: string;
}>;

export type NativeAssetTransferIntent = Erc20TransferIntent | NftTransferIntent;

export function snapshotNativeAssetTransferIntent(value: unknown): NativeAssetTransferIntent {
  const kind = value && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, 'kind')?.value
    : undefined;
  return kind === 'nft-transfer'
    ? snapshotNftTransferIntent(value)
    : snapshotErc20TransferIntent(value);
}

export function snapshotErc20TransferIntent(
  value: unknown
): Erc20TransferIntent {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Invalid transfer intent');
  const fields = ['kind', 'chainId', 'token', 'recipient', 'amountUnits'];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    throw new Error('Invalid transfer intent');
  const own = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new Error('Invalid transfer intent');
    return descriptor.value;
  };
  if (own('kind') !== 'erc20-transfer')
    throw new Error('Invalid transfer intent');
  const chainId = own('chainId');
  if (typeof chainId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(chainId) || BigInt(chainId) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid transfer chain');
  const intent = Object.freeze({
    kind: 'erc20-transfer' as const,
    chainId,
    token: parseErc20Metadata(own('token')),
    recipient: normalizeErc20Address(own('recipient')),
    amountUnits: parseErc20Units(own('amountUnits')),
  });
  if (intent.amountUnits === '0') throw new Error('Invalid transfer intent');
  return intent;
}

export function equalTransferIntent(
  left: Erc20TransferIntent | undefined,
  right: Erc20TransferIntent | undefined
): boolean {
  if (!left || !right) return left === right;
  return (
    left.kind === right.kind &&
    left.chainId === right.chainId &&
    left.recipient === right.recipient &&
    left.amountUnits === right.amountUnits &&
    left.token.contractAddress === right.token.contractAddress &&
    left.token.decimals === right.token.decimals &&
    left.token.name === right.token.name &&
    left.token.symbol === right.token.symbol
  );
}

/** This host permits only native transfers or exact reviewed asset calls. */
export function assertTransferIntentEnvelope(
  transaction: Readonly<{
    chainId: string;
    from?: string;
    to: string;
    value: string;
    data: string;
  }>,
  intent?: NativeAssetTransferIntent
): void {
  if (
    !transaction ||
    typeof transaction !== 'object' ||
    Array.isArray(transaction) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(transaction))
  )
    throw new Error('Invalid transfer envelope');
  const own = (key: string): string => {
    const descriptor = Object.getOwnPropertyDescriptor(transaction, key);
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    )
      throw new Error('Invalid transfer envelope');
    return descriptor.value;
  };
  const chainId = own('chainId'),
    to = own('to'),
    value = own('value'),
    data = own('data');
  if (!intent) {
    if (data !== '0x') throw new Error('Unsupported transfer data');
    return;
  }
  const checked = snapshotNativeAssetTransferIntent(intent);
  const nft = checked.kind === 'nft-transfer';
  if (
    chainId !== checked.chainId ||
    to !== (nft ? checked.contractAddress : checked.token.contractAddress) ||
    value !== '0' ||
    (nft && own('from') !== checked.from) ||
    data !== (nft
      ? encodeNftTransferData(checked)
      : encodeErc20Transfer(checked.recipient, checked.amountUnits))
  )
    throw new Error('Transfer differs from reviewed intent');
}
