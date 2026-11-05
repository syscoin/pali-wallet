import {
  combineReducers,
  configureStore,
  Store,
  Middleware, // Import Middleware type
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
// Assuming redux-thunk v3+, which exports 'thunk' and ThunkMiddleware type
import { thunk, ThunkMiddleware } from 'redux-thunk';

import { jsonStorageEqual } from '../shared/jsonStorageEqual';
import {
  importedRecoveryStorageKeyForIdentity,
  snapshotImportedRecoveryEntry,
} from '../wallet/importedAccountRecoveryFormat';
import {
  IKeyringAccountState,
  INetwork,
  ISmartAccountMetadata,
  KeyringAccountType,
} from 'types/network';
import { ISpamFilterState } from 'types/security';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import dapp, { addDApp, removeDApp } from './dapp';
import { IDApp, IDAppState } from './dapp/types';
import {
  assertWalletPersistenceAllowed,
  loadPasskeyCredentialProfileState,
  loadState,
  saveCommittedWalletState,
  saveState,
  savePasskeyCredentialProfileState,
  walletPersistenceGate,
} from './paliStorage';
import price, { setPrices } from './price';
import { IPriceState } from './price/types';
import spamFilter from './spamFilter';
import { IPersistState } from './types';
import vault, {
  rehydrate as vaultRehydrate,
  initializeCleanVaultForSlip44,
  restoreVaultSnapshot,
  createAccount,
  removeAccount,
  setActiveAccount,
  setAccountLabel,
  setAccountAssets,
  setAccountPropertyByIdAndType,
} from './vault';
import { IVaultState, IGlobalState } from './vault/types';
import vaultCache, { getSlip44ForNetwork } from './vaultCache';
import vaultGlobal, {
  setActiveSlip44,
  setAdvancedSettings,
  setHasEthProperty,
  setNetwork,
  removeNetwork,
} from './vaultGlobal';
import type {
  ImportedRecoveryEntry,
  ImportedRecoveryIdentity,
} from '../wallet/importedAccountRecoveryFormat';

// Define RootState earlier if possible, or use a more generic type for ThunkMiddleware initially
// For now, let's assume RootState will be defined later and use 'any' for the thunk state type.

const reducers = combineReducers({
  dapp,
  price,
  vault,
  vaultGlobal,
  spamFilter,
});

const nodeEnv = process.env.NODE_ENV;

// Explicitly type the array we are building for custom middleware
const customMiddlewareToAdd: Middleware[] = [];

// Add your custom thunk first
customMiddlewareToAdd.push(thunk as ThunkMiddleware<any, any>); // Using any for RootState for now

// In development, add logger - DISABLED to reduce console noise
// if (nodeEnv !== 'production' && nodeEnv !== 'test') {
//   customMiddlewareToAdd.push(logger); // redux-logger is typically compatible, cast with 'as Middleware' if needed
// }

const store: Store<{
  dapp: IDAppState;
  price: IPriceState;
  spamFilter: ISpamFilterState;
  vault: IVaultState;
  vaultGlobal: IGlobalState;
  // _persist: IPersistState; // If _persist is part of the direct store state, include it here
}> = configureStore({
  reducer: reducers,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      thunk: false, // We are adding our own thunk instance
      serializableCheck: false,
    }).concat(customMiddlewareToAdd), // Concat our custom middleware array
  devTools: nodeEnv !== 'production' && nodeEnv !== 'test',
});

export function restoreSourceVaultAfterUncommittedSwitch(
  sourceSlip44: number,
  sourceVault: IVaultState
): boolean {
  if (store.getState().vaultGlobal.activeSlip44 !== sourceSlip44) {
    return false;
  }

  store.dispatch(restoreVaultSnapshot(sourceVault));
  return true;
}

// Cache the last persisted state locally to avoid the expensive
// read-&-parse cycle from chrome.storage on every store update. This
// drastically reduces the amount of asynchronous I/O **and** the number of
// full-state JSON serialisations.

let lastPersistedState: any | null = null;

const getPersistedGlobalState = (state: IGlobalState) => {
  const persisted = { ...state };
  delete persisted.transactionHistoryStatus;
  return persisted;
};

const getMainStateForStorage = (state: ReturnType<typeof store.getState>) => ({
  dapp: state.dapp,
  price: state.price,
  vaultGlobal: getPersistedGlobalState(state.vaultGlobal),
});

const isMainStateUnchanged = (state: ReturnType<typeof store.getState>) =>
  Boolean(
    lastPersistedState &&
      isEqual(lastPersistedState.dapp, state.dapp) &&
      isEqual(lastPersistedState.price, state.price) &&
      isEqual(
        getPersistedGlobalState(lastPersistedState.vaultGlobal),
        getPersistedGlobalState(state.vaultGlobal)
      )
  );

// Initialize cache once on startup.
(async () => {
  try {
    lastPersistedState = await loadState();
  } catch (e) {
    // Non-fatal – cache will be initialised on first successful persist.
    console.warn('Unable to preload persisted state cache', e);
  }
})();

// Internal variant for callers that already hold walletPersistenceMutex.
export async function saveMainStateWithinPersistenceLock() {
  if (walletPersistenceGate.blocked) return false;
  try {
    const state = store.getState();

    // Fast in-memory comparison first. This avoids hitting chrome.storage
    // for the common case where nothing relevant has changed.
    if (isMainStateUnchanged(state)) {
      return false;
    }
    // Create main state with only global data (dapp, price, vaultGlobal)
    const mainState = getMainStateForStorage(state);

    await saveState(mainState);
    lastPersistedState = state;
    return true;
  } catch (error) {
    console.error('saveMainState() failed', error);
    return false;
  }
}

// Manual state persistence for important operations
export async function saveMainState() {
  return walletPersistenceMutex.runExclusive(() =>
    saveMainStateWithinPersistenceLock()
  );
}

/** Persist an acknowledged permission change without best-effort save semantics. */
export async function persistMainStateStrict(
  onFailure?: () => void
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    const mainState = getMainStateForStorage(store.getState());
    // Both saveMainState and saveState intentionally swallow some failures.
    // A permission revocation must instead observe the actual storage result,
    // even if a prior best-effort save left the cache claiming no change.
    try {
      await chromeStorage.setItem('state', mainState);
    } catch (error) {
      // Roll back an unpublished mutation before another writer snapshots it.
      onFailure?.();
      throw error;
    }
    lastPersistedState = mainState;
    assertWalletPersistenceAllowed();
  });
}

/** Publish an approved grant only after its main-state snapshot is durable. */
export function persistDappPermissionGrant(
  grant: IDApp,
  previous: IDApp | undefined,
  isCurrent: () => boolean,
  restoredPrevious: () => IDApp | undefined = () => undefined,
  isPreviousRetired: () => boolean = () => false
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    // Capture the effective predecessor once: a failed revoke can restore its
    // exact grant, or durable account removal can retire the exact old grant.
    const admittedPrevious =
      previous === undefined
        ? restoredPrevious()
        : store.getState().dapp.dapps[grant.host] === undefined &&
          isPreviousRetired()
        ? undefined
        : previous;
    const assertCurrent = () => {
      assertWalletPersistenceAllowed();
      if (
        !isCurrent() ||
        store.getState().dapp.dapps[grant.host] !== admittedPrevious
      )
        throw new Error('Permission grant context changed');
    };
    assertCurrent();
    const state = store.getState();
    const mainState = {
      ...getMainStateForStorage(state),
      dapp: {
        ...state.dapp,
        dapps: { ...state.dapp.dapps, [grant.host]: grant },
      },
    };
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    try {
      assertCurrent();
    } catch (error) {
      // A revoke or replacement during the write must also remove the staged
      // grant from disk. Keep the cache tied to the snapshot actually written.
      assertWalletPersistenceAllowed();
      const currentState = getMainStateForStorage(store.getState());
      await chromeStorage.setItem('state', currentState);
      lastPersistedState = currentState;
      throw error;
    }
    store.dispatch(addDApp(grant));
  });
}

/** Commit provider availability before new content scripts can observe it. */
export async function persistHasEthProperty(enabled: boolean): Promise<void> {
  if (typeof enabled !== 'boolean')
    throw new Error('Invalid provider preference');
  return walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    const state = store.getState();
    const mainState = {
      ...getMainStateForStorage(state),
      vaultGlobal: {
        ...getPersistedGlobalState(state.vaultGlobal),
        hasEthProperty: enabled,
      },
    };
    // This boundary must reject storage failure, unlike legacy best-effort saves.
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    assertWalletPersistenceAllowed();
    // Preserve other Redux changes that occurred while storage was pending.
    store.dispatch(setHasEthProperty(enabled));
  });
}

type MainMutationAction =
  | ReturnType<typeof setAdvancedSettings>
  | ReturnType<typeof setPrices>
  | ReturnType<typeof setNetwork>;

/** Stage only the requested action; publish it after a guarded durable write. */
function persistMainMutation(
  action: MainMutationAction,
  assertCurrent: () => void,
  isSameWallet?: () => boolean
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    const assertAdmitted = () => {
      assertWalletPersistenceAllowed();
      assertCurrent();
    };
    assertAdmitted();
    const mainState = getMainStateForStorage(
      reducers(store.getState(), action)
    );
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    try {
      assertAdmitted();
    } catch (error) {
      // Keep invalidated writes unpublished and repair only their owning wallet.
      assertWalletPersistenceAllowed();
      if (isSameWallet && !isSameWallet()) throw error;
      const currentState = getMainStateForStorage(store.getState());
      await chromeStorage.setItem('state', currentState);
      lastPersistedState = currentState;
      throw error;
    }
    store.dispatch(action);
  });
}

/** Publish a preference only after its staged main-state write is durable. */
export function persistAdvancedSetting(
  advancedProperty: string,
  value: boolean | number,
  isCurrent: () => boolean
): Promise<void> {
  return persistMainMutation(
    setAdvancedSettings({ advancedProperty, value }),
    () => {
      if (!isCurrent())
        throw new Error('Wallet state changed before saving settings');
    }
  );
}

/** Keep an explicitly saved currency private until its main-state write commits. */
export function persistFiatCurrency(
  currency: string,
  isCurrent: () => boolean
): Promise<void> {
  return persistMainMutation(
    setPrices({ asset: currency, available: false, price: 0 }),
    () => {
      if (!isCurrent())
        throw new Error('Wallet state changed before saving currency');
    }
  );
}

/** Commit a network registry edit before exposing it to retrying callers. */
export function persistNetworkRegistry(
  network: INetwork,
  isEdit: boolean,
  assertCurrent: () => void,
  isSameWallet: () => boolean
): Promise<void> {
  return persistMainMutation(
    setNetwork({ network, isEdit }),
    assertCurrent,
    isSameWallet
  );
}

/** Remove registry and owned vault data in one native commit. */
export function persistNetworkRemoval(
  network: Parameters<typeof removeNetwork>[0],
  assertCurrent: () => void,
  isSameWallet: () => boolean,
  removedSlip44: number | undefined,
  onCommitted: () => void
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    const assertAdmitted = () => {
      assertWalletPersistenceAllowed();
      assertCurrent();
    };
    assertAdmitted();
    const vaultKey = `state-vault-${removedSlip44}`;
    const keys =
      removedSlip44 === undefined
        ? []
        : [vaultKey, `${vaultKey}-passkey-profile`];
    const previous = keys.length ? await chromeStorage.getItems(keys) : {};
    assertAdmitted();
    const action = removeNetwork(network);
    const mainState = getMainStateForStorage(
      reducers(store.getState(), action)
    );
    // Existing vault/profile readers treat null as absent. Tombstones allow
    // registry removal and data erasure to share one acknowledged operation.
    await chromeStorage.setItems({
      state: mainState,
      ...Object.fromEntries(keys.map((key) => [key, null])),
    });
    lastPersistedState = mainState;
    try {
      assertAdmitted();
    } catch (error) {
      assertWalletPersistenceAllowed();
      if (!isSameWallet()) throw error;
      const current = getMainStateForStorage(store.getState());
      await chromeStorage.setItems({
        state: current,
        ...previous,
      });
      lastPersistedState = current;
      throw error;
    }
    store.dispatch(action);
    if (removedSlip44 !== undefined)
      vaultCache.clearSlip44FromCache(removedSlip44);
    onCommitted();
  });
}

type ImportedRecoveryValidator = (
  entry: ImportedRecoveryEntry,
  current: ImportedRecoveryIdentity
) => void;

type AccountRemovalCommit = {
  accountId: number;
  accountType: KeyringAccountType;
  grants: IDApp[];
  importedRecovery?: {
    assertAccount: ImportedRecoveryValidator;
    identity: ImportedRecoveryIdentity;
    profileId: string;
  };
  isSameWallet: () => boolean;
  retireSessions: () => void;
};

type ImportedRecoveryMutation =
  | {
      assertAccount: ImportedRecoveryValidator;
      entry: ImportedRecoveryEntry;
      kind: 'add';
    }
  | {
      assertAccount: ImportedRecoveryValidator;
      identity: ImportedRecoveryIdentity;
      kind: 'remove';
      profileId: string;
    };

type VaultMutationAction =
  | ReturnType<typeof setAccountLabel>
  | ReturnType<typeof removeAccount>
  | ReturnType<typeof createAccount>
  | ReturnType<typeof setActiveAccount>
  | ReturnType<typeof setAccountAssets>
  | ReturnType<typeof setAccountPropertyByIdAndType>;

// User-authored vault edits share the same unpublished staging boundary.
function persistVaultMutation(
  mutation: VaultMutationAction[] | (() => VaultMutationAction[]),
  assertCurrent: () => void,
  removal?: AccountRemovalCommit,
  isSameWallet = removal?.isSameWallet,
  importedRecovery?: ImportedRecoveryMutation
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    const assertCommitCurrent = () => {
      assertWalletPersistenceAllowed();
      assertCurrent();
      if (removal) {
        const grants = Object.values(store.getState().dapp.dapps).filter(
          (grant) =>
            grant.accountId === removal.accountId &&
            grant.accountType === removal.accountType
        );
        if (
          grants.length !== removal.grants.length ||
          grants.some((grant) => !removal.grants.includes(grant))
        )
          throw new Error('Account permissions changed before removal');
      }
    };
    assertCommitCurrent();
    let recoveryWrites: Record<string, unknown> | undefined;
    let recoveryRollback: Record<string, unknown> | undefined;
    let recoveryBefore: Record<string, unknown> | undefined;
    let recoveryBeforeKeys: string[] | undefined;
    const priorLastPersistedState = lastPersistedState;
    if (importedRecovery) {
      // The private caller supplies the existing UTXO-aware account validator;
      // the UI store imports only the shared, dependency-free record format.
      const assertAccount = importedRecovery.assertAccount;
      if (typeof assertAccount !== 'function')
        throw new Error('Imported recovery account validation is unavailable');
      const expected =
        importedRecovery.kind === 'add'
          ? snapshotImportedRecoveryEntry(importedRecovery.entry)
          : undefined;
      const identity =
        importedRecovery.kind === 'add'
          ? expected!.identity
          : importedRecovery.identity;
      const profileId =
        importedRecovery.kind === 'add'
          ? expected!.envelope.profileId
          : importedRecovery.profileId;
      const key = importedRecoveryStorageKeyForIdentity(identity, profileId);
      const slip44 = store.getState().vaultGlobal.activeSlip44;
      if (slip44 === null)
        throw new Error('Imported recovery vault is unavailable');
      recoveryBeforeKeys = [key, `state-vault-${slip44}`, 'state'];
      recoveryBefore = await chromeStorage.getItems(recoveryBeforeKeys);
      const saved = recoveryBefore[key];
      assertCommitCurrent();
      if (saved !== undefined && saved !== null) {
        const previous = snapshotImportedRecoveryEntry(saved);
        assertAccount(previous, identity);
        if (previous.envelope.profileId !== profileId || expected)
          throw new Error('Imported recovery record already exists or changed');
      }
      recoveryWrites = { [key]: expected ?? null };
      recoveryRollback = { [key]: saved ?? null };
    }
    const actions = typeof mutation === 'function' ? mutation() : mutation;
    const state = store.getState();
    const sourceSlip44 = state.vaultGlobal.activeSlip44;
    if (sourceSlip44 === null)
      throw new Error(
        'Cannot persist an account edit without an active slip44'
      );
    const sourceVault = vaultCache.prepareSlip44Vault(
      sourceSlip44,
      state.vault,
      false
    );
    const stagedVault = vaultCache.prepareSlip44Vault(
      sourceSlip44,
      actions.reduce((current, action) => vault(current, action), state.vault),
      false
    );
    if (importedRecovery) {
      const expected =
        importedRecovery.kind === 'add'
          ? importedRecovery.entry.identity
          : importedRecovery.identity;
      const account = (
        importedRecovery.kind === 'add' ? stagedVault : sourceVault
      ).accounts.Imported[expected.id];
      if (
        expected.slip44 !== sourceSlip44 ||
        expected.kind !== sourceVault.activeNetwork.kind ||
        !account ||
        account.address !== expected.address ||
        account.xpub !== expected.xpub ||
        account.id !== expected.id ||
        !account.isImported ||
        account.isLedgerWallet ||
        account.isTrezorWallet ||
        account.isSmartAccount ||
        !account.xprv
      )
        throw new Error('Imported recovery account context changed');
    }
    const mainState = removal
      ? {
          ...getMainStateForStorage(state),
          dapp: removal.grants.reduce(
            (current, grant) => dapp(current, removeDApp(grant.host)),
            state.dapp
          ),
        }
      : isMainStateUnchanged(state)
      ? undefined
      : getMainStateForStorage(state);
    // Ordinary mutations keep their existing write-failure contract. Imports
    // and removals with private copies must also reconcile a rejected write:
    // Chrome may have committed the complete batch before losing its reply.
    if (!recoveryWrites) {
      await saveCommittedWalletState(sourceSlip44, stagedVault, mainState);
      if (mainState) lastPersistedState = mainState;
    }
    let publicationActions = actions;
    try {
      if (recoveryWrites) {
        await saveCommittedWalletState(
          sourceSlip44,
          stagedVault,
          mainState,
          recoveryWrites
        );
        if (mainState) lastPersistedState = mainState;
      }
      assertCommitCurrent();
      if (recoveryWrites) {
        const key = Object.keys(recoveryWrites)[0];
        const saved = await chromeStorage.getItems([
          key,
          `state-vault-${sourceSlip44}`,
        ]);
        assertCommitCurrent();
        if (
          !jsonStorageEqual(saved[key], recoveryWrites[key]) ||
          !jsonStorageEqual(saved[`state-vault-${sourceSlip44}`], stagedVault)
        )
          throw new Error(
            'Imported account recovery commit was not acknowledged'
          );
      }
      // Asset lists may receive newer balances while storage is pending.
      // Reapply the same membership edit to the latest list, not an old array.
      if (typeof mutation === 'function') publicationActions = mutation();
    } catch (error) {
      assertWalletPersistenceAllowed();
      if (isSameWallet && !isSameWallet()) throw error;
      if (recoveryBefore && recoveryBeforeKeys) {
        let unchanged = false;
        try {
          const observed = await chromeStorage.getItems(recoveryBeforeKeys);
          unchanged = recoveryBeforeKeys.every((key) =>
            jsonStorageEqual(
              observed[key] ?? null,
              recoveryBefore![key] ?? null
            )
          );
        } catch {
          /* An unreadable outcome still needs a verified repair. */
        }
        if (isSameWallet && !isSameWallet()) throw error;
        if (unchanged) {
          lastPersistedState = priorLastPersistedState;
          throw error;
        }
      }
      const current = store.getState();
      let repairVault =
        current.vaultGlobal.activeSlip44 === sourceSlip44 &&
        getSlip44ForNetwork(current.vault.activeNetwork) === sourceSlip44
          ? vaultCache.prepareSlip44Vault(sourceSlip44, current.vault, false)
          : sourceVault;
      if (
        isSameWallet &&
        current.vaultGlobal.activeSlip44 !== sourceSlip44 &&
        vaultCache.isVaultCached(sourceSlip44)
      ) {
        repairVault =
          (await vaultCache.getSlip44Vault(sourceSlip44)) || sourceVault;
      }
      assertWalletPersistenceAllowed();
      if (isSameWallet && !isSameWallet()) throw error;
      const repairMainState = getMainStateForStorage(store.getState());
      // Repair the source slot, never the newly active vault. Do not repopulate
      // a cache that lock/reset may have cleared while storage was pending.
      try {
        let repairFailed = false;
        let repairFailure: unknown;
        try {
          await saveCommittedWalletState(
            sourceSlip44,
            repairVault,
            repairMainState,
            recoveryRollback
          );
        } catch (failure) {
          repairFailed = true;
          repairFailure = failure;
        }
        if (recoveryRollback) {
          const vaultKey = `state-vault-${sourceSlip44}`;
          const saved = await chromeStorage.getItems([
            vaultKey,
            'state',
            ...Object.keys(recoveryRollback),
          ]);
          if (isSameWallet && !isSameWallet()) throw error;
          if (
            !jsonStorageEqual(saved[vaultKey], repairVault) ||
            !jsonStorageEqual(saved.state, repairMainState) ||
            Object.keys(recoveryRollback).some(
              (key) =>
                !jsonStorageEqual(
                  saved[key] ?? null,
                  recoveryRollback![key] ?? null
                )
            )
          )
            throw new Error(
              'Imported account recovery repair was not acknowledged'
            );
        } else if (repairFailed) throw repairFailure;
        lastPersistedState = repairMainState;
      } catch (repairError) {
        // Do not let a later save publish the old Redux account collection over
        // an unclassified account/private-copy pair. The existing write gate
        // remains closed until storage can be reconciled.
        if (recoveryRollback && (!isSameWallet || isSameWallet()))
          walletPersistenceGate.blocked = true;
        throw repairError;
      }
      throw error;
    }
    publicationActions.forEach((action) => store.dispatch(action));
    removal?.grants.forEach((grant) => store.dispatch(removeDApp(grant.host)));
    vaultCache.prepareSlip44Vault(sourceSlip44, store.getState().vault);
    removal?.retireSessions();
  });
}

/** Stage a token membership edit without publishing its uncommitted list. */
export function persistAssetMutation(
  prepare: () => ReturnType<typeof setAccountAssets>,
  assertCurrent: () => void,
  isSameWallet: () => boolean
): Promise<void> {
  return persistVaultMutation(
    () => [prepare()],
    assertCurrent,
    undefined,
    isSameWallet
  );
}

/** Keep smart-account metadata unpublished until its guarded vault commit. */
export function persistSmartAccountMetadata(
  accountId: number,
  prepare: () => ISmartAccountMetadata,
  assertCurrent: () => void,
  isSameWallet: () => boolean
): Promise<void> {
  return persistVaultMutation(
    () => [
      setAccountPropertyByIdAndType({
        id: accountId,
        property: 'smartAccount',
        type: KeyringAccountType.SmartAccount,
        value: prepare(),
      }),
    ],
    assertCurrent,
    undefined,
    isSameWallet
  );
}

/** Stage a label without exposing it to ordinary or emergency vault saves. */
export function persistAccountLabel(
  accountId: number,
  accountType: KeyringAccountType,
  label: string,
  assertCurrent: () => void
): Promise<void> {
  return persistVaultMutation(
    [setAccountLabel({ accountId, accountType, label })],
    assertCurrent
  );
}

/** Commit the account and its affected grants before retiring their sessions. */
export function persistAccountRemoval(
  removal: AccountRemovalCommit,
  assertCurrent: () => void
): Promise<void> {
  return persistVaultMutation(
    [removeAccount({ id: removal.accountId, type: removal.accountType })],
    assertCurrent,
    removal,
    removal.isSameWallet,
    removal.importedRecovery
      ? { kind: 'remove', ...removal.importedRecovery }
      : undefined
  );
}

/** Publish a created account and its selection only after the vault commits. */
export function persistAccountCreation(
  account: IKeyringAccountState,
  accountType:
    | KeyringAccountType.HDAccount
    | KeyringAccountType.Imported
    | KeyringAccountType.SmartAccount
    | KeyringAccountType.Trezor
    | KeyringAccountType.Ledger,
  assertCurrent: () => void,
  isSameWallet: () => boolean,
  importedRecovery?: {
    assertAccount: ImportedRecoveryValidator;
    entry: ImportedRecoveryEntry;
  }
): Promise<void> {
  return persistVaultMutation(
    [
      createAccount({ account, accountType }),
      setActiveAccount({ id: account.id, type: accountType }),
    ],
    assertCurrent,
    undefined,
    isSameWallet,
    importedRecovery ? { kind: 'add', ...importedRecovery } : undefined
  );
}

/**
 * Durably commit the active vault and, when necessary, the global state in one
 * Chrome storage call. This is the minimal persistence barrier needed before
 * an externally approved network switch reports success.
 */
export async function persistCommittedWalletState(
  includeMainState: boolean,
  skipUnchangedMainState = false,
  isCurrent: () => boolean = () => true
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    if (!isCurrent())
      throw new Error('Wallet state changed before persistence');
    const state = store.getState();
    const activeSlip44 = state.vaultGlobal.activeSlip44;

    if (activeSlip44 === null) {
      throw new Error('Cannot persist wallet state without an active slip44');
    }

    const vaultState = vaultCache.prepareSlip44Vault(activeSlip44, state.vault);
    const shouldIncludeMainState =
      includeMainState &&
      (!skipUnchangedMainState || !isMainStateUnchanged(state));
    const mainState = shouldIncludeMainState
      ? getMainStateForStorage(state)
      : undefined;

    await saveCommittedWalletState(activeSlip44, vaultState, mainState);

    if (mainState && isCurrent()) {
      lastPersistedState = mainState;
    }
  });
}

// New centralized function to load and activate a slip44 vault
export async function loadAndActivateSlip44Vault(
  slip44: number,
  targetNetwork?: INetwork,
  deferActiveSlip44Update = false,
  isCurrent: () => boolean = () => true,
  persistMigrations = true
): Promise<boolean> {
  const assertCurrent = () => {
    if (!isCurrent())
      throw new Error('Wallet state changed while loading account data');
  };
  // If a non-deferred storage/migration step fails, this is still the vault
  // Redux actually contains. Re-align the global pointer to it in the catch so
  // mismatch suppression cannot strand background state delivery.
  const loadedVaultSlip44 = store.getState().vault.activeNetwork.slip44;

  try {
    console.log(`[Store] Loading slip44 vault: ${slip44}`);

    assertCurrent();
    // Only set activeSlip44 immediately if not deferred
    // When deferred, the caller will set it after session transfer
    if (!deferActiveSlip44Update) {
      console.log(`[Store] Setting activeSlip44 to ${slip44}`);
      store.dispatch(setActiveSlip44(slip44));
    } else {
      console.log(
        `[Store] Deferring activeSlip44 update for slip44: ${slip44}`
      );
    }

    const slip44VaultState = await vaultCache.getSlip44Vault(slip44, isCurrent);
    assertCurrent();

    if (slip44VaultState) {
      console.log(`[Store] Loading existing vault state for slip44: ${slip44}`);

      const passkeyProfileState = await loadPasskeyCredentialProfileState(
        slip44
      );
      assertCurrent();
      const embeddedPasskeyCredentialProfile =
        slip44VaultState.passkeyCredentialProfile;
      const vaultStateWithoutPasskeyProfile = { ...slip44VaultState };
      delete vaultStateWithoutPasskeyProfile.passkeyCredentialProfile;

      if (embeddedPasskeyCredentialProfile && persistMigrations) {
        if (!passkeyProfileState?.passkeyCredentialProfile) {
          await walletPersistenceMutex.runExclusive(async () => {
            assertCurrent();
            await savePasskeyCredentialProfileState(
              slip44,
              embeddedPasskeyCredentialProfile
            );
          });
          assertCurrent();
        }
        await vaultCache.setSlip44Vault(
          slip44,
          vaultStateWithoutPasskeyProfile,
          isCurrent
        );
        assertCurrent();
      }

      const passkeyCredentialProfile =
        passkeyProfileState?.passkeyCredentialProfile ||
        embeddedPasskeyCredentialProfile;
      const vaultStateWithPasskeyProfile = passkeyCredentialProfile
        ? {
            ...vaultStateWithoutPasskeyProfile,
            passkeyCredentialProfile,
          }
        : vaultStateWithoutPasskeyProfile;

      // Load vault state into Redux only while this activation still owns it.
      assertCurrent();
      store.dispatch(vaultRehydrate(vaultStateWithPasskeyProfile));

      console.log(`[Store] Successfully loaded slip44 vault: ${slip44}`);
      return true;
    } else {
      if (!persistMigrations)
        throw new Error('Restored wallet account data is missing');
      console.log(
        `[Store] No vault data found for slip44: ${slip44} - initializing clean vault state`
      );

      // No vault exists - initialize clean state for this slip44
      // This prevents copying accounts from previous slip44 when saving later
      const networkToUse =
        targetNetwork || store.getState().vault.activeNetwork;
      assertCurrent();
      store.dispatch(initializeCleanVaultForSlip44(networkToUse));

      console.log(
        `[Store] Initialized clean vault state for slip44: ${slip44}`
      );
      return false;
    }
  } catch (error) {
    if (
      isCurrent() &&
      !deferActiveSlip44Update &&
      loadedVaultSlip44 !== null &&
      loadedVaultSlip44 !== undefined
    ) {
      store.dispatch(setActiveSlip44(Number(loadedVaultSlip44)));
    }
    console.error(`[Store] Failed to load slip44 vault ${slip44}:`, error);
    throw error;
  }
}

// RootState is typically defined using the store itself, so it's fine here.
export type RootState = ReturnType<typeof store.getState> & {
  _persist: IPersistState;
};
export type AppDispatch = typeof store.dispatch;
export default store;
