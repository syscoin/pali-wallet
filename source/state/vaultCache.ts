import { loadSlip44State, saveSlip44State } from './paliStorage';
import { ISlip44State } from './vault/types';

/**
 * Simplified vault cache system for lazy loading slip44-specific vault states
 */
class VaultCache {
  private slip44Cache: Map<number, ISlip44State> = new Map();
  private activeSlip44: number | null = null;
  private autoSaveTimeout: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_DELAY = 2000; // 2 seconds delay for batching

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
    console.log(`[VaultCache] Setting slip44 vault: ${slip44}`);

    // Mark as clean since we're saving immediately
    const cleanSlip44State = { ...slip44State, isDirty: false };

    // Update cache
    this.slip44Cache.set(slip44, cleanSlip44State);

    // Save to storage immediately
    await saveSlip44State(slip44, cleanSlip44State);
  }

  /**
   * Update slip44 vault state in cache and optionally schedule auto-save
   */
  updateSlip44VaultInCache(slip44: number, slip44State: ISlip44State): void {
    this.slip44Cache.set(slip44, slip44State);

    // If the vault is dirty, schedule auto-save
    if (slip44State.isDirty) {
      this.scheduleAutoSave();
    }
  }

  /**
   * Check if a slip44 vault is dirty
   */
  isDirty(slip44: number): boolean {
    const slip44State = this.slip44Cache.get(slip44);
    return slip44State?.isDirty || false;
  }

  /**
   * Schedule auto-save with debouncing
   */
  private scheduleAutoSave(): void {
    // Clear existing timeout
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    // Schedule new auto-save
    this.autoSaveTimeout = setTimeout(() => {
      this.saveDirtyVaults();
    }, this.AUTO_SAVE_DELAY);
  }

  /**
   * Save all dirty slip44 vaults to storage
   */
  async saveDirtyVaults(): Promise<void> {
    const dirtySlip44s = Array.from(this.slip44Cache.entries())
      .filter(([, slip44State]) => slip44State.isDirty)
      .map(([slip44]) => slip44);

    if (dirtySlip44s.length === 0) {
      return;
    }

    console.log(
      `[VaultCache] Auto-saving dirty slip44 vaults: ${dirtySlip44s.join(', ')}`
    );

    const savePromises = dirtySlip44s.map(async (slip44) => {
      const slip44State = this.slip44Cache.get(slip44);
      if (slip44State && slip44State.isDirty) {
        // Mark as clean before saving
        const cleanSlip44State = { ...slip44State, isDirty: false };
        this.slip44Cache.set(slip44, cleanSlip44State);
        await saveSlip44State(slip44, cleanSlip44State);
      }
    });

    await Promise.all(savePromises);
    console.log(`[VaultCache] Auto-save completed`);
  }

  /**
   * Force save a specific slip44 vault from cache to storage
   */
  async saveVaultToStorage(slip44: number): Promise<void> {
    const slip44State = this.slip44Cache.get(slip44);
    if (slip44State) {
      const cleanSlip44State = { ...slip44State, isDirty: false };
      this.slip44Cache.set(slip44, cleanSlip44State);
      await saveSlip44State(slip44, cleanSlip44State);
    }
  }

  /**
   * Save all cached slip44 vaults to storage (force save)
   */
  async saveAllCachedVaults(): Promise<void> {
    const savePromises = Array.from(this.slip44Cache.entries()).map(
      async ([slip44, slip44State]) => {
        const cleanSlip44State = { ...slip44State, isDirty: false };
        this.slip44Cache.set(slip44, cleanSlip44State);
        await saveSlip44State(slip44, cleanSlip44State);
      }
    );
    await Promise.all(savePromises);
  }

  /**
   * Get currently active slip44
   */
  getActiveSlip44(): number | null {
    return this.activeSlip44;
  }

  /**
   * Set currently active slip44
   */
  setActiveSlip44(slip44: number): void {
    this.activeSlip44 = slip44;
  }

  /**
   * Get active slip44 vault state from cache
   */
  getActiveSlip44Vault(): ISlip44State | null {
    if (this.activeSlip44 && this.slip44Cache.has(this.activeSlip44)) {
      return this.slip44Cache.get(this.activeSlip44)!;
    }
    return null;
  }

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
   * Get list of dirty slip44s
   */
  getDirtySlip44s(): number[] {
    return Array.from(this.slip44Cache.entries())
      .filter(([, slip44State]) => slip44State.isDirty)
      .map(([slip44]) => slip44);
  }

  /**
   * Clear cache (useful for logout/reset)
   */
  clearCache(): void {
    // Clear auto-save timeout
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
      this.autoSaveTimeout = null;
    }

    this.slip44Cache.clear();
    this.activeSlip44 = null;
  }

  /**
   * Emergency save before app closes/navigates away
   */
  async emergencySave(): Promise<void> {
    // Clear timeout to prevent duplicate saves
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
      this.autoSaveTimeout = null;
    }

    await this.saveDirtyVaults();
  }
}

// Export singleton instance
export const vaultCache = new VaultCache();
export default vaultCache;
