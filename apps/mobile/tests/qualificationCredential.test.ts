import assert from 'node:assert/strict';
import test from 'node:test';
import { createQualificationCredentialPort, QUALIFICATION_AUTHORIZATION_MODE } from '../qualification/fixture-credentials.ts';
const reference = { version: 1 as const, installationId: '11'.repeat(16), walletBindingId: '22'.repeat(32), pairFingerprint: '33'.repeat(32), enrollmentId: '44'.repeat(16) };
const owner = { signal: new AbortController().signal, purpose: 'secret-read' as const, assertCurrent() {} };
function store() { const values = new Map<string, string>(); return { values, async get(key: string) { return values.get(key) ?? null; }, async set(key: string, value: string) { values.set(key, value); }, async remove(key: string) { values.delete(key); } }; }
test('fixture credential adapter refuses production bundles and identifies its limited evidence', () => {
  assert.equal(QUALIFICATION_AUTHORIZATION_MODE, 'test-only-fixture');
  assert.throws(() => createQualificationCredentialPort(store(), 'com.paliwallet.mobile', 'com.paliwallet.mobile'));
  assert.throws(() => createQualificationCredentialPort(store(), 'com.paliwallet.qualification.physical.unknown', 'com.paliwallet.qualification'));
});
test('public fixture credentials persist across adapter restart without implying OS authorization', async () => {
  const saved = store(), first = createQualificationCredentialPort(saved, 'com.paliwallet.qualification', 'com.paliwallet.qualification');
  const secret = `Pali#1:${'ab'.repeat(32)}`;
  await first.stage(reference, { secret, publicKey: new Uint8Array(32).fill(7) }, owner);
  const next = createQualificationCredentialPort(saved, 'com.paliwallet.qualification', 'com.paliwallet.qualification');
  assert.deepEqual(await next.readPublic(reference, () => undefined), new Uint8Array(32).fill(7));
  await next.authorize(reference, owner); assert.equal(next.getSecretReads(), 0);
  assert.equal(await next.withSecret(reference, owner, async value => value === secret), true);
  next.refuseNextAuthorization(); await assert.rejects(next.authorize(reference, owner));
  await next.remove(reference); assert.equal(saved.values.size, 0);
});
