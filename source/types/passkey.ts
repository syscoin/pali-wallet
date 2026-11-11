/** Shared public credential metadata; no browser or wallet runtime dependency. */
export const PasskeyBackupStatus = {
  BackupCapable: 'backupCapable',
  DeviceBound: 'deviceBound',
  Synced: 'synced',
  Unavailable: 'unavailable',
} as const;
export type PasskeyBackupStatus =
  (typeof PasskeyBackupStatus)[keyof typeof PasskeyBackupStatus];
