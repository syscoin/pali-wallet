import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { NOTE_BACKUP_HEADER_BYTES, NOTE_BACKUP_MAX_FILE_BYTES } from '../../../../source/wallet/noteBackup.ts';

type NativeBytes = Uint8Array | ArrayBuffer;
type NativePicker = {
  pickEncryptedNoteBackup(): Promise<NativeBytes | null>;
  pickEncryptedNoteBackupDestination(): Promise<string | null>;
  writeEncryptedNoteBackup(token: string, bytes: Uint8Array): Promise<NativeBytes>;
  revokeEncryptedNoteBackupDestination(token: string): Promise<void>;
};
const picker = () => requireNativeModule<NativePicker>('PaliWalletStorage');
export const shouldLockWalletForNotePicker = () => Platform.OS === 'android';
const bytesView = (value: NativeBytes) => value instanceof ArrayBuffer ? new Uint8Array(value) : value;
const fileError = (cause: unknown) => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null;
  if (code === 'NOTE_BACKUP_FILE_INVALID' || code === 'NOTE_BACKUP_FILE_TOO_LARGE') return new Error('FILE_INVALID');
  if (code === 'NOTE_BACKUP_FILE_BUSY') return new Error('FILE_BUSY');
  if (code === 'NOTE_BACKUP_FILE_WRITE_UNCONFIRMED') return new Error('FILE_WRITE_UNCONFIRMED');
  return new Error('FILE_UNAVAILABLE');
};

/** The native bridge owns the picker and returns only a bounded encrypted file. */
export async function pickNoteBackupFile(): Promise<Uint8Array | null> {
  try {
    const result = await picker().pickEncryptedNoteBackup();
    return result === null ? null : bytesView(result);
  } catch (cause) {
    throw fileError(cause);
  }
}

export async function pickNoteBackupDestination(): Promise<string | null> {
  try { return await picker().pickEncryptedNoteBackupDestination(); }
  catch (cause) { throw fileError(cause); }
}

export async function writeNoteBackupFile(token: string, bytes: Uint8Array): Promise<Uint8Array> {
  // Native codecs check framing and output identity again. Bound the input
  // here before Expo copies the trusted runtime ciphertext into native memory.
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < NOTE_BACKUP_HEADER_BYTES + 16 ||
      bytes.byteLength > NOTE_BACKUP_MAX_FILE_BYTES) throw new Error('FILE_INVALID');
  try { return bytesView(await picker().writeEncryptedNoteBackup(token, bytes)); }
  catch (cause) { throw fileError(cause); }
}

export async function revokeNoteBackupDestination(token: string): Promise<void> {
  try { await picker().revokeEncryptedNoteBackupDestination(token); }
  catch { /* The JS owner has already revoked the ticket; native also expires it. */ }
}
