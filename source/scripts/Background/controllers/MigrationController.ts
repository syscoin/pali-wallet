/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import { getIsMigratedVersion } from 'state/paliStorage';
import { chromeStorage } from 'utils/storageAPI';

// Define migration entries in order
const migrations: Array<{
  description: string;
  handler: (state: any) => Promise<void>;
  version: string;
}> = [
  // Migrate old vault format with currentSessionSalt AND clean up vault data from main state
  {
    version: '4.0.0',
    description:
      'Migrate old vault format (currentSessionSalt) and clean up vault data from main state',
    handler: async (state: any) => {
      console.log('[Migration 4.0.0] Running migration checks...');

      // Part 1: Check for old vault format
      try {
        const vaultKeys = await chromeStorage.getItem('sysweb3-vault-keys');

        if (vaultKeys && vaultKeys.currentSessionSalt) {
          console.log(
            '[Migration 4.0.0] Found old vault format with currentSessionSalt'
          );
          console.log(
            '[Migration 4.0.0] Migration will be handled during wallet unlock in KeyringManager'
          );
          console.log(
            '[Migration 4.0.0] NOTE: Accounts will be created after successful migration'
          );
          // The actual migration happens in KeyringManager.unlock()
          // which properly handles the dual salt system and mnemonic decryption
        }
      } catch (error) {
        console.error('[Migration 4.0.0] Error checking vault-keys:', error);
      }

      // Part 2: Clean up vault data from main state storage
      if (state && state.vault) {
        console.log(
          '[Migration 4.0.0] Found vault data in main state, cleaning up...'
        );

        // Create cleaned state without vault
        const { vault: _vault, ...cleanedState } = state;
        void _vault; // Mark as intentionally unused

        // Save cleaned state
        await chromeStorage.setItem('state', cleanedState);

        console.log('[Migration 4.0.0] Vault data removed from main state');
      } else {
        console.log('[Migration 4.0.0] No vault data found in main state');
      }
    },
  },
];

// Compare versions: returns 1 if a > b, -1 if a < b, 0 if equal
const compareVersions = (a: string, b: string): number => {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;

    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }

  return 0;
};

const MigrationController = async (state: any) => {
  const currentPaliVersion = paliData.version;

  if (!state) {
    console.warn('[MigrationController] No state found in chrome storage');
    return;
  }

  console.log(
    `[MigrationController] Current Pali version: ${currentPaliVersion}`
  );

  // Run all migrations that haven't been applied yet
  for (const migration of migrations) {
    const isMigrated = await getIsMigratedVersion(migration.version);

    if (!isMigrated) {
      // Run migration if:
      // 1. Current version is greater than or equal to migration version
      // 2. Migration hasn't been applied yet
      if (compareVersions(currentPaliVersion, migration.version) >= 0) {
        console.log(
          `[MigrationController] Running migration ${migration.version}: ${migration.description}`
        );
        try {
          await migration.handler(state);
          console.log(
            `[MigrationController] Migration ${migration.version} completed successfully`
          );
          // Mark migration as completed
          await chromeStorage.setItem(migration.version, 'migrated');
        } catch (error) {
          console.error(
            `[MigrationController] Migration ${migration.version} failed:`,
            error
          );
          // Continue with other migrations even if one fails
        }
      }
    }
  }
};

export default MigrationController;
