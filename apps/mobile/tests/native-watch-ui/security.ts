import { createSecurityRuntime } from '../../src/core/securityRuntime';
let offset = 0, fail = new URLSearchParams(window.location.search).has('security-read-failure'), loseAck = false;
let held = false, release: (() => void) | null = null;
const key = 'pali-fixture-security-preferences';
export const { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction, recordIdleActivity } = createSecurityRuntime({
  async get() { if (fail) throw Error(); return localStorage.getItem(key); },
  async set(raw) { if (held) await new Promise<void>(resolve => { release = resolve; }); localStorage.setItem(key,raw); if (loseAck) throw Error(); },
}, () => ({ monotonic: performance.now() + offset, wall: Date.now() + offset }));
export const idleFixture = {
  elapse(ms: number) { offset += ms; }, fire() { custodyIdle.check(); watchIdle.check(); },
  readFailure(value: boolean) { fail = value; }, loseAck(value: boolean) { loseAck = value; }, hold(value: boolean) { held = value; },
  release() { held = false; release?.(); release = null; }, value: () => localStorage.getItem(key),
};
