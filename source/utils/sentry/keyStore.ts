import {
  createSentryKeyVault,
  isEmptySentryKeyStore,
  sentryKeyVaultStoragePrefix,
} from '../../wallet/sentryKeyVault';
import { chromeStorage } from 'utils/storageAPI';

import { SENTRY_NETWORKS } from './network';
import { withSentryPersistence } from './persistence';

export const {
  getSentryVaultId,
  listSentryKeys,
  loadSentryKey,
  removeSentryKey,
  saveSentryKeys,
} = createSentryKeyVault({
  crypto: () => crypto,
  read: (key) => chromeStorage.getItem(key),
  write: (key, value, assertCurrent) =>
    withSentryPersistence(assertCurrent, () =>
      chromeStorage.setItem(key, value)
    ),
});

/** Called with walletPersistenceMutex held through the network removal commit. */
export async function readSentryKeyStoresForRetirement(
  rootPublicIdentity: string,
  assertCurrent: () => void
): Promise<Record<string, unknown>> {
  const vaultId = await getSentryVaultId(rootPublicIdentity);
  assertCurrent();
  // The wallet's recovery reader examines every record in this namespace,
  // so retirement must also account for an unknown domain before deleting its owner.
  const prefix = sentryKeyVaultStoragePrefix(vaultId);
  const saved = await chromeStorage.getItems(null);
  assertCurrent();
  const empty: Record<string, unknown> = {};
  for (const [key, record] of Object.entries(saved)) {
    if (!key.startsWith(prefix) || record === undefined || record === null)
      continue;
    const network = key.slice(prefix.length) as keyof typeof SENTRY_NETWORKS;
    if (
      !Object.hasOwn(SENTRY_NETWORKS, network) ||
      !isEmptySentryKeyStore(record, vaultId, network)
    )
      throw Object.assign(
        new Error('Keep this network while it has saved Sentry keys.'),
        {
          code: 'UTXO_NETWORK_HAS_SENTRY_KEYS',
        }
      );
    empty[key] = record;
  }
  return empty;
}

export async function saveSentryKey({
  key,
  label,
  ...scope
}: Omit<Parameters<typeof saveSentryKeys>[0], 'entries'> &
  Parameters<typeof saveSentryKeys>[0]['entries'][number]) {
  const summaries = await saveSentryKeys({
    ...scope,
    entries: [{ key, label }],
  });
  return summaries[0];
}
