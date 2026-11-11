import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationPermissionPresentation } from '../src/notifications/permissionPresentation.ts';

function fixture() {
  let state = 'active';
  const listeners = new Set<(state: string) => void>();
  const presentation = createNotificationPermissionPresentation({ current: () => state,
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
  const presentation = createNotificationPermissionPresentation({ current: () => 'active',
    subscribe() { throw Error('subscription failed'); } });
  await assert.rejects(presentation.run(async () => 'granted'), /subscription failed/);
  assert.equal(presentation.isActive(), false);
});
