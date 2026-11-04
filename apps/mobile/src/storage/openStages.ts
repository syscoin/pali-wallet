/** Value-free checkpoints for the isolated native qualification entry. */
export const STORAGE_OPEN_STAGES = [
  'native-module',
  'policy-acquire',
  'key-read',
  'key-generate',
  'key-write-provisioning',
  'key-readback-provisioning',
  'policy-inspect',
  'policy-create-database',
  'database-open',
  'sqlite-open',
  'sqlcipher-version',
  'sqlcipher-key',
  'sqlcipher-busy-timeout',
  'sqlcipher-memory-security',
  'sqlcipher-wal',
  'sqlcipher-synchronous-full',
  'sqlcipher-temp-memory',
  'sqlcipher-journal-readback',
  'sqlcipher-synchronous-readback',
  'sqlcipher-temp-readback',
  'sqlcipher-memory-readback',
  'policy-protect-database',
  'schema-open',
  'provisioning-state',
  'key-write-ready',
  'key-readback-ready',
  'policy-protect-final',
  'ready',
  'ios-policy-lease-acquire',
  'ios-policy-lease-validate',
  'ios-policy-lease-release',
  'ios-policy-directory-resolve',
  'ios-policy-directory-create',
  'ios-policy-resource-read',
  'ios-policy-symlink-check',
  'ios-policy-type-check',
  'ios-policy-protection-write',
  'ios-policy-backup-write',
  'ios-policy-attributes-read',
  'ios-policy-protection-read',
  'ios-policy-backup-read',
  'ios-policy-protection-check',
  'ios-policy-protection-missing',
  'ios-policy-protection-none',
  'ios-policy-protection-unless-open',
  'ios-policy-protection-until-auth',
  'ios-policy-protection-unknown',
  'ios-policy-permissions-check',
  'ios-policy-backup-check',
  'ios-policy-directory-list',
  'ios-policy-child-name',
  'ios-policy-file-size',
  'ios-policy-orphan-sidecars',
  'ios-policy-database-absent',
  'ios-policy-database-create',
  'ios-policy-database-close',
] as const;

export type StorageOpenStage = (typeof STORAGE_OPEN_STAGES)[number];
export type StorageOpenObserver = (stage: StorageOpenStage) => void;

/** Observer failures cannot change storage success, failure, or cleanup. */
export function observeStorageOpen(
  observer: StorageOpenObserver | undefined,
  stage: StorageOpenStage
): void {
  try {
    const result: unknown = observer?.(stage);
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
  } catch {
    // Optional diagnostic code must remain inert on the production path.
  }
}
