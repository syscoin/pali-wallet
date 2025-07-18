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
    network.slip44 ?? // Use nullish coalescing to allow slip44: 0 (Bitcoin)
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

  // 🔥 Simple flag to prevent double emergency saves
  private emergencySaveInProgress = false;

  /**
   * Get slip44-specific vault state, loading it if not cached
   */
  async getSlip44Vault(slip44: number): Promise<ISlip44State | null> {
    // Return from cache if already loaded
    if (this.slip44Cache.has(slip44)) {
      return this.slip44Cache.get(slip44)!;
    }

    // Load from storage
    const slip44State = await loadSlip44State(slip44);

    if (slip44State) {
      this.slip44Cache.set(slip44, slip44State);
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
    // Update cache
    this.slip44Cache.set(slip44, slip44State);

    // Save to storage immediately
    await saveSlip44State(slip44, slip44State);
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
   * Clear cache (useful for logout/reset)
   */
  clearCache(): void {
    this.slip44Cache.clear();
    // activeSlip44 now managed by Redux global state
  }

  /**
   * Clear specific slip44 from cache
   */
  clearSlip44FromCache(slip44: number): void {
    this.slip44Cache.delete(slip44);
    console.log(`[VaultCache] Cleared slip44 ${slip44} from cache`);
  }

  /**
   * Emergency save before app closes/navigates away
   * Always saves everything regardless of dirty flags - better safe than sorry
   */
  async emergencySave(): Promise<void> {
    console.log('[VaultCache] 🚨 Emergency save triggered');

    // 🔥 Simple flag check to prevent double execution
    if (this.emergencySaveInProgress) {
      console.log(
        '[VaultCache] ⚡ Emergency save already in progress, skipping...'
      );
      return;
    }
    this.emergencySaveInProgress = true;

    const activeSlip44 = store.getState().vaultGlobal.activeSlip44;
    const liveVaultState = store.getState().vault;

    try {
      // Always save main state (vaultGlobal, dapp, price) - settings could have changed
      await saveMainState();

      if (activeSlip44 !== null && liveVaultState) {
        // During emergency save, use the vault's actual network slip44
        // This handles cases where network is switching and activeSlip44 doesn't match yet
        const vaultNetworkSlip44 = liveVaultState.activeNetwork
          ? getSlip44ForNetwork(liveVaultState.activeNetwork)
          : activeSlip44;

        // Save to the slip44 that matches the vault's current network
        // This prevents slip44 mismatch errors during network switches
        this.slip44Cache.set(vaultNetworkSlip44, liveVaultState);
        await saveSlip44State(vaultNetworkSlip44, liveVaultState);

        console.log(
          `[VaultCache] ✅ Emergency save completed for slip44: ${vaultNetworkSlip44} (vault network slip44)`
        );
      } else {
        console.log(`[VaultCache] Emergency save: no active slip44 to save`);
      }
    } catch (error) {
      console.error('[VaultCache] ❌ Emergency save failed:', error);
    } finally {
      // Always reset flag so subsequent calls can work (in case of partial failure)
      this.emergencySaveInProgress = false;
    }
  }
}

// Export singleton instance
const vaultCache = new VaultCache();
export default vaultCache;
