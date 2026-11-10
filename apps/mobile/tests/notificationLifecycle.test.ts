import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startNotificationLifecycle } from '../src/notifications/lifecycle.ts';
import type { NotificationSnapshot } from '../src/notifications/types.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test('foreground lifecycle loads without prompting, polls only active enrollment and aborts on background', async () => {
  let state = 'active', loads = 0, stoppedTimers = 0;
  let interval: (() => void) | undefined, changed: ((state: string) => void) | undefined, updated: (() => void) | undefined;
  const fireInterval = () => interval?.();
  const runs: AbortSignal[] = [];
  let snapshot: NotificationSnapshot = { status: 'ready', enabledScopeIds: [], permission: 'granted', background: 'available', pendingEventId: null, lastRunAt: null };
  const stop = startNotificationLifecycle({ load: async () => { loads++; }, run: async (signal) => { runs.push(signal); },
    getSnapshot: () => snapshot, subscribe: (listener) => { updated = listener; return () => { updated = undefined; }; } }, {
    current: () => state, subscribe: (listener) => { changed = listener; return () => { changed = undefined; }; },
    everyMinute: (listener) => { interval = listener; return () => { interval = undefined; stoppedTimers++; }; },
  });
  await tick(); assert.equal(loads, 1); assert.equal(runs.length, 0); assert.equal(interval, undefined);
  snapshot = { ...snapshot, enabledScopeIds: ['one'] }; updated?.(); fireInterval(); await tick(); assert.equal(runs.length, 1);
  state = 'background'; changed?.(state); assert.equal(runs[0]?.aborted, true); assert.equal(interval, undefined);
  state = 'active'; changed?.(state); await tick(); assert.equal(runs.length, 2); assert.ok(interval);
  stop(); assert.equal(runs[1]?.aborted, true); assert.equal(interval, undefined); assert.equal(changed, undefined); assert.equal(updated, undefined); assert.equal(stoppedTimers, 2);
});

test('stopping before load completes does not start background work', async () => {
  let finish!: () => void, polls = 0, timers = 0;
  const stop = startNotificationLifecycle({ load: () => new Promise<void>((resolve) => { finish = resolve; }),
    run: async () => { polls++; }, getSnapshot: () => ({ status: 'ready', enabledScopeIds: ['one'], permission: 'granted', background: 'available', pendingEventId: null, lastRunAt: null }),
    subscribe: () => () => undefined }, { current: () => 'active', subscribe: () => () => undefined,
    everyMinute: () => { timers++; return () => undefined; } });
  stop(); finish(); await tick(); assert.equal(polls, 0); assert.equal(timers, 0);
});
