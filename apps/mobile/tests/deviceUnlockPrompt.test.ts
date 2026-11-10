import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceUnlockPrompt } from '../src/platform/deviceUnlockPrompt.ts';

function fixture() {
  let state = 'active';
  const listeners = new Set<(state: string) => void>();
  const prompt = new DeviceUnlockPrompt({ state: () => state, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  return { prompt, listeners, emit(value: string) { if (value !== 'blur' && value !== 'focus') state = value; for (const listener of listeners) listener(value); } };
}

test('a protected result returned before foreground is discarded without waiting', async () => {
  const f = fixture();
  let finish!: (value: string) => void;
  const operation = f.prompt.run(() => new Promise<string>(resolve => { finish = resolve; }));
  assert.equal(f.prompt.isActive(), true);
  f.emit('inactive');
  finish('protected result');
  await assert.rejects(operation, /DEVICE_UNLOCK_UNAVAILABLE/);
  f.emit('active');
  assert.equal(f.prompt.isActive(), false);
  assert.equal(f.listeners.size, 0);
});

test('Android blur discards and clears an available credential instead of retaining it', async () => {
  const f = fixture();
  let finish!: (result: Uint8Array) => void;
  const bytes = new Uint8Array([1, 2, 3]);
  const operation = f.prompt.run(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  f.emit('blur'); finish(bytes);
  await assert.rejects(operation, /DEVICE_UNLOCK_UNAVAILABLE/);
  assert.deepEqual([...bytes], [0, 0, 0]);
  f.emit('focus');
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

test('cancellation drains the native operation before a new independent attempt can run', async () => {
  const f = fixture();
  let finish!: (result: string) => void;
  const result = f.prompt.run(() => new Promise<string>(resolve => { finish = resolve; }));
  f.prompt.cancel();
  await assert.rejects(f.prompt.run(async () => 'too early'), /DEVICE_UNLOCK_UNAVAILABLE/);
  finish('old');
  await assert.rejects(result, /DEVICE_UNLOCK_UNAVAILABLE/);
  f.emit('active');
  assert.equal(await f.prompt.run(async () => 'new'), 'new');
  assert.equal(f.listeners.size, 0);
});
