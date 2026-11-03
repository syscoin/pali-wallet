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
