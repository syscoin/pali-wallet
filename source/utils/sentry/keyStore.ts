import { createSentryKeyVault } from '../../wallet/sentryKeyVault';
import { chromeStorage } from 'utils/storageAPI';

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
