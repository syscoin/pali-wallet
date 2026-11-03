import { parentPort, workerData } from 'node:worker_threads';
import { SqliteWalletStorage } from '../src/storage/sqlite.ts';
import {
  digest,
  INSTALLATION,
  nodeConnection,
  validPair,
} from './storageHelpers.ts';

const owned = nodeConnection(workerData.file);
const storage = await SqliteWalletStorage.open(
  owned.connection,
  digest,
  INSTALLATION,
  false
);
if (workerData.mode === 'hold') {
  owned.database.exec('BEGIN IMMEDIATE');
  parentPort!.postMessage({ held: true });
  setTimeout(async () => {
    owned.database.exec('ROLLBACK');
    await storage.close();
    parentPort!.postMessage({ released: true });
  }, 250);
} else {
  parentPort!.postMessage({ ready: true });
  parentPort!.once('message', async () => {
    try {
      const created = await storage.keyringStorage.createManyIfAbsent(
        validPair(workerData.index)
      );
      await storage.close();
      parentPort!.postMessage({ created, index: workerData.index });
    } catch {
      parentPort!.postMessage({ failed: true });
    }
  });
}
