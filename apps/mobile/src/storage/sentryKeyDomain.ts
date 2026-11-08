import type { SentryNetwork } from '../../../../source/shared/sentryNetworks.ts';
import {
  assertSentryKeyStore,
  isAllowedSentryKeyRoleScheme,
  type ISentryKeyStore,
} from '../../../../source/wallet/sentryKeyVault.ts';
import { decodeBoundedStorageValue, STORAGE_LIMITS } from './json.ts';
import { WalletStorageError } from './types.ts';

export const SENTRY_SLOT_KEYS = {
  mainnet: 'sentry-authority-mainnet',
  testnet: 'sentry-authority-testnet',
} as const;
// A complete bucket with 100 longest encrypted keys and fully escaped labels is 131,919 bytes.
export const SENTRY_SLOT_LIMITS = { ...STORAGE_LIMITS, valueBytes: 132 * 1024 };
export const sentrySlotNetwork = (key: string): SentryNetwork | undefined =>
  key === SENTRY_SLOT_KEYS.mainnet
    ? 'mainnet'
    : key === SENTRY_SLOT_KEYS.testnet
    ? 'testnet'
    : undefined;

const failure = () => new WalletStorageError('STORAGE_CORRUPT');
const isSha256Hex = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value: object, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key));

export function readSentrySlot(
  value: string,
  network: SentryNetwork,
  vaultId?: string
): ISentryKeyStore {
  const bucket = decodeBoundedStorageValue(value, SENTRY_SLOT_LIMITS);
  const id: unknown = (bucket as ISentryKeyStore | null)?.vaultId;
  if (!isSha256Hex(id) || (vaultId !== undefined && id !== vaultId))
    throw failure();
  try {
    assertSentryKeyStore(bucket, id, network);
  } catch {
    throw failure();
  }
  if (
    !exact(bucket, ['keys', 'network', 'vaultId', 'version']) ||
    new Set(bucket.keys.map(({ summary }) => summary.id)).size !==
      bucket.keys.length ||
    bucket.keys.some(
      (entry) =>
        !exact(entry, ['ciphertext', 'iv', 'summary']) ||
        !exact(entry.summary, [
          'id',
          'label',
          'network',
          'publicKey',
          'role',
          'scheme',
        ]) ||
        !isAllowedSentryKeyRoleScheme(
          entry.summary.role,
          entry.summary.scheme
        ) ||
        !/^[a-f0-9]{24}$/.test(entry.iv) ||
        // The longest plaintext is the 271-byte SHAKE operator key. AES-GCM adds 16 bytes.
        !/^(?:[a-f0-9]{2}){16,287}$/.test(entry.ciphertext)
    )
  )
    throw failure();
  return bucket;
}
