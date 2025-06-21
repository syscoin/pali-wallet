import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { loadSlip44State, saveSlip44State } from './paliStorage';
import store, { saveMainState } from './store';
import { markVaultAsClean } from './vault';
import { ISlip44State } from './vault/types';

// Slip44 constants
export const DEFAULT_EVM_SLIP44 = 60; // Ethereum
export const DEFAULT_UTXO_SLIP44 = 57; // Syscoin

/**
 * Extract slip44 from network object
 */
export function getSlip44ForNetwork(network: INetwork): number {
  return (
    network.slip44 ||
    (network.kind === INetworkType.Syscoin
      ? DEFAULT_UTXO_SLIP44
      : DEFAULT_EVM_SLIP44)
  );
}

/**
 * Validate that vault's activeNetwork slip44 matches the expected slip44
 * This prevents accidentally saving vault data to wrong slip44 storage
 */
function validateVaultSlip44(
  slip44State: ISlip44State,
  expectedSlip44: number
): boolean {
  if (!slip44State.activeNetwork) {
    console.warn(
      `[VaultCache] No activeNetwork in vault state - cannot validate slip44`
    );
    return false;
  }

  const vaultSlip44 = getSlip44ForNetwork(slip44State.activeNetwork);

  if (vaultSlip44 !== expectedSlip44) {
    console.error(`[VaultCache] 🚨 SLIP44 MISMATCH DETECTED! 🚨`);
    console.error(`[VaultCache] Expected slip44: ${expectedSlip44}`);
    console.error(`[VaultCache] Vault activeNetwork slip44: ${vaultSlip44}`);
    console.error(
      `[VaultCache] Vault activeNetwork:`,
      slip44State.activeNetwork
    );
    console.error(
      `[VaultCache] This would cause cross-network contamination - BLOCKING SAVE!`
    );
    return false;
  }

  return true;
}

/**
 * Simplified vault cache system for lazy loading slip44-specific vault states
 */
class VaultCache {
  private slip44Cache: Map<number, ISlip44State> = new Map();

  // 🔥 FIX: Periodic safety save for service workers (they can be terminated unexpectedly)
  private periodicSaveInterval: NodeJS.Timeout | null = null;
  private readonly PERIODIC_SAVE_INTERVAL = 30000; // 30 seconds

  // 🔥 Simple flag to prevent double emergency saves
  private emergencySaveInProgress = false;

  /**
   * Get slip44-specific vault state, loading it if not cached
   */
  async getSlip44Vault(slip44: number): Promise<ISlip44State | null> {
    // Return from cache if already loaded
    if (this.slip44Cache.has(slip44)) {
      console.log(`[VaultCache] Using cached slip44 vault: ${slip44}`);
      return this.slip44Cache.get(slip44)!;
    }

    // Load from storage
    console.log(`[VaultCache] Loading slip44 vault: ${slip44}`);
    const slip44State = await loadSlip44State(slip44);

    if (slip44State) {
      // Ensure isDirty flag exists and is false for loaded state
      slip44State.isDirty = false;
      this.slip44Cache.set(slip44, slip44State);
      console.log(`[VaultCache] Cached slip44 vault: ${slip44}`);
    }

    return slip44State;
  }

  /**
   * Set slip44-specific vault state (updates cache and saves to storage immediately)
   */
  async setSlip44Vault(
    slip44: number,
    slip44State: ISlip44State
  ): Promise<void> {
    // 🛡️ SAFEGUARD: Validate slip44 matches before saving
    if (!validateVaultSlip44(slip44State, slip44)) {
      throw new Error(
        `VaultCache.setSlip44Vault: Slip44 validation failed! Cannot save vault with slip44=${slip44}`
      );
    }
    // Mark as clean since we're saving immediately
    const cleanSlip44State = { ...slip44State, isDirty: false };

    // Update cache
    this.slip44Cache.set(slip44, cleanSlip44State);

    // Save to storage immediately
    await saveSlip44State(slip44, cleanSlip44State);

    // 🔥 FIX: If this is the active slip44, mark Redux vault as clean too
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    if (slip44 === activeSlip44) {
      store.dispatch(markVaultAsClean());
    }
  }

  /**
   * Check if a slip44 vault is dirty
   * 🔥 FIX: Check live Redux state for active slip44, cached state for others
   */
  isDirty(slip44: number): boolean {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

    if (slip44 === activeSlip44) {
      // For active slip44, check live Redux state
      return store.getState().vault.isDirty;
    } else {
      // For non-active slip44s, check cached state
      const slip44State = this.slip44Cache.get(slip44);
      return slip44State?.isDirty || false;
    }
  }

  /**
   * Save only the active slip44 vault to storage (for periodic/emergency saves)
   * Uses live Redux state instead of cached state to ensure we save current data
   */
  async saveActiveVault(activeSlip44: number): Promise<void> {
    // 🔥 FIX: Use live Redux state instead of cached state
    const liveVaultState = store.getState().vault;

    if (!liveVaultState.isDirty) {
      return; // Nothing to save
    }

    // 🛡️ SAFEGUARD: Validate slip44 matches before saving
    if (!validateVaultSlip44(liveVaultState, activeSlip44)) {
      console.warn(
        `[VaultCache] saveActiveVault: Slip44 validation failed! Skipping save for slip44=${activeSlip44}`
      );
      return; // Don't throw here since this is called from periodic/emergency saves
    }

    console.log(`[VaultCache] Saving active vault: ${activeSlip44}`);
    console.log(
      `[VaultCache] ✅ Slip44 validation passed for slip44=${activeSlip44}`
    );

    // Mark as clean before saving
    const cleanSlip44State = { ...liveVaultState, isDirty: false };
    this.slip44Cache.set(activeSlip44, cleanSlip44State);
    await saveSlip44State(activeSlip44, cleanSlip44State);

    store.dispatch(markVaultAsClean());

    console.log(`[VaultCache] Save completed for slip44=${activeSlip44}`);
  }

  // activeSlip44 tracking removed - now handled by Redux global state

  /**
   * Check if a slip44 vault is cached
   */
  isVaultCached(slip44: number): boolean {
    return this.slip44Cache.has(slip44);
  }

  /**
   * Get list of cached slip44s
   */
  getCachedSlip44s(): number[] {
    return Array.from(this.slip44Cache.keys());
  }

  /**
   * 🔥 FIX: Start periodic safety saves for service worker environments
   */
  startPeriodicSave(): void {
    if (this.periodicSaveInterval) {
      this.stopPeriodicSave();
    }

    console.log('[VaultCache] Starting periodic safety saves every 30 seconds');
    this.periodicSaveInterval = setInterval(async () => {
      try {
        const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

        if (activeSlip44 !== null) {
          // 🔥 FIX: Check live Redux state's isDirty, not cached copy's isDirty
          const liveVaultState = store.getState().vault;
          if (liveVaultState.isDirty) {
            console.log(
              '[VaultCache] Periodic safety save: saving dirty vault changes from live Redux state'
            );
            // Update cache with live state and save
            await this.setSlip44Vault(activeSlip44, liveVaultState);
          }

          // Also save main state (dapp, price, vaultGlobal) periodically
          await saveMainState();
        }
      } catch (error) {
        console.error('[VaultCache] Error in periodic save:', error);
      }
    }, this.PERIODIC_SAVE_INTERVAL);
  }

  /**
   * 🔥 FIX: Stop periodic safety saves
   */
  stopPeriodicSave(): void {
    if (this.periodicSaveInterval) {
      clearInterval(this.periodicSaveInterval);
      this.periodicSaveInterval = null;
      console.log('[VaultCache] Stopped periodic safety saves');
    }
  }

  /**
   * Clear cache (useful for logout/reset)
   */
  clearCache(): void {
    // 🔥 FIX: Stop periodic saves
    this.stopPeriodicSave();

    this.slip44Cache.clear();
    // activeSlip44 now managed by Redux global state
  }

  /**
   * Emergency save before app closes/navigates away
   * Always saves everything regardless of dirty flags - better safe than sorry
   */
  async emergencySave(): Promise<void> {
    // 🔥 Simple flag check to prevent double execution
    if (this.emergencySaveInProgress) {
      console.log(
        `[VaultCache] ⚡ Emergency save already in progress, skipping...`
      );
      return;
    }

    this.emergencySaveInProgress = true;
    const now = Date.now();

    // 🔥 Write to chrome.storage for persistent detection (survives extension shutdown)
    try {
      await chrome.storage.local.set({
        'emergency-save-last-attempt': now,
        'emergency-save-context':
          typeof window !== 'undefined' ? 'popup' : 'background',
      });
    } catch (error) {
      console.error(
        '[VaultCache] Failed to log emergency save attempt:',
        error
      );
    }

    // Stop periodic saves to avoid race conditions during emergency save
    this.stopPeriodicSave();
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

    try {
      // Always save main state (vaultGlobal, dapp, price) - settings could have changed
      await saveMainState();

      if (activeSlip44 !== null) {
        // Force save vault regardless of isDirty flag - emergency saves should be comprehensive
        const liveVaultState = store.getState().vault;
        await this.setSlip44Vault(activeSlip44, liveVaultState);
        // Note: setSlip44Vault already dispatches markVaultAsClean for active slip44
      } else {
        console.log(`[VaultCache] Emergency save: no active slip44 to save`);
      }

      // 🔥 Mark completion for deduplication
      try {
        await chrome.storage.local.set({
          'emergency-save-last-completed': Date.now(),
        });
      } catch (error) {
        console.error(
          '[VaultCache] Failed to log emergency save completion:',
          error
        );
      }

      // 🔥 Write completion timestamp for persistent verification
      try {
        await chrome.storage.local.set({
          'emergency-save-last-completed': Date.now(),
        });
      } catch (storageError) {
        console.error(
          '[VaultCache] Failed to log emergency save completion:',
          storageError
        );
      }
    } catch (error) {
      console.error(`[VaultCache] ❌ Emergency save failed:`, error);
      // Don't re-throw - we still want to mark as complete to avoid retries
    } finally {
      // Always reset flag so subsequent calls can work (in case of partial failure)
      this.emergencySaveInProgress = false;
    }

    // Note: We don't restart periodic saves since emergency save typically means shutdown
  }

  /**
   * 🔧 Debug utility: Check if emergency save was successful
   * Can be called from console to verify emergency save worked after extension restart
   */
  async getEmergencySaveStatus(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'emergency-save-last-attempt',
        'emergency-save-last-completed',
        'emergency-save-context',
      ]);

      const lastAttempt = result['emergency-save-last-attempt'];
      const lastCompleted = result['emergency-save-last-completed'];
      const context = result['emergency-save-context'];

      console.log('🔍 Emergency Save Status:');
      console.log(
        '- Last attempt:',
        lastAttempt ? new Date(lastAttempt).toISOString() : 'Never'
      );
      console.log(
        '- Last completed:',
        lastCompleted ? new Date(lastCompleted).toISOString() : 'Never'
      );
      console.log('- Context:', context || 'Unknown');

      if (lastAttempt && lastCompleted && lastCompleted >= lastAttempt) {
        console.log('✅ Emergency save appears successful!');
      } else if (lastAttempt && !lastCompleted) {
        console.log(
          '⚠️ Emergency save was attempted but may not have completed'
        );
      } else {
        console.log('ℹ️ No recent emergency save activity');
      }
    } catch (error) {
      console.error('❌ Failed to check emergency save status:', error);
    }
  }
}

// Export singleton instance
export const vaultCache = new VaultCache();
export default vaultCache;

// 🔧 Debug utility: Make emergency save status checker globally available
// Usage in console: checkEmergencySave()
(globalThis as any).checkEmergencySave = () =>
  vaultCache.getEmergencySaveStatus();
