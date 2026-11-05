import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { createNoteBackupFileIntake } from '../src/custody/noteBackupFileIntake.ts';
import { NoteBackupServiceError } from '../../../source/wallet/noteBackupService.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../source/wallet/noteBackup.vectors.json', import.meta.url), 'utf8'));
const bytes = () => new Uint8Array(Buffer.from(fixture.vectors[1].fileHex, 'hex'));
const ok = () => undefined;
const code = (value: string) => ({ name: 'NoteBackupServiceError', code: value });
const readyGuard = (valid: () => boolean) => () => {
  if (!valid()) throw new NoteBackupServiceError('BACKUP_CANCELLED');
};
const held = <T>() => {
  let finish!: (result: T) => void;
  const promise = new Promise<T>(resolve => { finish = resolve; });
  return { promise, finish };
};

test('only the encrypted file crosses picker lock, and a validated preview keeps the new session guard', async () => {
  const intake = createNoteBackupFileIntake();
  const native = held<Uint8Array>();
  let unlocked = true;
  let owner = true;
  const raw = bytes();
  const selecting = intake.select(() => native.promise, readyGuard(() => owner));
  unlocked = false;
  native.finish(raw);
  assert.equal(await selecting, true);
  assert.equal(intake.hasFile(), true);
  unlocked = true;
  let previewGuard!: () => void;
  assert.equal(await intake.open(readyGuard(() => unlocked), async (input, guard) => {
    assert.deepEqual(input, bytes());
    guard();
    previewGuard = guard;
    return 3;
  }), 3);
  assert.equal(intake.hasFile(), false);
  assert(raw.every(value => value === 0));
  previewGuard();
  owner = false;
  assert.throws(previewGuard, code('BACKUP_CANCELLED'));
});

test('a wrong backup password can retry the same file without another native pick', async () => {
  const intake = createNoteBackupFileIntake();
  const raw = bytes();
  await intake.select(async () => raw, ok);
  await assert.rejects(intake.open(ok, async () => { throw new NoteBackupServiceError('BACKUP_OPEN_FAILED'); }), code('BACKUP_OPEN_FAILED'));
  assert.equal(intake.hasFile(), true);
  assert.deepEqual(raw, bytes());
  assert.equal(await intake.open(ok, async input => input.byteLength), bytes().byteLength);
  await assert.rejects(intake.open(ok, async () => assert.fail('file reused')), code('BACKUP_STALE'));
});

test('revocation during decrypt drops the result and file even if failure looks retryable', async () => {
  const intake = createNoteBackupFileIntake();
  const raw = bytes();
  const job = held<void>();
  let unlocked = true;
  await intake.select(async () => raw, ok);
  const opening = intake.open(readyGuard(() => unlocked), async () => {
    await job.promise;
    throw new NoteBackupServiceError('BACKUP_OPEN_FAILED');
  });
  unlocked = false;
  job.finish(undefined);
  await assert.rejects(opening, code('BACKUP_CANCELLED'));
  assert.equal(intake.hasFile(), false);
  assert(raw.every(value => value === 0));
});

test('cancelling a native picker prevents a second launch until the old result drains', async () => {
  const intake = createNoteBackupFileIntake();
  const native = held<Uint8Array>();
  const raw = bytes();
  const selecting = intake.select(() => native.promise, ok);
  intake.cancel();
  await assert.rejects(intake.select(async () => assert.fail('second picker launched'), ok), code('BACKUP_BUSY'));
  native.finish(raw);
  await assert.rejects(selecting, code('BACKUP_CANCELLED'));
  assert(raw.every(value => value === 0));
  assert.equal(await intake.select(async () => null, ok), false);
});

test('shared envelope admission and monotonic expiry reject without preparing a preview', async () => {
  let elapsed = 0;
  let expire!: () => void;
  const intake = createNoteBackupFileIntake({
    now: () => elapsed,
    schedule(onExpiry) { expire = onExpiry; return ok; },
  });
  const malformed = bytes();
  malformed[9] = malformed[9]! ^ 0xff;
  await assert.rejects(intake.select(async () => malformed, ok), code('BACKUP_INVALID_FORMAT'));
  assert(malformed.every(value => value === 0));
  const raw = bytes();
  let notifications = 0;
  await intake.select(async () => raw, ok, () => { notifications++; });
  elapsed = 300_000;
  await assert.rejects(intake.open(ok, async () => assert.fail('expired preview')), code('BACKUP_STALE'));
  expire();
  assert.equal(notifications, 1);
  assert(raw.every(value => value === 0));
});

test('an asynchronous owner guard is refused before a native call', async () => {
  const intake = createNoteBackupFileIntake();
  await assert.rejects(intake.select(async () => assert.fail('picker started'), async () => {
    throw Error('synthetic rejected guard');
  }), code('BACKUP_CANCELLED'));
  assert.equal(intake.hasFile(), false);
});
