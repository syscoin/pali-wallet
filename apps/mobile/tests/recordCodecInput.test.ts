import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotRecordEncryption, snapshotRecordDecryption } from '../src/custody/recordCodecInput.ts';

const domain = 'org.syscoin.pali.evm.signed.root.v1';
test('record lease snapshots domain and plaintext before asynchronous authentication', () => {
  const source = { domain, recordId: 'manifest', plaintext: new Uint8Array([1, 2, 3]) };
  const captured = snapshotRecordEncryption(source, [domain]);
  source.domain = 'org.syscoin.pali.privacy.notes.v1'; source.plaintext.fill(9);
  assert.equal(captured.domain, domain); assert.deepEqual([...captured.plaintext], [1, 2, 3]);
  assert.throws(() => snapshotRecordEncryption(source, [domain]), /INVALID_INPUT/);
});
test('record lease refuses accessors before reading secrets', () => {
  let reads = 0;
  const source = { get domain() { reads++; return domain; }, recordId: 'manifest', plaintext: new Uint8Array() };
  assert.throws(() => snapshotRecordEncryption(source, [domain]), /INVALID_INPUT/); assert.equal(reads, 0);
});
test('record lease captures the whole matching envelope and rejects domain substitution', () => {
  const source = { domain, recordId: 'manifest', envelope: { version: 1 as const, domain, recordId: 'manifest', profileId: '0x' + 'ab'.repeat(32), nonce: 'public-nonce', ciphertext: 'public-ciphertext' } };
  const captured = snapshotRecordDecryption(source, [domain]);
  source.envelope.domain = 'private-note'; source.envelope.ciphertext = 'changed';
  assert.equal(captured.envelope.domain, domain); assert.equal(captured.envelope.ciphertext, 'public-ciphertext');
  assert.throws(() => snapshotRecordDecryption(source, [domain]), /INVALID_INPUT/);
});
