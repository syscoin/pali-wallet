import { NOTE_BACKUP_MAX_FILE_BYTES } from '../../wallet/noteBackup';

import {
  decodeNoteBackupFile,
  encodeNoteBackupFile,
  NOTE_BACKUP_FILE_LIMIT,
  NOTE_BACKUP_WIRE_LIMIT,
} from './noteBackupWire';

it('matches the reviewed codec limit and round-trips every padding case', () => {
  expect(NOTE_BACKUP_FILE_LIMIT).toBe(NOTE_BACKUP_MAX_FILE_BYTES);
  for (const size of [
    1,
    2,
    3,
    12_287,
    12_288,
    12_289,
    NOTE_BACKUP_FILE_LIMIT,
  ]) {
    const file = Uint8Array.from({ length: size }, (_, index) => index % 256);
    const encoded = encodeNoteBackupFile(file);
    expect(encoded.length).toBeLessThanOrEqual(NOTE_BACKUP_WIRE_LIMIT);
    expect(
      Buffer.from(decodeNoteBackupFile(encoded)).equals(Buffer.from(file))
    ).toBe(true);
  }
});

it.each([
  '',
  'AQ',
  'AQ===',
  'A===',
  'AR==',
  'AAF=',
  'AQ==\n',
  ' AQ==',
  '-Q==',
  '_Q==',
  '=',
  '====',
])('rejects malformed and noncanonical base64 %j', (value) => {
  expect(() => decodeNoteBackupFile(value)).toThrow('BACKUP_INVALID_FORMAT');
});

it('rejects oversized input before invoking the decoder', () => {
  const decoder = jest.spyOn(globalThis, 'atob');
  expect(() =>
    decodeNoteBackupFile('A'.repeat(NOTE_BACKUP_WIRE_LIMIT + 4))
  ).toThrow('BACKUP_INVALID_FORMAT');
  // The longest base64 envelope could represent one byte beyond the file cap.
  expect(() =>
    decodeNoteBackupFile('A'.repeat(NOTE_BACKUP_WIRE_LIMIT))
  ).toThrow('BACKUP_INVALID_FORMAT');
  expect(decoder).not.toHaveBeenCalled();
  decoder.mockRestore();
});

it('does not coerce unknown input or read object properties', () => {
  const toString = jest.fn(() => 'AQ==');
  expect(() => decodeNoteBackupFile({ toString })).toThrow(
    'BACKUP_INVALID_FORMAT'
  );
  expect(toString).not.toHaveBeenCalled();
});
