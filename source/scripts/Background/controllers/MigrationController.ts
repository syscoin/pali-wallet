/* eslint-disable camelcase */
import paliData from '../../../../package.json';
import { getIsMigratedVersion } from 'state/paliStorage';

// Define migration entries in order
const migrations: Array<{
  description: string;
  handler: (state: any) => Promise<void>;
  version: string;
}> = [
  // No migrations needed currently
  // Add new migrations here as needed
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
