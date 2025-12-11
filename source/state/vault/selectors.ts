import { createSelector } from '@reduxjs/toolkit';

import { RootState } from 'state/store';
import { ENS_CACHE_TTL_MS } from 'state/vaultGlobal';

import { IAccountAssets, IAccountTransactions } from './types';

// Helper to get default empty assets
const getDefaultAssets = (): IAccountAssets => ({
  ethereum: [],
  syscoin: [],
});

// Helper to get default empty transactions
const getDefaultTransactions = (): IAccountTransactions => ({
  ethereum: {},
  syscoin: {},
});

// Direct access selectors (most efficient)
export const selectAccounts = (state: RootState) => state.vault.accounts;
export const selectAccountAssets = (state: RootState) =>
  state.vault.accountAssets;
export const selectAccountTransactions = (state: RootState) =>
  state.vault.accountTransactions;
export const selectActiveAccountRef = (state: RootState) =>
  state.vault.activeAccount;

// Active account selectors (clean, separated data)
export const selectActiveAccount = createSelector(
  [
    (state: RootState) => state.vault.activeAccount,
    (state: RootState) => state.vault.accounts,
  ],
  (activeAccount, accounts) =>
    accounts[activeAccount.type]?.[activeAccount.id] || null
);

export const selectActiveAccountAssets = createSelector(
  [
    (state: RootState) => state.vault.activeAccount,
    (state: RootState) => state.vault.accountAssets,
  ],
  (activeAccount, accountAssets) =>
    accountAssets[activeAccount.type]?.[activeAccount.id] || getDefaultAssets()
);

export const selectActiveAccountTransactions = createSelector(
  [
    (state: RootState) => state.vault.activeAccount,
    (state: RootState) => state.vault.accountTransactions,
  ],
  (activeAccount, accountTransactions) =>
    accountTransactions[activeAccount.type]?.[activeAccount.id] ||
    getDefaultTransactions()
);

// ✅ OPTIMIZED: Compound selectors to reduce multiple useSelector calls
export const selectActiveAccountWithAssets = createSelector(
  [selectActiveAccount, selectActiveAccountAssets],
  (account, assets) => ({ account, assets })
);

export const selectActiveAccountWithTransactions = createSelector(
  [selectActiveAccount, selectActiveAccountTransactions],
  (account, transactions) => ({ account, transactions })
);

// ✅ OPTIMIZED: Common vault data selector for components that need multiple vault properties
export const selectVaultCoreData = createSelector(
  [
    (state: RootState) => state.vault.activeNetwork,
    (state: RootState) => state.vault.isBitcoinBased,
    (state: RootState) => state.vaultGlobal.isSwitchingAccount,
  ],
  (activeNetwork, isBitcoinBased, isSwitchingAccount) => ({
    activeNetwork,
    isBitcoinBased,
    isSwitchingAccount,
  })
);

// ✅ OPTIMIZED: For components that need both account and core vault data
export const selectActiveAccountAndVaultData = createSelector(
  [selectActiveAccount, selectActiveAccountAssets, selectVaultCoreData],
  (account, assets, vaultData) => ({ account, assets, ...vaultData })
);

// ENS selectors with TTL expiration support
export const selectEnsCache = (state: RootState) => state.vaultGlobal.ensCache;

/**
 * Helper to check if an ENS cache entry is still valid (not expired)
 * @param entry - The cache entry with timestamp
 * @param now - Current timestamp (defaults to Date.now())
 * @returns true if the entry is still valid
 */
export const isEnsCacheEntryValid = (
  entry: { name: string; timestamp: number },
  now: number = Date.now()
): boolean => now - entry.timestamp < ENS_CACHE_TTL_MS;

/**
 * Selector that returns only non-expired ENS cache entries
 * This ensures stale ENS lookups are not used for security
 */
export const selectValidEnsCache = createSelector(
  [selectEnsCache],
  (ensCache) => {
    if (!ensCache) return {};
    const now = Date.now();
    const validCache: typeof ensCache = {};

    for (const [addrLower, entry] of Object.entries(ensCache)) {
      if (isEnsCacheEntryValid(entry, now)) {
        validCache[addrLower] = entry;
      }
    }

    return validCache;
  }
);

// Derived map: nameLower -> addressLower, built once and memoized
// Only includes non-expired entries for security
export const selectEnsNameToAddress = createSelector(
  [selectValidEnsCache],
  (validEnsCache) => {
    const map: Record<string, string> = {};
    if (!validEnsCache) return map;
    try {
      for (const [addrLower, v] of Object.entries(validEnsCache as any)) {
        const nameLower = String((v as any)?.name || '').toLowerCase();
        if (nameLower) map[nameLower] = addrLower;
      }
    } catch {
      // noop; return accumulated map
    }
    return map;
  }
);
