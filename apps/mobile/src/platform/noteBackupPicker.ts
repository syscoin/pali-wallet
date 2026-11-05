export const shouldLockWalletForNotePicker = () => false;

export async function pickNoteBackupFile(): Promise<Uint8Array | null> {
  throw new Error('FILE_UNAVAILABLE');
}

export async function pickNoteBackupDestination(): Promise<string | null> {
  throw new Error('FILE_UNAVAILABLE');
}

export async function writeNoteBackupFile(_token: string, _bytes: Uint8Array): Promise<Uint8Array> {
  throw new Error('FILE_UNAVAILABLE');
}

export async function revokeNoteBackupDestination(_token: string): Promise<void> {}
