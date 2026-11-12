import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionPresentation } from '../src/platform/permissionPresentation.ts';

function fixture() {
  let state = 'active';
  const listeners = new Set<(state: string) => void>();
  const presentation = createPermissionPresentation({ current: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  return { presentation, move(next: string) { state = next; for (const listener of listeners) listener(state); }, listeners };
}
test('expected inactive permission dialog waits for active and releases its exemption', async () => {
  const f = fixture(); let finish!: () => void;
  const pending = f.presentation.run(async () => { f.move('inactive'); await new Promise<void>(resolve => { finish = resolve; }); return 'granted'; });
  assert.equal(f.presentation.isActive(), true); finish();
  await Promise.resolve(); f.move('active');
  assert.equal(await pending, 'granted'); assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});
test('real backgrounding cannot be treated as an expected permission dialog', async () => {
  const f = fixture();
  await assert.rejects(f.presentation.run(async () => { f.move('background'); f.move('active'); return 'granted'; }), /interrupted/);
  assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});
test('failed or concurrent requests cannot retain the exemption', async () => {
  const f = fixture(); let finish!: () => void;
  const pending = f.presentation.run(() => new Promise<void>(resolve => { finish = resolve; }));
  await assert.rejects(f.presentation.run(async () => undefined), /unavailable/);
  finish(); await pending;
  await assert.rejects(f.presentation.run(async () => { throw Error('OS failure'); }), /OS failure/);
  assert.equal(f.presentation.isActive(), false);
});
test('a failed lifecycle subscription cannot retain the exemption', async () => {
  const presentation = createPermissionPresentation({ current: () => 'active',
    subscribe() { throw Error('subscription failed'); } });
  await assert.rejects(presentation.run(async () => 'granted'), /subscription failed/);
  assert.equal(presentation.isActive(), false);
});

test('a permission result cannot retire its marker before the queued inactive and active events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let resolved = false;
  const pending = f.presentation.run(async () => 'granted').then(value => { resolved = true; return value; });
  await Promise.resolve();
  assert.equal(f.presentation.isActive(), true);
  f.move('inactive'); await Promise.resolve();
  assert.equal(f.presentation.isActive(), true); assert.equal(resolved, false);
  f.move('active');
  assert.equal(await pending, 'granted');
  assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});


test('an observed inactive/active cycle adds no return delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const pending = f.presentation.run(async () => { f.move('inactive'); f.move('active'); return 'granted'; });
  assert.equal(await pending, 'granted');
  assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});

test('no lifecycle event completes after one bounded wait that repeated active events cannot extend', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let resolved = false;
  const pending = f.presentation.run(async () => 'granted').then(value => { resolved = true; return value; });
  await Promise.resolve();
  t.mock.timers.tick(750); f.move('active'); await Promise.resolve();
  assert.equal(resolved, false); assert.equal(f.presentation.isActive(), true);
  t.mock.timers.tick(749); f.move('active'); await Promise.resolve();
  assert.equal(resolved, false);
  t.mock.timers.tick(1); assert.equal(await pending, 'granted');
  assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});

test('late background retires the marker and rejects before the return deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const pending = f.presentation.run(async () => 'granted');
  const refused = assert.rejects(pending, /interrupted/); await Promise.resolve();
  f.move('background'); assert.equal(f.presentation.isActive(), false);
  await refused; assert.equal(f.listeners.size, 0);
});

test('a late inactive event without a foreground return rejects at the original deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const pending = f.presentation.run(async () => 'granted');
  const refused = assert.rejects(pending, /interrupted/); await Promise.resolve();
  t.mock.timers.tick(1000); f.move('inactive'); t.mock.timers.tick(500);
  await refused; assert.equal(f.presentation.isActive(), false); assert.equal(f.listeners.size, 0);
});
