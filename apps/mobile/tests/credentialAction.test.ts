import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeCredentialAction } from '../src/custody/credentialAction.ts';

function fixture() {
  const controller = new AbortController();
  let current = true, reads = 0;
  const guard = () => { if (!current) throw Error('CANCELLED'); };
  const action = new NativeCredentialAction(guard);
  const owner = { signal: controller.signal, assertCurrent: guard, purpose: 'transaction' as const };
  const read = async <T>(consume: (value: string) => Promise<T>) => { reads++; return consume('public test fixture'); };
  return { action, owner, read, controller, retire: () => { current = false; }, reads: () => reads };
}

test('two sequential private steps share one actual read only inside one live action', async () => {
  const f = fixture();
  try {
    assert.equal(await f.action.withSecret(f.owner, f.read, async value => value.length), 19);
    assert.equal(await f.action.withSecret(f.owner, f.read, async value => value.length), 19);
    assert.equal(f.reads(), 1);
  } finally { f.action.dispose(); }
  await assert.rejects(f.action.withSecret(f.owner, f.read, async () => true), /CANCELLED/);
  assert.equal(f.reads(), 1);
  const next = fixture();
  await next.action.withSecret(next.owner, next.read, async () => true);
  assert.equal(next.reads(), 1);
  next.action.dispose();
});

test('handoff clearing requires a fresh protected read before any later private step', async () => {
  const f = fixture();
  await f.action.withSecret(f.owner, f.read, async () => true);
  f.action.clear();
  await f.action.withSecret(f.owner, f.read, async () => true);
  assert.equal(f.reads(), 2);
  f.action.dispose();
});

test('abort and expired owner cannot reuse a captured credential', async () => {
  for (const retire of ['abort', 'expiry'] as const) {
    const f = fixture();
    await f.action.withSecret(f.owner, f.read, async () => true);
    if (retire === 'abort') f.controller.abort(); else f.retire();
    await assert.rejects(f.action.withSecret(f.owner, f.read, async () => true), /CANCELLED/);
    assert.equal(f.reads(), 1);
    f.action.dispose();
  }
});

test('a different owner signal never borrows the earlier credential', async () => {
  const f = fixture();
  await f.action.withSecret(f.owner, f.read, async () => true);
  const other = new AbortController();
  await f.action.withSecret({ ...f.owner, signal: other.signal }, f.read, async () => true);
  assert.equal(f.reads(), 2);
  f.action.dispose();
});

test('handoff during a pending read discards the late secret and concurrent work cannot cause a second prompt', async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  const pending = f.action.withSecret(f.owner, async consume => { await gate.promise; return consume('public late fixture'); }, async () => true);
  await assert.rejects(f.action.withSecret(f.owner, f.read, async () => true), /BUSY/);
  f.action.clear(); gate.resolve();
  await assert.rejects(pending, /CANCELLED/);
  await f.action.withSecret(f.owner, f.read, async () => true);
  assert.equal(f.reads(), 1);
  f.action.dispose();
});
