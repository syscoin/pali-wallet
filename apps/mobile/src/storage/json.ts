import { WalletStorageError } from './types.ts';

export const STORAGE_LIMITS = Object.freeze({
  keyBytes: 256,
  valueBytes: 64 * 1024,
  batchKeys: 16,
  depth: 32,
  nodes: 10000,
  records: 64,
});

const encoder = new TextEncoder();
const own = Object.prototype.hasOwnProperty;
const invalid = () => new WalletStorageError('STORAGE_CORRUPT');

export function validateStorageKey(key: unknown): asserts key is string {
  if (
    typeof key !== 'string' ||
    !key ||
    key.length > STORAGE_LIMITS.keyBytes ||
    key.includes('\0')
  )
    throw invalid();
  const bytes = encoder.encode(key);
  if (
    bytes.length > STORAGE_LIMITS.keyBytes ||
    new TextDecoder().decode(bytes) !== key
  )
    throw invalid();
}

/** Bounded snapshots: getters, custom prototypes and lossy JSON values reject. */
export function encodeStorageValue(value: unknown): string {
  const chunks: string[] = [];
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const append = (text: string) => {
    // Bound before UTF-8 conversion or retention; a JSON escape is at most 6 bytes.
    if (text.length > STORAGE_LIMITS.valueBytes) throw invalid();
    bytes += encoder.encode(text).length;
    if (bytes > STORAGE_LIMITS.valueBytes) throw invalid();
    chunks.push(text);
  };
  const visit = (item: unknown, depth: number) => {
    if (++nodes > STORAGE_LIMITS.nodes || depth > STORAGE_LIMITS.depth)
      throw invalid();
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'boolean') {
      append(item ? 'true' : 'false');
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw invalid();
      append(JSON.stringify(item));
      return;
    }
    if (typeof item === 'string') {
      if (item.length > STORAGE_LIMITS.valueBytes) throw invalid();
      append(JSON.stringify(item));
      return;
    }
    if (typeof item !== 'object' || seen.has(item)) throw invalid();
    seen.add(item);
    const array = Array.isArray(item);
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw invalid();
    // Obtain names only; do not copy property values/descriptors before fan-out admission.
    const keys = Reflect.ownKeys(item);
    if (
      keys.length > STORAGE_LIMITS.nodes - nodes + (array ? 1 : 0) ||
      keys.some((key) => typeof key !== 'string')
    )
      throw invalid();
    if (array) {
      if (
        item.length > STORAGE_LIMITS.nodes - nodes ||
        keys.length !== item.length + 1
      )
        throw invalid();
      append('[');
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (
          !descriptor ||
          !own.call(descriptor, 'value') ||
          !descriptor.enumerable
        )
          throw invalid();
        if (i) append(',');
        visit(descriptor.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i] as string;
        if (key.length > STORAGE_LIMITS.valueBytes) throw invalid();
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (
          !descriptor ||
          !own.call(descriptor, 'value') ||
          !descriptor.enumerable
        )
          throw invalid();
        if (i) append(',');
        append(JSON.stringify(key));
        append(':');
        visit(descriptor.value, depth + 1);
      }
      append('}');
    }
  };
  visit(value, 0);
  return chunks.join('');
}

export function decodeStorageValue(raw: unknown): unknown {
  if (
    typeof raw !== 'string' ||
    raw.length > STORAGE_LIMITS.valueBytes ||
    encoder.encode(raw).length > STORAGE_LIMITS.valueBytes
  )
    throw invalid();
  try {
    const parsed: unknown = JSON.parse(raw);
    encodeStorageValue(parsed);
    return parsed;
  } catch {
    throw invalid();
  }
}
