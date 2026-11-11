import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityReadConcurrency } from '../src/activity/readConcurrency.ts';

const deferred = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('queued Activity reads abort before I/O and revalidate the owner before admission', async () => {
  const queue = new ActivityReadConcurrency(), held = deferred();
  let calls = 0;
  const running = Array.from({ length: 4 }, () => queue.run(new AbortController().signal, () => {}, async () => { calls++; await held.promise; }));
  await tick(); assert.equal(calls, 4);
  const cancelled = new AbortController();
  const aborted = assert.rejects(queue.run(cancelled.signal, () => {}, async () => { calls++; }), /CANCELLED/);
  let current = true;
  const stale = assert.rejects(queue.run(new AbortController().signal, () => { if (!current) throw Error('Retired owner'); }, async () => { calls++; }), /Retired owner/);
  cancelled.abort(); current = false;
  await aborted; assert.equal(calls, 4);
  held.resolve(); await Promise.all([...running, stale]);
  assert.equal(calls, 4);
});

test('an aborted in-flight read keeps its slot until its delegate settles', async () => {
  const queue = new ActivityReadConcurrency(), held = Array.from({ length: 4 }, deferred);
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  let calls = 0;
  const running = held.map((gate, index) => queue.run(controllers[index]!.signal, () => {}, async () => { calls++; await gate.promise; }));
  const aborted = assert.rejects(running[0]!, /CANCELLED/);
  const waiting = queue.run(new AbortController().signal, () => {}, async () => { calls++; });
  await tick(); assert.equal(calls, 4);
  controllers[0]!.abort(); await tick(); assert.equal(calls, 4);
  held[0]!.resolve(); await aborted; await waiting;
  assert.equal(calls, 5);
  for (const gate of held.slice(1)) gate.resolve();
  await Promise.all(running.slice(1));
});
