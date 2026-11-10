import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeNoteExport } from '../src/custody/nativeNoteExport.ts';
import type { NativeNoteBackupRuntime } from '../src/custody/noteBackupRuntime.ts';
import { NoteBackupServiceError } from '../../../source/wallet/noteBackupService.ts';

const token = '2cecc777-f944-41c9-9fc9-691be120eb59';
const ok = () => undefined;
const unused = () => assert.fail('unexpected runtime call');

function runtime() {
  const encrypted = new Uint8Array([4, 5, 6]);
  const cancelled: string[] = [];
  const receipts: Uint8Array[] = [];
  const notes: NativeNoteBackupRuntime = {
    begin: () => 'export',
    cancel: id => cancelled.push(id),
    prepareImport: unused,
    commitImport: unused,
    readCommitReceipt: unused,
    async exportEncrypted(id) { return { id, bytes: encrypted, createdAt: 100, noteCount: 2 }; },
    async verifyExport(id, bytes, password) {
      receipts.push(bytes as Uint8Array);
      if (password !== 'right') throw new NoteBackupServiceError('BACKUP_OPEN_FAILED');
      return { id, createdAt: 100, noteCount: 2, verified: true };
    },
  };
  return { notes, encrypted, cancelled, receipts };
}

test('writes once only after explicit save, and verification reuses readback without another write', async () => {
  const { notes, encrypted, receipts } = runtime();
  let writes = 0;
  let readback!: Uint8Array;
  const flow = createNativeNoteExport(async () => notes, {
    async write(id, bytes) {
      assert.equal(id, token);
      writes++;
      readback = bytes.slice();
      return readback;
    },
    async revoke() {},
  });
  flow.select(token, ok, unused);
  assert.deepEqual(await flow.prepare('backup', ok), { noteCount: 2, createdAt: 100 });
  assert.equal(writes, 0);
  await flow.save();
  assert.equal(writes, 1);
  assert(encrypted.every(value => value === 0));
  await assert.rejects(flow.save(), { code: 'BACKUP_STALE' });
  await assert.rejects(flow.verify('wrong'), { code: 'BACKUP_OPEN_FAILED' });
  assert.deepEqual(await flow.verify('right'), { id: 'export', createdAt: 100, noteCount: 2, verified: true });
  assert.deepEqual(receipts, [readback, readback]);
  assert(readback.every(value => value === 0));
  assert.equal(writes, 1);
});

test('a changed wallet cannot save the prepared file even while the route owner is current', async () => {
  const { notes, encrypted } = runtime();
  let current = true;
  const flow = createNativeNoteExport(async () => notes, { write: unused, async revoke() {} });
  flow.select(token, ok, unused);
  await flow.prepare('backup', () => {
    if (!current) throw new NoteBackupServiceError('BACKUP_CANCELLED');
  });
  current = false;
  await assert.rejects(flow.save(), { code: 'BACKUP_CANCELLED' });
  flow.cancel();
  assert(encrypted.every(value => value === 0));
});

test('a write that completes after revocation cannot report success or be replayed', async () => {
  const { notes, encrypted } = runtime();
  let resolve!: (bytes: Uint8Array) => void;
  const held = new Promise<Uint8Array>(done => { resolve = done; });
  const revoked: string[] = [];
  const flow = createNativeNoteExport(async () => notes, {
    write: () => held,
    async revoke(id) { revoked.push(id); },
  });
  flow.select(token, ok, unused);
  await flow.prepare('backup', ok);
  const pending = flow.save();
  flow.cancel();
  assert.throws(() => flow.select(token, ok, unused), { code: 'BACKUP_BUSY' });
  const late = new Uint8Array([4, 5, 6]);
  resolve(late);
  await assert.rejects(pending, /FILE_WRITE_UNCONFIRMED/);
  assert(encrypted.every(value => value === 0) && late.every(value => value === 0));
  assert.deepEqual(revoked, [token]);
  await assert.rejects(flow.save(), { code: 'BACKUP_STALE' });
});
