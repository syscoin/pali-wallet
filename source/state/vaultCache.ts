import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { loadSlip44State, saveSlip44State } from './paliStorage';
import store, { saveMainState } from './store';
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

    console.log(
      `[VaultCache] ✅ Slip44 validation passed for slip44=${slip44}`
    );

    // Mark as clean since we're saving immediately
    const cleanSlip44State = { ...slip44State, isDirty: false };

    // Update cache
    this.slip44Cache.set(slip44, cleanSlip44State);

    // Save to storage immediately
    await saveSlip44State(slip44, cleanSlip44State);
  }

  /**
   * Check if a slip44 vault is dirty
   */
  isDirty(slip44: number): boolean {
    const slip44State = this.slip44Cache.get(slip44);
    return slip44State?.isDirty || false;
  }

  /**
   * Save only the active slip44 vault to storage (for periodic/emergency saves)
   */
  async saveActiveVault(activeSlip44: number): Promise<void> {
    const slip44State = this.slip44Cache.get(activeSlip44);

    if (!slip44State || !slip44State.isDirty) {
      return; // Nothing to save
    }

    // 🛡️ SAFEGUARD: Validate slip44 matches before saving
    if (!validateVaultSlip44(slip44State, activeSlip44)) {
      console.warn(
        `[VaultCache] saveActiveVault: Slip44 validation failed! Skipping save for slip44=${activeSlip44}, activeSlip44=${activeSlip44}`
      );
      return; // Don't throw here since this is called from periodic/emergency saves
    }

    console.log(`[VaultCache] Saving active vault: ${activeSlip44}`);
    console.log(
      `[VaultCache] ✅ Slip44 validation passed for slip44=${activeSlip44}`
    );

    // Mark as clean before saving
    const cleanSlip44State = { ...slip44State, isDirty: false };
    this.slip44Cache.set(activeSlip44, cleanSlip44State);
    await saveSlip44State(activeSlip44, cleanSlip44State);

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
          // Only save if there are dirty changes (important structural changes)
          const slip44State = this.slip44Cache.get(activeSlip44);
          if (slip44State?.isDirty) {
            console.log(
              '[VaultCache] Periodic safety save: saving dirty vault changes'
            );
            await this.saveActiveVault(activeSlip44);
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
   */
  async emergencySave(): Promise<void> {
    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;

    if (activeSlip44 !== null) {
      console.log(
        `[VaultCache] Emergency save: saving only active vault (slip44=${activeSlip44})`
      );
      await this.saveActiveVault(activeSlip44);

      // Also save main state to ensure consistency
      await saveMainState();
    } else {
      console.log(`[VaultCache] Emergency save: no active slip44 to save`);
    }
  }
}

// Export singleton instance
export const vaultCache = new VaultCache();
export default vaultCache;
