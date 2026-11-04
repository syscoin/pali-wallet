import { decodeBoundedStorageValue, encodeBoundedStorageValue } from './json.ts';

/** One canonical private account-record value, shared by storage and custody. */
export const ACCOUNT_RECORD_KEY = 'native-wallet-catalogue-v1';

/** One account-map domain, without widening mnemonic, auth or other values. */
export const ACCOUNT_RECORD_LIMITS = Object.freeze({ valueBytes: 4 * 1024 * 1024, depth: 32, nodes: 500000 });
export const encodeAccountRecord = (value: unknown): string => encodeBoundedStorageValue(value, ACCOUNT_RECORD_LIMITS);
export const decodeAccountRecord = (value: unknown): unknown => decodeBoundedStorageValue(value, ACCOUNT_RECORD_LIMITS);
