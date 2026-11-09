import assert from 'node:assert/strict';
import test from 'node:test';
import { withOwnedLedgerConnection } from '../src/hardware/withOwnedLedgerConnection.ts';
import type { NativeLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';

function fixture() {
  const signal = new AbortController(), drained = Promise.withResolvers<void>();
  let current: NativeLedgerTransport | undefined, retired = 0, disposed = 0, owner = true, connected = true;
  const original = { dispose: async () => { disposed++; await drained.promise; } } as NativeLedgerTransport;
  current = original;
  const ports = { signal: signal.signal, assertCurrent() { if (!owner) throw Error('CANCELLED'); }, connected: () => connected,
    current: () => current, retire: async () => { retired++; const prior = current; current = undefined; await prior?.dispose(); } };
  return { ports, signal, drained, retired: () => retired, disposed: () => disposed,
    replace() { current = {} as NativeLedgerTransport; }, disconnect() { connected = false; }, revoke() { owner = false; } };
}
for (const change of ['replace', 'disconnect', 'revoke'] as const) test(`Ledger operation never discloses after ${change}`, async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const pending = withOwnedLedgerConnection(f.ports, async check => { check(); entered.resolve(); await release.promise; return 'signature'; });
  const rejected = assert.rejects(pending, /CANCELLED/);
  await entered.promise; f[change](); release.resolve(); await rejected;
});
test('Ledger request abort waits for selected device retirement before settling', async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let settled = false;
  const pending = withOwnedLedgerConnection(f.ports, async () => { entered.resolve(); await release.promise; return 'signature'; });
  const rejected = assert.rejects(pending, /CANCELLED/).then(() => { settled = true; });
  await entered.promise; f.signal.abort(); release.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.retired(), 1); assert.equal(f.disposed(), 1); assert.equal(settled, false);
  f.drained.resolve(); await rejected;
});
test('an old Ledger request abort drains its captured device and cannot retire its replacement', async () => {
  const f = fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const pending = withOwnedLedgerConnection(f.ports, async () => { entered.resolve(); await release.promise; return 'signature'; });
  const rejected = assert.rejects(pending, /CANCELLED/);
  await entered.promise; f.replace(); f.signal.abort(); release.resolve(); f.drained.resolve(); await rejected;
  assert.equal(f.retired(), 0); assert.equal(f.disposed(), 1);
});
