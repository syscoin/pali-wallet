import {
  combineReducers,
  configureStore,
  Store,
  Middleware, // Import Middleware type
} from '@reduxjs/toolkit';
import isEqual from 'lodash/isEqual';
// Assuming redux-thunk v3+, which exports 'thunk' and ThunkMiddleware type
import { thunk, ThunkMiddleware } from 'redux-thunk';

import { INetwork, KeyringAccountType } from 'types/network';
import { ISpamFilterState } from 'types/security';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import dapp, { addDApp } from './dapp';
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
import price from './price';
import { IPriceState } from './price/types';
import spamFilter from './spamFilter';
import { IPersistState } from './types';
import vault, {
  rehydrate as vaultRehydrate,
  initializeCleanVaultForSlip44,
  restoreVaultSnapshot,
  setAccountLabel,
} from './vault';
import { IVaultState, IGlobalState } from './vault/types';
import vaultCache, { getSlip44ForNetwork } from './vaultCache';
import vaultGlobal, {
  setActiveSlip44,
  setAdvancedSettings,
  setHasEthProperty,
} from './vaultGlobal';

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

const getMainStateForStorage = (state: ReturnType<typeof store.getState>) => ({
  dapp: state.dapp,
  price: state.price,
  vaultGlobal: state.vaultGlobal,
});

const isMainStateUnchanged = (state: ReturnType<typeof store.getState>) =>
  Boolean(
    lastPersistedState &&
      isEqual(lastPersistedState.dapp, state.dapp) &&
      isEqual(lastPersistedState.price, state.price) &&
      isEqual(lastPersistedState.vaultGlobal, state.vaultGlobal)
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
export async function persistMainStateStrict(): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    const mainState = getMainStateForStorage(store.getState());
    // Both saveMainState and saveState intentionally swallow some failures.
    // A permission revocation must instead observe the actual storage result,
    // even if a prior best-effort save left the cache claiming no change.
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    assertWalletPersistenceAllowed();
  });
}

/** Publish an approved grant only after its main-state snapshot is durable. */
export function persistDappPermissionGrant(
  grant: IDApp,
  previous: IDApp | undefined,
  isCurrent: () => boolean
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    const assertCurrent = () => {
      assertWalletPersistenceAllowed();
      if (!isCurrent() || store.getState().dapp.dapps[grant.host] !== previous)
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
      vaultGlobal: { ...state.vaultGlobal, hasEthProperty: enabled },
    };
    // This boundary must reject storage failure, unlike legacy best-effort saves.
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    assertWalletPersistenceAllowed();
    // Preserve other Redux changes that occurred while storage was pending.
    store.dispatch(setHasEthProperty(enabled));
  });
}

/** Publish a preference only after its staged main-state write is durable. */
export function persistAdvancedSetting(
  advancedProperty: string,
  value: boolean | number,
  isCurrent: () => boolean
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    const assertCurrent = () => {
      assertWalletPersistenceAllowed();
      if (!isCurrent())
        throw new Error('Wallet state changed before saving settings');
    };
    assertCurrent();
    const state = store.getState();
    const mainState = {
      ...getMainStateForStorage(state),
      vaultGlobal: {
        ...state.vaultGlobal,
        advancedSettings: {
          ...state.vaultGlobal.advancedSettings,
          [advancedProperty]: value,
        },
      },
    };
    await chromeStorage.setItem('state', mainState);
    lastPersistedState = mainState;
    try {
      assertCurrent();
    } catch (error) {
      // A reset can invalidate the write while it is pending. Keep the staged
      // preference unpublished and remove it from disk before releasing the lock.
      assertWalletPersistenceAllowed();
      const currentState = getMainStateForStorage(store.getState());
      await chromeStorage.setItem('state', currentState);
      lastPersistedState = currentState;
      throw error;
    }
    // A queued background save must observe the committed value; unrelated
    // Redux updates received during the write must also remain intact.
    store.dispatch(setAdvancedSettings({ advancedProperty, value }));
  });
}

/** Stage a label without exposing it to ordinary or emergency vault saves. */
export function persistAccountLabel(
  accountId: number,
  accountType: KeyringAccountType,
  label: string,
  assertCurrent: () => void
): Promise<void> {
  return walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    assertCurrent();
    const state = store.getState();
    const sourceSlip44 = state.vaultGlobal.activeSlip44;
    if (sourceSlip44 === null)
      throw new Error(
        'Cannot persist an account label without an active slip44'
      );
    const labelAction = setAccountLabel({ accountId, accountType, label });
    const sourceVault = vaultCache.prepareSlip44Vault(
      sourceSlip44,
      state.vault,
      false
    );
    const stagedVault = vaultCache.prepareSlip44Vault(
      sourceSlip44,
      vault(state.vault, labelAction),
      false
    );
    const mainState = isMainStateUnchanged(state)
      ? undefined
      : getMainStateForStorage(state);
    await saveCommittedWalletState(sourceSlip44, stagedVault, mainState);
    if (mainState) lastPersistedState = mainState;
    try {
      assertWalletPersistenceAllowed();
      assertCurrent();
    } catch (error) {
      assertWalletPersistenceAllowed();
      const current = store.getState();
      const repairVault =
        current.vaultGlobal.activeSlip44 === sourceSlip44 &&
        getSlip44ForNetwork(current.vault.activeNetwork) === sourceSlip44
          ? vaultCache.prepareSlip44Vault(sourceSlip44, current.vault, false)
          : sourceVault;
      const repairMainState = getMainStateForStorage(current);
      // Repair the source slot, never the newly active vault. Do not repopulate
      // a cache that lock/reset may have cleared while storage was pending.
      await saveCommittedWalletState(
        sourceSlip44,
        repairVault,
        repairMainState
      );
      lastPersistedState = repairMainState;
      throw error;
    }
    store.dispatch(labelAction);
    vaultCache.prepareSlip44Vault(sourceSlip44, store.getState().vault);
  });
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
