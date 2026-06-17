import { chromeStorage } from 'utils/storageAPI';

import {
  SLH_DSA_PRECOMPUTE_CACHE_VERSION,
  getSLHDSAPrecomputeCacheKey,
} from './constants';
import type { SLHDSAPublicPrecomputeRecord } from './types';

const DB_NAME = 'pali-slh-dsa-precompute';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const XMSS_TREE_DB_NAME = 'pali-slh-dsa-xmss-tree-cache';

const openPrecomputeDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is not available in this extension context'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'keyId' });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> => {
  const db = await openPrecomputeDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    let result: T | undefined;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
};

export const getSLHDSAPublicPrecompute = async (
  keyId: string
): Promise<SLHDSAPublicPrecomputeRecord | null> => {
  try {
    const record = await withStore<SLHDSAPublicPrecomputeRecord>(
      'readonly',
      (store) => store.get(keyId)
    );
    return record || null;
  } catch {
    return (
      ((await chromeStorage.getItem(
        getSLHDSAPrecomputeCacheKey(keyId)
      )) as SLHDSAPublicPrecomputeRecord | null) || null
    );
  }
};

export const setSLHDSAPublicPrecompute = async (
  record: SLHDSAPublicPrecomputeRecord
) => {
  const next = {
    ...record,
    updatedAt: Date.now(),
    version: SLH_DSA_PRECOMPUTE_CACHE_VERSION,
  };
  try {
    await withStore('readwrite', (store) => store.put(next));
  } catch {
    await chromeStorage.setItem(
      getSLHDSAPrecomputeCacheKey(record.keyId),
      next
    );
  }
};

export const removeSLHDSAPublicPrecompute = async (keyId: string) => {
  try {
    await withStore('readwrite', (store) => store.delete(keyId));
  } finally {
    await chromeStorage.removeItem(getSLHDSAPrecomputeCacheKey(keyId));
  }
};

export const clearSLHDSAPublicPrecomputeCache = (): Promise<void> =>
  new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onerror = () => resolve();
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  });

export const clearSLHDSAXmssTreeCache = (): Promise<void> =>
  new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(XMSS_TREE_DB_NAME);
    request.onerror = () => resolve();
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  });
