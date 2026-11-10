import { decodeBoundedStorageValue, encodeBoundedStorageValue, STORAGE_LIMITS } from './json.ts';

/** Ordinary bounded row; intentionally does not change the native SQLite schema. */
export const PUBLIC_SESSION_RECORD_KEY = 'native-public-session-v1';
export const PUBLIC_SESSION_RECORD_LIMITS = Object.freeze({
  valueBytes: STORAGE_LIMITS.valueBytes, depth: STORAGE_LIMITS.depth, nodes: STORAGE_LIMITS.nodes,
});
export const encodePublicSessionRecord = (value: unknown): string => encodeBoundedStorageValue(value, PUBLIC_SESSION_RECORD_LIMITS);
export const decodePublicSessionRecord = (value: unknown): unknown => decodeBoundedStorageValue(value, PUBLIC_SESSION_RECORD_LIMITS);
