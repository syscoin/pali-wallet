import {
  decodeBoundedStorageValue,
  encodeBoundedStorageValue,
} from './json.ts';

export const NATIVE_CONNECTION_STORAGE_KEY = 'native-dapp-connections';

// The SDK retains encrypted inbound messages twice and plaintext requests in
// history and pending-request stores. One admitted 1 MiB request needs roughly
// 4.67 MiB before metadata and its response. This bound applies only here.
export const CONNECTION_RECORD_LIMITS = Object.freeze({
  valueBytes: 8 * 1024 * 1024,
  depth: 48,
  nodes: 100000,
});

export const encodeConnectionRecord = (value: unknown): string =>
  encodeBoundedStorageValue(value, CONNECTION_RECORD_LIMITS);
export const decodeConnectionRecord = (value: unknown): unknown =>
  decodeBoundedStorageValue(value, CONNECTION_RECORD_LIMITS);
