import {
  createSentryKeyVault,
  isEmptySentryKeyStore,
  sentryKeyVaultStorageKey,
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
  const networks = Object.keys(
    SENTRY_NETWORKS
  ) as (keyof typeof SENTRY_NETWORKS)[];
  const stores = networks.map((network) => ({
    network,
    key: sentryKeyVaultStorageKey(vaultId, network),
  }));
  const saved = await chromeStorage.getItems(stores.map(({ key }) => key));
  assertCurrent();
  const empty: Record<string, unknown> = {};
  for (const { network, key } of stores) {
    const record = saved[key];
    if (record === undefined || record === null) continue;
    if (!isEmptySentryKeyStore(record, vaultId, network))
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
