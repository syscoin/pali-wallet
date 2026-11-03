import { STORAGE_OPEN_STAGES } from '../src/storage/openStages.ts';
import type { StorageOpenStage } from '../src/storage/openStages.ts';
import { WalletStorageError } from '../src/storage/types.ts';
import type { StorageErrorCode } from '../src/storage/types.ts';

const CODES: readonly StorageErrorCode[] = [
  'STORAGE_UNAVAILABLE',
  'STORAGE_CORRUPT',
  'STORAGE_REOPEN_REQUIRED',
  'STORAGE_CLOSED',
  'STORAGE_CHANGED',
  'AUTH_THROTTLED',
  'STORAGE_KEY_MISSING',
  'STORAGE_ORPHAN_KEY',
];

/** No exception text, paths, SQL, keychain values, or operation arguments. */
export function createStorageQualificationDiagnostic() {
  let stage: StorageOpenStage | undefined;
  let code: StorageErrorCode | undefined;
  let sealed = false;
  return {
    observe(next: StorageOpenStage) {
      if (sealed || !STORAGE_OPEN_STAGES.includes(next)) return;
      stage = next;
      if (next === 'ready') sealed = true;
    },
    capture(error: unknown) {
      if (sealed) return;
      try {
        if (error instanceof WalletStorageError) {
          const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
          const value: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
          if (typeof value === 'string' && CODES.includes(value as StorageErrorCode))
            code = value as StorageErrorCode;
        }
      } catch {
        // Even a proxy or accessor exception must preserve the original failure.
      } finally {
        sealed = true;
      }
    },
    report: () => Object.freeze({ ...(stage ? { stage } : {}), ...(code ? { code } : {}) }),
  };
}

/** Reject any free-form diagnostic payload before preserving a report. */
export function isStorageQualificationDiagnostic(
  value: unknown,
  status: unknown,
  failedStage: unknown
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== 'stage' && key !== 'code')) return false;
  if (record.stage !== undefined &&
      (typeof record.stage !== 'string' || !STORAGE_OPEN_STAGES.includes(record.stage as StorageOpenStage))) return false;
  if (record.code !== undefined &&
      (typeof record.code !== 'string' || !CODES.includes(record.code as StorageErrorCode))) return false;
  if (status === 'passed') return record.stage === 'ready' && keys.length === 1;
  if (status !== 'failed') return false;
  if (failedStage === 'open SQLCipher and device key')
    return record.stage !== undefined && record.stage !== 'ready';
  return keys.length === 0 || (record.stage === 'ready' && keys.length === 1);
}
