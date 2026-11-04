import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

test('native storage policy stays in private non-backup paths and cannot overwrite an existing database', () => {
  const base = new URL('../modules/pali-wallet-storage/', import.meta.url);
  const ios = readFileSync(
    new URL('ios/PaliWalletStorageModule.swift', base),
    'utf8'
  );
  const android = readFileSync(
    new URL(
      'android/src/main/java/org/syscoin/pali/storage/PaliWalletStorageModule.kt',
      base
    ),
    'utf8'
  );
  assert.match(ios, /applicationSupportDirectory/);
  assert.match(ios, /FileProtectionType\.complete/);
  assert.match(ios, /isExcludedFromBackup = true/);
  assert.match(ios, /O_EXCL \| O_NOFOLLOW/);
  assert.match(android, /noBackupFilesDir/);
  assert.match(android, /OsConstants\.O_EXCL or OsConstants\.O_NOFOLLOW/);
  assert.match(android, /Os\.lstat/);
  for (const source of [ios, android]) {
    assert.doesNotMatch(
      source,
      /O_TRUNC|deleteRecursively|removeItem|\.delete\(/
    );
    assert.match(source, /wallet\.sqlite-wal/);
  }
});

test('native connection requires SQLCipher and full durability; web contains no native imports', () => {
  const source = readFileSync(
    new URL('../src/storage/native.native.ts', import.meta.url),
    'utf8'
  );
  const cipher = readFileSync(
    new URL('../src/storage/sqlCipher.ts', import.meta.url),
    'utf8'
  );
  const web = readFileSync(
    new URL('../src/storage/native.web.ts', import.meta.url),
    'utf8'
  );
  for (const expected of [
    'PRAGMA cipher_version',
    'PRAGMA cipher_memory_security = ON',
    'PRAGMA synchronous = FULL',
    'PRAGMA journal_mode = WAL',
  ])
    assert.ok(cipher.includes(expected));
  assert.ok(source.includes('WHEN_UNLOCKED_THIS_DEVICE_ONLY'));
  assert.ok(source.includes('useNewConnection: true'));
  assert.doesNotMatch(web, /expo-sqlite|expo-secure-store|requireNativeModule/);
});
