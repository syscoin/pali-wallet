import type {
  INoteBackupConfirmation,
  INoteBackupExport,
  INoteBackupPreview,
  INoteBackupVerification,
} from '../../wallet/noteBackupService';

export interface INoteBackupWireExport
  extends Omit<INoteBackupExport, 'bytes'> {
  file: string;
}

export interface INoteBackupController {
  begin: () => Promise<string>;
  cancel: (id: string) => Promise<void>;
  commitImport: (
    id: string,
    walletPassword: string
  ) => Promise<INoteBackupConfirmation>;
  exportEncrypted: (
    id: string,
    walletPassword: string,
    backupPassword: string
  ) => Promise<INoteBackupWireExport>;
  prepareImport: (
    id: string,
    file: string,
    backupPassword: string
  ) => Promise<INoteBackupPreview>;
  readCommitReceipt: (id: string) => Promise<INoteBackupConfirmation | null>;
  verifyExport: (
    id: string,
    file: string,
    backupPassword: string
  ) => Promise<INoteBackupVerification>;
}
