import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { createNativeNoteRestore } from '../src/custody/nativeNoteRestore.ts';
import type { NativeNoteBackupRuntime } from '../src/custody/noteBackupRuntime.ts';
import { NoteBackupServiceError } from '../../../source/wallet/noteBackupService.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../source/wallet/noteBackup.vectors.json', import.meta.url), 'utf8'));
const choose = async () => new Uint8Array(Buffer.from(fixture.vectors[1].fileHex, 'hex'));
const ok = () => undefined;
const unavailable = () => assert.fail('unexpected runtime operation');

test('restore expiry retires the same preview and tells the screen to clear its password', { timeout: 1000 }, async () => {
  const cancelled: string[] = [];
  const runtime: NativeNoteBackupRuntime = {
    begin: () => 'review',
    cancel: id => cancelled.push(id),
    async prepareImport(id) { return { id, added: 1, duplicates: 2, guarded: 1, expiresAt: performance.now() + 20 }; },
    commitImport: unavailable,
    readCommitReceipt: unavailable,
    exportEncrypted: unavailable,
    verifyExport: unavailable,
  };
  const restore = createNativeNoteRestore(async () => runtime);
  let expired!: () => void;
  const cleared = new Promise<void>(resolve => { expired = resolve; });
  await restore.select(choose, ok);
  const preview = await restore.prepare('test backup password', ok, expired);
  await cleared;
  await assert.rejects(restore.restore(preview.id, 'never submitted'), { code: 'BACKUP_STALE' });
  assert.deepEqual(cancelled, [preview.id]);
});

test('a stale route cannot publish a late receipt or reuse the review', async () => {
  const cancelled: string[] = [];
  let done!: (result: Awaited<ReturnType<NativeNoteBackupRuntime['commitImport']>>) => void;
  const held = new Promise<Awaited<ReturnType<NativeNoteBackupRuntime['commitImport']>>>(resolve => { done = resolve; });
  const runtime: NativeNoteBackupRuntime = {
    begin: () => 'review',
    cancel: id => cancelled.push(id),
    async prepareImport(id) { return { id, added: 1, duplicates: 0, guarded: 1, expiresAt: performance.now() + 30_000 }; },
    commitImport: () => held,
    readCommitReceipt: unavailable,
    exportEncrypted: unavailable,
    verifyExport: unavailable,
  };
  const restore = createNativeNoteRestore(async () => runtime);
  await restore.select(choose, ok);
  const { id } = await restore.prepare('test backup password', ok, unavailable);
  const pending = restore.restore(id, 'test wallet password');
  restore.cancel();
  done({ id, added: 1, duplicates: 0, guarded: 1, confirmed: true });
  await assert.rejects(pending, error => error instanceof NoteBackupServiceError && error.code === 'BACKUP_CANCELLED');
  await assert.rejects(restore.restore(id, 'new password'), { code: 'BACKUP_STALE' });
  assert.deepEqual(cancelled, [id]);
});
