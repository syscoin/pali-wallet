// Storage initialization manager to handle race conditions
export class StorageManager {
  private static instance: StorageManager;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private static MIGRATION_FLAG_KEY = 'pali_localStorage_migration_completed';

  private constructor() {}

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    try {
      // Wait for chrome storage to be ready
      await new Promise<void>((resolve) => {
        if (chrome?.storage?.local) {
          resolve();
        } else {
          // Wait a bit for chrome APIs to be available
          setTimeout(resolve, 100);
        }
      });

      // Check if migration has already been completed
      const migrationCompleted = await new Promise<boolean>((resolve) => {
        chrome.storage.local.get(
          StorageManager.MIGRATION_FLAG_KEY,
          (result) => {
            resolve(result[StorageManager.MIGRATION_FLAG_KEY] === true);
          }
        );
      });

      if (!migrationCompleted) {
        console.log('[StorageManager] Checking for localStorage migration...');

        // Check if vault keys exist in chrome storage
        const vaultKeys = await new Promise<any>((resolve) => {
          chrome.storage.local.get('sysweb3-vault-keys', (result) => {
            resolve(result['sysweb3-vault-keys']);
          });
        });

        const vault = await new Promise<any>((resolve) => {
          chrome.storage.local.get('sysweb3-vault', (result) => {
            resolve(result['sysweb3-vault']);
          });
        });

        // Only check localStorage if data doesn't exist in chrome storage
        if ((!vaultKeys || !vault) && typeof localStorage !== 'undefined') {
          try {
            const itemsToMigrate: Record<string, any> = {};

            // Check for vault-keys in localStorage
            if (!vaultKeys) {
              const localStorageKeys =
                localStorage.getItem('sysweb3-vault-keys');
              if (localStorageKeys) {
                itemsToMigrate['sysweb3-vault-keys'] =
                  JSON.parse(localStorageKeys);
                console.log(
                  '[StorageManager] Found vault-keys in localStorage'
                );
              }
            }

            // Check for vault in localStorage
            if (!vault) {
              const localStorageVault = localStorage.getItem('sysweb3-vault');
              if (localStorageVault) {
                itemsToMigrate['sysweb3-vault'] = JSON.parse(localStorageVault);
                console.log('[StorageManager] Found vault in localStorage');
              }
            }

            // Migrate all found items at once
            if (Object.keys(itemsToMigrate).length > 0) {
              console.log(
                '[StorageManager] Migrating data from localStorage to chrome.storage'
              );
              await new Promise<void>((resolve) => {
                chrome.storage.local.set(itemsToMigrate, resolve);
              });

              // Clean up localStorage after successful migration
              if (itemsToMigrate['sysweb3-vault-keys']) {
                localStorage.removeItem('sysweb3-vault-keys');
              }
              if (itemsToMigrate['sysweb3-vault']) {
                localStorage.removeItem('sysweb3-vault');
              }
              console.log(
                '[StorageManager] Migration complete, cleaned up localStorage'
              );
            }
          } catch (error) {
            console.error('[StorageManager] Migration error:', error);
            // Don't throw, just log - migration failure shouldn't break initialization
          }
        }

        // Mark migration as completed
        await new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              [StorageManager.MIGRATION_FLAG_KEY]: true,
            },
            resolve
          );
        });
        console.log('[StorageManager] Migration check completed and marked');
      } else {
        console.log(
          '[StorageManager] Migration already completed, skipping check'
        );
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('[StorageManager] Initialization error:', error);
      // Reset so it can be tried again
      this.initPromise = null;
      this.isInitialized = false;
      throw error;
    }
  }

  public isReady(): boolean {
    return this.isInitialized;
  }
}
