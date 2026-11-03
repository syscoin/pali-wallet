import { createNoteBackupService } from '../../../wallet/noteBackupService';
import type { INoteBackupController } from 'utils/privacy/noteBackupTypes';
import {
  decodeNoteBackupFile,
  encodeNoteBackupFile,
} from 'utils/privacy/noteBackupWire';

import type { INoteBackupServicePorts } from '../../../wallet/noteBackupService';

/** Only ciphertext and public summaries cross the extension messaging boundary. */
export function createExtensionNoteBackupController(
  ports: INoteBackupServicePorts
): Readonly<INoteBackupController> {
  const service = createNoteBackupService(ports);
  return Object.freeze({
    begin: async () => service.begin(),
    cancel: async (id: string) => service.cancel(id),
    commitImport: service.commitImport,
    exportEncrypted: async (
      id: string,
      walletPassword: string,
      backupPassword: string
    ) => {
      const result = await service.exportEncrypted(
        id,
        walletPassword,
        backupPassword
      );
      try {
        return {
          id: result.id,
          createdAt: result.createdAt,
          noteCount: result.noteCount,
          file: encodeNoteBackupFile(result.bytes),
        };
      } finally {
        result.bytes.fill(0);
      }
    },
    prepareImport: async (id: string, file: string, backupPassword: string) => {
      const bytes = decodeNoteBackupFile(file);
      try {
        return await service.prepareImport(id, bytes, backupPassword);
      } finally {
        bytes.fill(0);
      }
    },
    readCommitReceipt: service.readCommitReceipt,
    verifyExport: async (id: string, file: string, backupPassword: string) => {
      const bytes = decodeNoteBackupFile(file);
      try {
        return await service.verifyExport(id, bytes, backupPassword);
      } finally {
        bytes.fill(0);
      }
    },
  });
}
