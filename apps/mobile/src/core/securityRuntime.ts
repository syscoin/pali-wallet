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
  let deniedInteraction = false;
  const beginIdleInteraction = () => { const native = custodyIdle.userActivity(), watch = watchIdle.userActivity(); deniedInteraction = !native || !watch; return !deniedInteraction; };
  return { securityPreferences, custodyIdle, watchIdle, beginIdleInteraction,
    recordIdleActivity: () => !deniedInteraction && beginIdleInteraction() };
}
