import assert from 'node:assert/strict';
import test from 'node:test';
import { screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const preference = Promise.withResolvers<boolean>();
  const listeners = new Map<string, Set<(value: any) => void>>();
  const settings: { toValue: number; duration: number; useNativeDriver: boolean; isInteraction: boolean }[] = [];
  const values: number[] = [];
  const animations: { running: boolean; complete(): void; stops: number }[] = [];
  const observe = (event: string, callback: (value: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(callback);
    return { remove: () => { listeners.get(event)!.delete(callback); } };
  };
  const host = screenFixture(new URL('../src/screens/usePinErrorFeedback.ts', import.meta.url), 'usePinErrorFeedback', {
    'react-native': {
      Platform: { OS: 'android' },
      AccessibilityInfo: { isReduceMotionEnabled: () => preference.promise, addEventListener: observe },
      AppState: { currentState: 'active', addEventListener: observe },
      Animated: {
        Value: class { constructor(value: number) { values.push(value); } setValue(value: number) { values.push(value); } },
        timing(_value: unknown, options: typeof settings[number]) { settings.push(options); return options; },
        sequence() {
          let callback: (() => void) | undefined;
          const state = { running: false, stops: 0, complete() { state.running = false; callback?.(); } };
          animations.push(state);
          return { start(done: () => void) { callback = done; state.running = true; }, stop() { state.running = false; state.stops++; callback?.(); } };
        },
      },
    },
  });
  return {
    preference, settings, values, animations,
    render(error?: string, busy = false, attempt = 0) {
      return host.render(error, busy, attempt) as unknown as { shaking: boolean; clear(): void };
    },
    emit(event: string, value?: unknown) { for (const callback of listeners.get(event) ?? []) callback(value); },
    active: () => animations.filter(animation => animation.running).length,
    listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    close: host.close,
  };
}

test('PIN errors shake once per failed attempt with a small native-driven return to zero', async () => {
  const f = fixture(); f.render(); f.preference.resolve(false); await tick();
  f.render(undefined, true); assert.equal(f.animations.length, 0);
  f.render('Incorrect PIN', false, 1); assert.equal(f.active(), 1);
  assert.equal(f.render('Incorrect PIN', false, 1).shaking, true);
  assert.equal(f.animations.length, 1, 'Unchanged rerenders do not replay the failure');
  assert.deepEqual(f.settings.map(step => step.toValue), [-6, 6, -4, 3, 0]);
  assert.equal(f.settings.reduce((sum, step) => sum + step.duration, 0), 300);
  assert(f.settings.every(step => step.useNativeDriver && !step.isInteraction));
  f.animations[0]!.complete();
  assert.equal(f.render('Incorrect PIN', false, 1).shaking, false); assert.equal(f.values.at(-1), 0);
  f.render('Incorrect PIN', true, 1); f.render('Incorrect PIN', false, 2);
  assert.equal(f.animations.length, 2, 'The same error on another attempt shakes again');
  f.close();
});

test('new entry, loading and attempt changes stop the old error animation', async () => {
  const f = fixture(); f.render(); f.preference.resolve(false); await tick();
  f.render('Incorrect PIN', false, 1); const old = f.animations[0]!;
  f.render('Incorrect PIN', false, 1).clear();
  assert.equal(f.active(), 0); assert.equal(f.values.at(-1), 0);
  f.render('Incorrect PIN', false, 1); assert.equal(f.animations.length, 1);
  f.render(undefined, true, 2); assert.equal(f.active(), 0);
  old.complete(); assert.equal(f.active(), 0);
  f.render(undefined, false, 2); assert.equal(f.animations.length, 1);
  f.close();
});

test('Reduce Motion clears feedback immediately and preference changes do not replay it', async () => {
  const f = fixture(); f.render(); f.preference.resolve(true); await tick();
  f.render('Face ID was not completed', false, 1); assert.equal(f.animations.length, 0);
  assert.equal(f.render('Face ID was not completed', false, 1).shaking, false);
  f.emit('reduceMotionChanged', false); assert.equal(f.animations.length, 0);
  f.render(undefined, true, 1); f.render('Face ID was not completed', false, 2);
  assert.equal(f.active(), 1);
  f.emit('reduceMotionChanged', true); assert.equal(f.active(), 0); assert.equal(f.values.at(-1), 0);
  f.close();
});

test('background and Android blur retire motion without replay on return', async () => {
  for (const event of ['change', 'blur']) {
    const f = fixture(); f.render(); f.preference.resolve(false); await tick();
    f.render('Incorrect PIN', false, 1); f.emit(event, 'background');
    assert.equal(f.active(), 0); assert.equal(f.values.at(-1), 0);
    f.emit('change', 'active'); f.emit('focus'); assert.equal(f.active(), 0);
    f.render(undefined, true, 2); f.render('Incorrect PIN', false, 2); assert.equal(f.active(), 1);
    f.close(); assert.equal(f.listeners(), 0); assert.equal(f.active(), 0);
  }
});

test('late preferences cannot override newer Reduce Motion, background, entry or unmount', async () => {
  for (const action of ['preference', 'background', 'entry', 'unmount']) {
    const f = fixture(); f.render('Incorrect PIN', false, 1);
    if (action === 'preference') f.emit('reduceMotionChanged', true);
    else if (action === 'background') f.emit('change', 'background');
    else if (action === 'entry') f.render('Incorrect PIN', false, 1).clear();
    else f.close();
    f.preference.resolve(false); await tick(); assert.equal(f.animations.length, 0, action);
    if (action !== 'unmount') f.close();
  }
  const f = fixture(); f.render('Incorrect PIN', false, 1); f.preference.reject(Error('unavailable')); await tick();
  assert.equal(f.animations.length, 0); f.close();
});
