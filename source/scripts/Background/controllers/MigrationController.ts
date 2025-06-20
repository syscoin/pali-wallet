/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import v3_0_1 from '../migration/v3_0_1';
import v3_3_2 from '../migration/v3_3_2';
import v3_4_1 from '../migration/v3_4_1';
import v3_4_3 from '../migration/v3_4_3';
import v3_5_0 from '../migration/v3_5_0';
import { getIsMigratedVersion } from 'state/paliStorage';

// Define migration entries in order
const migrations = [
  { version: '3.0.1', handler: v3_0_1, description: 'add faucet feature' },
  { version: '3.3.2', handler: v3_3_2, description: 'add faucet feature' },
  { version: '3.4.1', handler: v3_4_1, description: 'remove 80001 network' },
  { version: '3.4.3', handler: v3_4_3, description: 'remove timer properties' },
  {
    version: '3.5.0',
    handler: v3_5_0,
    description: 'fix networks without kind properties',
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
