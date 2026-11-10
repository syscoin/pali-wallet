import assert from 'node:assert/strict';
import test from 'node:test';
import { screenFixture } from './screenFixture.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const preference = Promise.withResolvers<boolean>();
  const listeners = new Map<string, Set<(value: any) => void>>();
  const settings: Record<string, unknown>[] = [], values: number[] = [];
  const loops: { running: boolean; starts: number; stops: number }[] = [];
  const observe = (event: string, callback: (value: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(callback);
    return { remove: () => { listeners.get(event)!.delete(callback); } };
  };
  const native = {
    Platform: { OS: 'android' },
    AccessibilityInfo: { isReduceMotionEnabled: () => preference.promise, addEventListener: observe },
    AppState: { currentState: 'active', addEventListener: observe },
    Easing: { sin: 'sine', inOut: (value: unknown) => value },
    Animated: {
      Value: class {
        constructor(value: number) { values.push(value); }
        setValue(value: number) { values.push(value); }
        interpolate(value: unknown) { return value; }
      },
      timing(_value: unknown, options: Record<string, unknown>) { settings.push(options); return options; },
      sequence: (steps: unknown) => steps,
      loop() {
        const loop = { running: false, starts: 0, stops: 0 }; loops.push(loop);
        return { start() { loop.running = true; loop.starts++; }, stop() { loop.running = false; loop.stops++; } };
      },
    },
  };
  const screen = screenFixture(new URL('../src/screens/useWelcomeBackdropMotion.ts', import.meta.url), 'useWelcomeBackdropMotion', { 'react-native': native });
  return { preference, settings, values, loops, render: () => screen.render({}), close: screen.close,
    emit(event: string, value?: unknown) { for (const callback of listeners.get(event) ?? []) callback(value); },
    listeners: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    active: () => loops.filter(loop => loop.running).length };
}

test('welcome motion is native-driven, decorative and paused for background, blur and reduced motion', async () => {
  const f = fixture(); f.render();
  assert.equal(f.active(), 0);
  f.preference.resolve(false); await tick(); assert.equal(f.active(), 1);
  assert(f.settings.every(value => value.useNativeDriver === true && value.isInteraction === false && value.duration === 8000));
  f.emit('change', 'active'); assert.equal(f.loops.length, 1);
  f.emit('change', 'background'); assert.equal(f.active(), 0); assert.equal(f.values.at(-1), 0.5);
  f.emit('focus'); assert.equal(f.active(), 0);
  f.emit('change', 'active'); assert.equal(f.active(), 1);
  f.emit('blur'); assert.equal(f.active(), 0);
  f.emit('focus'); assert.equal(f.active(), 1);
  f.emit('reduceMotionChanged', true); assert.equal(f.active(), 0);
  f.emit('change', 'active'); assert.equal(f.active(), 0);
  f.close(); assert.equal(f.listeners(), 0); assert.equal(f.active(), 0);
});

test('a late initial preference cannot overwrite a newer reduced-motion event', async () => {
  const f = fixture(); f.render();
  f.emit('reduceMotionChanged', true);
  f.preference.resolve(false); await tick(); assert.equal(f.loops.length, 0);
  f.emit('reduceMotionChanged', false); assert.equal(f.active(), 1);
  f.close(); assert.equal(f.active(), 0);
});

test('unmount and unavailable preference keep the backdrop static', async () => {
  const closed = fixture(); closed.render(); closed.close(); closed.preference.resolve(false); await tick();
  assert.equal(closed.loops.length, 0); assert.equal(closed.listeners(), 0);
  const failed = fixture(); failed.render(); failed.preference.reject(Error('unavailable')); await tick();
  assert.equal(failed.loops.length, 0); failed.close();
});
