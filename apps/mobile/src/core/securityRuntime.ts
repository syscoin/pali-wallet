import { IdleLock, type IdleClock } from './idleLock.ts';
import { SecurityPreferences, type PreferencePort } from './securityPreferences.ts';
/** Same runtime for native/web adapters and fixtures; only storage/clock ports vary. */
export function createSecurityRuntime(port: PreferencePort, clock?: IdleClock) {
  const securityPreferences = new SecurityPreferences(port), custodyIdle = new IdleLock(clock), watchIdle = new IdleLock(clock);
  securityPreferences.subscribe(() => {
    const state = securityPreferences.getSnapshot();
    if (state.status === 'ready' && state.value) { custodyIdle.setPolicy(state.value.custodyIdleMinutes); watchIdle.setPolicy(state.value.watchIdleMinutes); }
    else { custodyIdle.invalidate(); watchIdle.invalidate(); }
  });
  const beginIdleInteraction = () => { const native = custodyIdle.userActivity(), watch = watchIdle.userActivity(); return native && watch; };
  const captureIdleInteraction = () => {
    const native = custodyIdle.captureInteraction(), watch = watchIdle.captureInteraction();
    return () => { const nativeCurrent = native(), watchCurrent = watch(); return nativeCurrent && watchCurrent; };
  };
  return { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction, captureIdleInteraction,
    recordIdleActivity: beginIdleInteraction };
}
