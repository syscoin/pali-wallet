import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivacyServiceSettings } from '../../../source/shared/privacyServiceOrigin.ts';
import { createNativePrivacyControls } from '../src/privacy/privacyControls.ts';
import { createNativePrivacyLifecycle } from '../src/privacy/privacyLifecycle.ts';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  let value: unknown; const writes: string[] = [], life = createNativePrivacyLifecycle(), signal = new AbortController();
  const settings = createPrivacyServiceSettings({ async read() { return value; }, async write(_key, origin) { value = origin; writes.push(origin); } });
  const model = createNativePrivacyControls({ settings, signal: signal.signal, assertCurrent() {}, invalidate: life.invalidate,
    async openPool() { throw Error('No pool requested'); } });
  return { model, life, settings, signal, writes };
}
test('service change invalidates old source authority, then drains resources before writing the origin', async () => {
  const f = fixture(), source = new AbortController(), draining = Promise.withResolvers<void>();
  const before = await f.settings.capture();
  await f.life.open(source.signal, () => undefined, async () => ({}), () => draining.promise, value => value);
  const next = f.model.changeOrigin('https://private.example', before.origin);
  await tick(); assert.throws(before.assertCurrent, /privacy_service_changed/); assert.deepEqual(f.writes, []);
  draining.resolve(); assert.equal(await next, 'https://private.example'); assert.deepEqual(f.writes, ['https://private.example']);
});
test('settings refuse invalid origins and failed cleanup before any preference write', async () => {
  const f = fixture(), source = new AbortController(), origin = await f.model.getOrigin();
  await assert.rejects(f.model.changeOrigin('https://private.example/path', origin)); assert.deepEqual(f.writes, []);
  await f.life.open(source.signal, () => undefined, async () => ({}), async () => { throw Error('held cleanup failed'); }, value => value);
  await assert.rejects(f.model.changeOrigin('https://private.example', origin), /held cleanup failed/); assert.deepEqual(f.writes, []);
});
test('retired settings consent cannot commit after a held drain; clearing public data never writes the setting', async () => {
  const f = fixture(), source = new AbortController(), draining = Promise.withResolvers<void>();
  await f.life.open(source.signal, () => undefined, async () => ({}), () => draining.promise, value => value);
  const change = f.model.changeOrigin('https://private.example', await f.model.getOrigin()), rejected = assert.rejects(change, /privacy_cancelled/);
  await tick(); f.signal.abort(); draining.resolve(); await rejected; assert.deepEqual(f.writes, []);
  const next = fixture(); await next.model.clearPublicData(); assert.deepEqual(next.writes, []);
});
