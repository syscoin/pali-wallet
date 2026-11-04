import { observeStorageOpen } from './openStages.ts';
import type { StorageOpenObserver, StorageOpenStage } from './openStages.ts';
import type { StoragePolicy } from './coordinator.ts';

const IOS_POLICY_CODES = Object.freeze({
  PALI_STORAGE_POLICY_LEASE_ACQUIRE: 'ios-policy-lease-acquire',
  PALI_STORAGE_POLICY_LEASE_VALIDATE: 'ios-policy-lease-validate',
  PALI_STORAGE_POLICY_LEASE_RELEASE: 'ios-policy-lease-release',
  PALI_STORAGE_POLICY_DIRECTORY_RESOLVE: 'ios-policy-directory-resolve',
  PALI_STORAGE_POLICY_DIRECTORY_CREATE: 'ios-policy-directory-create',
  PALI_STORAGE_POLICY_RESOURCE_READ: 'ios-policy-resource-read',
  PALI_STORAGE_POLICY_SYMLINK_CHECK: 'ios-policy-symlink-check',
  PALI_STORAGE_POLICY_TYPE_CHECK: 'ios-policy-type-check',
  PALI_STORAGE_POLICY_PROTECTION_WRITE: 'ios-policy-protection-write',
  PALI_STORAGE_POLICY_BACKUP_WRITE: 'ios-policy-backup-write',
  PALI_STORAGE_POLICY_ATTRIBUTES_READ: 'ios-policy-attributes-read',
  PALI_STORAGE_POLICY_PROTECTION_READ: 'ios-policy-protection-read',
  PALI_STORAGE_POLICY_BACKUP_READ: 'ios-policy-backup-read',
  PALI_STORAGE_POLICY_PROTECTION_CHECK: 'ios-policy-protection-check',
  PALI_STORAGE_POLICY_PROTECTION_MISSING: 'ios-policy-protection-missing',
  PALI_STORAGE_POLICY_PROTECTION_NONE: 'ios-policy-protection-none',
  PALI_STORAGE_POLICY_PROTECTION_UNLESS_OPEN: 'ios-policy-protection-unless-open',
  PALI_STORAGE_POLICY_PROTECTION_UNTIL_AUTH: 'ios-policy-protection-until-auth',
  PALI_STORAGE_POLICY_PROTECTION_UNKNOWN: 'ios-policy-protection-unknown',
  PALI_STORAGE_POLICY_PERMISSIONS_CHECK: 'ios-policy-permissions-check',
  PALI_STORAGE_POLICY_BACKUP_CHECK: 'ios-policy-backup-check',
  PALI_STORAGE_POLICY_DIRECTORY_LIST: 'ios-policy-directory-list',
  PALI_STORAGE_POLICY_CHILD_NAME: 'ios-policy-child-name',
  PALI_STORAGE_POLICY_FILE_SIZE: 'ios-policy-file-size',
  PALI_STORAGE_POLICY_ORPHAN_SIDECARS: 'ios-policy-orphan-sidecars',
  PALI_STORAGE_POLICY_DATABASE_ABSENT: 'ios-policy-database-absent',
  PALI_STORAGE_POLICY_DATABASE_CREATE: 'ios-policy-database-create',
  PALI_STORAGE_POLICY_DATABASE_CLOSE: 'ios-policy-database-close',
} satisfies Record<string, StorageOpenStage>);

/** Only the first policy failure can refine a qualification checkpoint. */
export function createNativePolicyObserver(observer?: StorageOpenObserver) {
  let failed = false;
  return async function observeOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!failed && observer) {
        failed = true;
        try {
          const descriptor = error && (typeof error === 'object' || typeof error === 'function')
            ? Object.getOwnPropertyDescriptor(error, 'code')
            : undefined;
          const code: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
          if (typeof code === 'string' && Object.hasOwn(IOS_POLICY_CODES, code))
            observeStorageOpen(observer, IOS_POLICY_CODES[code as keyof typeof IOS_POLICY_CODES]);
        } catch {
          // A malformed error/observer cannot replace the original operation failure.
        }
      }
      throw error;
    }
  };
}

/** Cleanup must execute unchanged without replacing the opening checkpoint. */
export function observeNativeStoragePolicy(nativePolicy: StoragePolicy, observer?: StorageOpenObserver): StoragePolicy {
  if (!observer) return nativePolicy;
  const observe = createNativePolicyObserver(observer);
  return {
    acquire: () => observe(() => nativePolicy.acquire()),
    inspect: (token) => observe(() => nativePolicy.inspect(token)),
    createDatabase: (token) => observe(() => nativePolicy.createDatabase(token)),
    protect: (token) => observe(() => nativePolicy.protect(token)),
    release: (token) => nativePolicy.release(token),
  };
}
