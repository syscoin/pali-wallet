import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePrivacyLifecycle } from '../src/privacy/privacyLifecycle.ts';
const deferred = <T = void>() => Promise.withResolvers<T>();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const current = () => undefined;

test('privacy retirement owns a held opening, aborts first and waits for ignored-abort creation and cleanup', async () => {
  const life = createNativePrivacyLifecycle(), source = new AbortController(), entered = deferred(), value = deferred<{ id: string }>(), close = deferred();
  let aborted = false, disposed = 0;
  const pending = life.open(source.signal, current, async signal => { signal.addEventListener('abort', () => { aborted = true; }); entered.resolve(); return value.promise; }, async resource => { assert.equal(resource.id, 'old'); disposed++; await close.promise; }, value => value);
  const rejected = assert.rejects(pending, /privacy_cancelled/);
  await entered.promise;
  const retiring = life.invalidate(); let settled = false; void retiring.then(() => { settled = true; });
  assert.equal(aborted, true); assert.throws(life.assertAvailable, /privacy_busy/);
  value.resolve({ id: 'old' }); await tick(); assert.equal(disposed, 1); assert.equal(settled, false);
  close.resolve(); await rejected; await retiring;
  life.assertAvailable();
});

test('privacy cleanup failure remains an admission barrier after cancellation acknowledgement', async () => {
  const life = createNativePrivacyLifecycle(), source = new AbortController();
  await life.open(source.signal, current, async () => ({}), async () => { throw Error('native cleanup failed'); }, value => value);
  source.abort(); await assert.rejects(life.invalidate(), /native cleanup failed/);
  assert.throws(life.assertAvailable, /privacy_cleanup_failed/);
});

test('reentrant invalidation is one barrier and normally closed routes release their bounded owner slot', async () => {
  const life = createNativePrivacyLifecycle(); let joined: Promise<void> | undefined;
  const source = new AbortController();
  await life.open(source.signal, current, async signal => { signal.addEventListener('abort', () => { joined = life.invalidate(); }); return {}; }, async () => undefined, value => value);
  const retired = life.invalidate(); assert.equal(joined, retired); await retired;
  for (let i = 0; i < 20; i++) {
    const next = new AbortController();
    await life.open(next.signal, current, async () => ({}), async () => undefined, value => value);
    next.abort(); await tick();
  }
  life.assertAvailable(); await life.invalidate();
});

test('explicit public disposal releases bounded owner slots and invokes actual cleanup exactly once', async () => {
  const life = createNativePrivacyLifecycle(); let disposed = 0;
  for (let index = 0; index < 20; index++) {
    const source = new AbortController();
    const view = await life.open(source.signal, current, async () => ({ index }), async () => { disposed++; },
      (value, close) => ({ index: value.index, close }));
    await view.close(); source.abort(); await view.close();
  }
  assert.equal(disposed, 20); life.assertAvailable(); await life.invalidate(); assert.equal(disposed, 20);
});
