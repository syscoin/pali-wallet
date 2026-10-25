import type { MerkleWork } from './merkle';
import type {
  PrivacyPoolId,
  PrivacySnapshot,
  PrivacySyncStatus,
} from './types';

export interface PrivacyRecord {
  generation: number;
  poolId: PrivacyPoolId;
  rpcUrl?: string;
  running: boolean;
  status: PrivacySyncStatus;
  work?: MerkleWork;
}

export interface PrivacyCache {
  clear: (poolId: PrivacyPoolId) => Promise<PrivacyRecord>;
  commit: (
    poolId: PrivacyPoolId,
    generation: number,
    status: PrivacySyncStatus
  ) => Promise<boolean>;
  get: (poolId: PrivacyPoolId) => Promise<PrivacyRecord | undefined>;
  getCandidate: (poolId: PrivacyPoolId) => Promise<PrivacySnapshot | undefined>;
  getVerified: (poolId: PrivacyPoolId) => Promise<PrivacySnapshot | undefined>;
  save: (record: PrivacyRecord, expectedGeneration: number) => Promise<boolean>;
  saveCandidate: (
    poolId: PrivacyPoolId,
    generation: number,
    snapshot: PrivacySnapshot
  ) => Promise<boolean>;
}

const DB_NAME = 'pali-public-privacy-pools';
const META = 'state';
const DATA = 'snapshots';
const readyKey = (id: PrivacyPoolId) => `${id}:ready`;
const candidateKey = (id: PrivacyPoolId) => `${id}:candidate`;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(META, { keyPath: 'poolId' });
      request.result.createObjectStore(DATA, { keyPath: 'key' });
    };
    request.onerror = () => reject(new Error('privacy_storage_unavailable'));
    request.onblocked = () => reject(new Error('privacy_storage_unavailable'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  callback: (tx: IDBTransaction, result: (value: T) => void) => void
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let value: T;
    const tx = db.transaction([META, DATA], mode);
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error('privacy_storage_unavailable'));
    };
    try {
      callback(tx, (next) => {
        value = next;
      });
    } catch {
      tx.abort();
    }
  });
}

// Generations are checked inside the same transaction as every write. A clear
// or pause therefore wins over an older download/verification completion.
export const privacyCache: PrivacyCache = {
  get: (poolId) =>
    transact('readonly', (tx, result) => {
      const request = tx.objectStore(META).get(poolId);
      request.onsuccess = () => result(request.result);
    }),
  getCandidate: (poolId) =>
    transact('readonly', (tx, result) => {
      const request = tx.objectStore(DATA).get(candidateKey(poolId));
      request.onsuccess = () => result(request.result?.snapshot);
    }),
  getVerified: (poolId) =>
    transact('readonly', (tx, result) => {
      const request = tx.objectStore(DATA).get(readyKey(poolId));
      request.onsuccess = () => result(request.result?.snapshot);
    }),
  save: (record, expectedGeneration) =>
    transact('readwrite', (tx, result) => {
      const store = tx.objectStore(META);
      const request = store.get(record.poolId);
      request.onsuccess = () => {
        const matches =
          (request.result?.generation ?? 0) === expectedGeneration;
        if (matches) store.put(record);
        result(matches);
      };
    }),
  saveCandidate: (poolId, generation, snapshot) =>
    transact('readwrite', (tx, result) => {
      const request = tx.objectStore(META).get(poolId);
      request.onsuccess = () => {
        const matches =
          request.result?.generation === generation && request.result?.running;
        if (matches)
          tx.objectStore(DATA).put({ key: candidateKey(poolId), snapshot });
        result(!!matches);
      };
    }),
  commit: (poolId, generation, status) =>
    transact('readwrite', (tx, result) => {
      const meta = tx.objectStore(META);
      const data = tx.objectStore(DATA);
      const request = meta.get(poolId);
      request.onsuccess = () => {
        const record: PrivacyRecord = request.result;
        if (!record || record.generation !== generation || !record.running) {
          result(false);
          return;
        }
        const candidate = data.get(candidateKey(poolId));
        candidate.onsuccess = () => {
          if (!candidate.result) {
            tx.abort();
            return;
          }
          data.put({
            key: readyKey(poolId),
            snapshot: candidate.result.snapshot,
          });
          data.delete(candidateKey(poolId));
          meta.put({ ...record, running: false, status, work: undefined });
          result(true);
        };
      };
    }),
  clear: (poolId) =>
    transact('readwrite', (tx, result) => {
      const meta = tx.objectStore(META);
      const request = meta.get(poolId);
      request.onsuccess = () => {
        const next: PrivacyRecord = {
          poolId,
          generation: (request.result?.generation ?? 0) + 1,
          running: false,
          status: { poolId, phase: 'idle' },
        };
        meta.put(next);
        tx.objectStore(DATA).delete(readyKey(poolId));
        tx.objectStore(DATA).delete(candidateKey(poolId));
        result(next);
      };
    }),
};
