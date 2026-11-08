import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeLedgerHost } from '../src/hardware/ledgerHost.ts';
import type { NativeLedgerTransport } from '../src/hardware/ownedLedgerTransport.ts';

function fixture() {
  let disposed = false;
  let retired = false;
  let generation = 0;
  let proof: () => unknown = () => undefined;
  const transport = {
    host: {
      getStatus: () => ({ connected: !disposed }),
      async retire() {
        retired = true;
        const captured = generation;
        return () => { assert.equal(captured, generation); return proof(); };
      },
    },
    async dispose() {
      disposed = true;
      generation++;
    },
  } as unknown as NativeLedgerTransport;
  let current: NativeLedgerTransport | undefined = transport;
  return {
    host: createNativeLedgerHost(() => current),
    transport,
    retired: () => retired,
    disposed: () => disposed,
    replace() { current = undefined; },
    proof(value: () => unknown) { proof = value; },
  };
}

test('native retirement joins the shared host before disposing and returning proof', async () => {
  const f = fixture();
  const proof = await f.host.retire();
  assert(f.retired());
  assert(f.disposed());
  assert.doesNotThrow(proof);
});

test('a replaced native transport invalidates its completed retirement proof', async () => {
  const f = fixture();
  const proof = await f.host.retire();
  f.replace();
  assert.throws(proof, { code: 'HARDWARE_REQUEST_CANCELLED' });
});

test('native retirement preserves the shared pending-device proof', async () => {
  const f = fixture();
  const proof = await f.host.retire();
  f.proof(() => { throw new Error('Device reopened'); });
  assert.throws(proof, { code: 'HARDWARE_REQUEST_CANCELLED' });
});

test('native retirement rejects an asynchronous shared proof', async () => {
  const f = fixture();
  const proof = await f.host.retire();
  f.proof(async () => undefined);
  assert.throws(proof, { code: 'HARDWARE_REQUEST_CANCELLED' });
});

test('an empty native host proof is invalidated when a transport appears', async () => {
  const f = fixture();
  let current: NativeLedgerTransport | undefined;
  const host = createNativeLedgerHost(() => current);
  const proof = await host.retire();
  assert.doesNotThrow(proof);
  current = f.transport;
  assert.throws(proof, { code: 'HARDWARE_REQUEST_CANCELLED' });
});
