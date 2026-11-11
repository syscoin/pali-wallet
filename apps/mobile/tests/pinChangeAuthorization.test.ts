import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { CustodyRuntime } from '../src/custody/types.ts';

const PIN = '123456';
const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
async function fixture(confirmed = true) {
  const refusals = new WeakSet<object>();
  const verified: string[] = [];
  let failure: Error | undefined, held: Promise<void> | undefined, locks = 0;
  const runtime: CustodyRuntime = {
    security: {
      isAuthenticationRefusal: error => !!error && typeof error === 'object' && refusals.has(error),
      async authenticationStatus() { return { pinConfigured: true, biometricsAvailable: false, biometricsEnabled: false }; },
      async authenticateOperation(credential, check) {
        assert.equal(credential.method, 'pin');
        if (credential.method !== 'pin') throw Error('Unexpected credential');
        check(); verified.push(credential.pin); await held; check();
        if (failure) throw failure;
      },
      async changePin() { assert.fail('Current-PIN validation must not rotate the PIN'); },
      async reauthenticateIdlePolicy() { assert.fail('Current-PIN validation must not change idle policy'); },
    },
    session: {
      async createWallet() { assert.fail('Unexpected creation'); },
      async importWallet() { assert.fail('Unexpected import'); },
      async unlock() { return { authenticated: true }; },
      async readSelectedAddress() { return ADDRESS; },
      async lock() { locks++; },
    },
    storage: {
      async readState() { return { presence: 'existing', backup: confirmed ? 'confirmed' : 'unconfirmed' }; },
      async close() {},
    },
  };
  const authority = new NativeCustodyAuthority({ async open() { return runtime; } });
  await authority.initialize(); await authority.unlock(PIN);
  locks = 0;
  return {
    authority, verified, get locks() { return locks; },
    fail(message: string, branded = false) {
      failure = Error(message); if (branded) refusals.add(failure);
    },
    hold(promise: Promise<void>) { held = promise; },
  };
}

test('current-PIN verification invokes only the existing public authentication operation', async () => {
  const f = await fixture(), before = f.authority.getSnapshot();
  try {
    await f.authority.verifyPin(PIN, () => undefined);
    assert.deepEqual(f.verified, [PIN]);
    assert.equal(f.authority.getSnapshot(), before);
    assert.equal(f.locks, 0);
  } finally { await f.authority.dispose(); }
});

test('current-PIN verification remains available before backup confirmation', async () => {
  const f = await fixture(false), before = f.authority.getSnapshot();
  try {
    assert.equal(before.phase, 'backup-required');
    await f.authority.verifyPin(PIN, () => undefined);
    assert.equal(f.authority.getSnapshot(), before);
    assert.equal(f.locks, 0);
  } finally { await f.authority.dispose(); }
});

for (const refusal of ['INVALID_CREDENTIAL', 'AUTH_THROTTLED']) test(`current-PIN ${refusal} preserves the ready owner only for a branded refusal`, async () => {
  const f = await fixture(), before = f.authority.getSnapshot();
  try {
    f.fail(refusal, true);
    await assert.rejects(f.authority.verifyPin('000000', () => undefined), { code: refusal });
    assert.equal(f.authority.getSnapshot(), before);
    assert.equal(f.locks, 0);
  } finally { await f.authority.dispose(); }
});

for (const failure of ['INVALID_CREDENTIAL', 'PIN_UNAVAILABLE']) test(`unbranded ${failure} during current-PIN verification retires the owner`, async () => {
  const f = await fixture();
  try {
    f.fail(failure);
    await assert.rejects(f.authority.verifyPin(PIN, () => undefined), { code: 'OPERATION_FAILED' });
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert(f.locks > 0);
  } finally { await f.authority.dispose(); }
});

test('a held current-PIN check excludes duplicates and rejects completion after lock', async () => {
  const f = await fixture(), gate = Promise.withResolvers<void>();
  try {
    f.hold(gate.promise);
    const pending = f.authority.verifyPin(PIN, () => undefined);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await assert.rejects(f.authority.verifyPin(PIN, () => undefined), { code: 'BUSY' });
    f.authority.lock(); gate.resolve(); await rejected;
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert.deepEqual(f.verified, [PIN]);
  } finally { gate.resolve(); await f.authority.dispose(); }
});

test('a rejected owner guard prevents current-PIN verification and retires its session', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.authority.verifyPin(PIN, () => { throw Error('CANCELLED'); }), { code: 'OPERATION_FAILED' });
    assert.deepEqual(f.verified, []);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert(f.locks > 0);
  } finally { await f.authority.dispose(); }
});

test('owner revocation at the refusal boundary retires the current-PIN session', async () => {
  const f = await fixture();
  let checks = 0;
  try {
    f.fail('INVALID_CREDENTIAL', true);
    await assert.rejects(f.authority.verifyPin('000000', () => {
      // Admission and both runtime guards pass; revocation wins when the
      // authority checks that it may preserve the session after a refusal.
      if (++checks === 4) throw Error('CANCELLED');
    }), { code: 'OPERATION_FAILED' });
    assert.equal(checks, 4);
    assert.equal(f.authority.getSnapshot().phase, 'locked');
    assert(f.locks > 0);
  } finally { await f.authority.dispose(); }
});
