import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateVaultSession, readPrivateVaultBundle, type IPrivateVaultSession } from '../../../source/wallet/privateVaultInspection.ts';

test('private vault captures exact operation before awaiting and an old read cannot adopt its successor', async () => {
  let owner = {}, captures = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = owner;
  const profile = '0x' + 'ab'.repeat(32);
  const base: IPrivateVaultSession = {
    generation: 1, assertCurrent() {},
    keyring: { async getPrivateRecordProfileId() { throw Error('uncaptured'); }, async encryptPrivateRecord() { throw Error('unused'); }, async decryptPrivateRecord() { throw Error('unused'); } },
    captureOperation(guard) {
      captures++; const captured = owner;
      const check = () => { guard(); if (owner !== captured) throw Error('operation changed'); };
      return createPrivateVaultSession({ generation: 1, assertCurrent: check, keyring: {
        async getPrivateRecordProfileId() {
          check(); if (captured === first) { entered(); await blocked; } check(); return profile;
        },
        async encryptPrivateRecord() { throw Error('unused'); }, async decryptPrivateRecord() { throw Error('unused'); },
      } });
    },
  };
  const old = readPrivateVaultBundle(null, base); void old.catch(() => {}); await started;
  owner = {};
  const next = await readPrivateVaultBundle(null, base);
  assert.equal(next.manifest.notes.length, 0);
  release(); await assert.rejects(old, /operation changed/);
  assert.equal(captures, 2, 'the resumed old read never recaptures the current operation');
});

test('session factory composes operation guards instead of replacing original lifetime', () => {
  let live = true, operation = true;
  const session = createPrivateVaultSession({ generation: 1, assertCurrent() { if (!live) throw Error('retired'); }, keyring: {
    async getPrivateRecordProfileId() { return '0x' + 'ab'.repeat(32); }, async encryptPrivateRecord() { throw Error('unused'); }, async decryptPrivateRecord() { throw Error('unused'); },
  } });
  const captured = session.captureOperation(() => { if (!operation) throw Error('cancelled'); });
  operation = false; assert.throws(captured.assertCurrent, /cancelled/);
  operation = true; live = false; assert.throws(captured.assertCurrent, /retired/);
});
