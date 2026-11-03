import {
  createPrivateVaultController as createPrivateVaultCore,
  IPrivateVaultDependencies,
  IPrivateVaultHost,
} from '../../../wallet/privateVault';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { generateClassicNote, identifyClassicNote } from 'utils/privacy/note';
import { chromeStorage } from 'utils/storageAPI';

export {
  PRIVATE_VAULT_DOMAIN,
  PRIVATE_VAULT_STORAGE_PREFIX,
} from '../../../wallet/privateVault';
export type {
  IPrivateVaultDependencies,
  IPrivateVaultDepositController,
  IPrivateVaultDepositJournal,
  IPrivateVaultHost,
  IPrivateVaultMutex,
  IPrivateVaultSession,
  IPrivateVaultStorage,
  IPrivateVaultWithdrawalController,
  IPrivateVaultWithdrawalJournal,
} from '../../../wallet/privateVault';

// Preserve malformed present values so the core can reject them as corrupt.
// The general getItem helper normalizes falsy values to absence.
const defaultStorage: IPrivateVaultDependencies['storage'] = {
  getItem: async (key) => {
    const records = await chromeStorage.getItems([key]);
    return records[key] ?? null;
  },
  setItem: (key, value) => chromeStorage.setItem(key, value),
};

/** Extension composition root. Keep host defaults out of the shared engine. */
export function createPrivateVaultController(
  host: IPrivateVaultHost,
  dependencies: Partial<IPrivateVaultDependencies> = {}
): ReturnType<typeof createPrivateVaultCore> {
  return createPrivateVaultCore(host, {
    storage: dependencies.storage || defaultStorage,
    mutex: dependencies.mutex || walletPersistenceMutex,
    identify: dependencies.identify || identifyClassicNote,
    generate: dependencies.generate || generateClassicNote,
    now: dependencies.now || Date.now,
    // Historically cleanup deadlines used wall time even when tests or callers
    // overrode the persisted-record timestamp clock above.
    deadlineNow: dependencies.deadlineNow || (() => Date.now()),
    randomId: dependencies.randomId || (() => crypto.randomUUID()),
  });
}
