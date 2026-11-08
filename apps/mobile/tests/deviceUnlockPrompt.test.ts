import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';

function fixture() {
  let state = 'active';
  const listeners = new Set<(state: string) => void>();
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  return { prompt, listeners, emit(value: string) { if (value !== 'blur' && value !== 'focus') state = value; for (const listener of listeners) listener(value); } };
}

test('a protected result waits for foreground after the OS prompt', async () => {
  const f = fixture();
  let finish!: (value: string) => void;
  const operation = f.prompt.run(() => new Promise<string>(resolve => { finish = resolve; }));
  assert.equal(f.prompt.isActive(), true);
  f.emit('inactive');
  finish('protected result');
  let settled = false; void operation.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  f.emit('active');
  assert.equal(await operation, 'protected result');
  assert.equal(f.prompt.isActive(), false);
  assert.equal(f.listeners.size, 0);
});

test('Android blur withholds an available credential until focus returns', async () => {
  const f = fixture();
  let finish!: () => void;
  const operation = f.prompt.run(() => new Promise<void>(resolve => { finish = resolve; }));
  f.emit('blur'); finish();
  let settled = false; void operation.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  f.emit('focus'); f.emit('blur');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  f.emit('focus');
  await operation;
  assert.equal(settled, true);
  assert.equal(f.listeners.size, 0);
});

test('real background and explicit cancellation refuse a late protected result', async () => {
  for (const cancel of [(f: ReturnType<typeof fixture>) => f.emit('background'), (f: ReturnType<typeof fixture>) => f.prompt.cancel()]) {
    const f = fixture();
    let finish!: () => void;
    const result = f.prompt.run(() => new Promise<void>(resolve => { finish = resolve; }));
    f.emit('blur');
    cancel(f);
    assert.equal(f.prompt.isActive(), false);
    f.emit('active'); finish();
    await assert.rejects(result, /DEVICE_UNLOCK_UNAVAILABLE/);
    assert.equal(f.listeners.size, 0);
  }
});

test('a cancelled foreground wait drains and the next independent attempt can run', async () => {
  const f = fixture();
  const result = f.prompt.run(async () => { f.emit('inactive'); return 'old'; });
  await Promise.resolve();
  f.prompt.cancel();
  await assert.rejects(result, /DEVICE_UNLOCK_UNAVAILABLE/);
  f.emit('active');
  assert.equal(await f.prompt.run(async () => 'new'), 'new');
  assert.equal(f.listeners.size, 0);
});
