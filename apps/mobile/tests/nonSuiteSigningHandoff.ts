import type { NativeSigningHandoff } from '../src/connections/signingHandoff.ts';
/** Explicit test port for a host that never launches Suite. */
export const nonSuiteSigningHandoff: NativeSigningHandoff = Object.freeze({
  id: 'non-suite-test', beforeSuiteOpen() { throw Error('Suite is outside this fixture'); },
  beforeSignature() {}, isSuspended: () => false,
});
