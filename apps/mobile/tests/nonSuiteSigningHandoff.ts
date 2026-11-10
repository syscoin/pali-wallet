import { SMART_ACCOUNT_EXECUTION_LIFETIME_MS } from '../../../source/utils/smartAccount/prepareOperation.ts';
import type { NativeSigningHandoff } from '../src/connections/signingHandoff.ts';
/** Explicit test port for a host that never launches Suite. */
export const nonSuiteSigningHandoff: NativeSigningHandoff = Object.freeze({
  id: 'non-suite-test', expiresAt: Number.MAX_SAFE_INTEGER, beforeSuiteOpen() { throw Error('Suite is outside this fixture'); },
  beforeSignature() {}, isSuspended: () => false,
});

export const freshSmartOperationDeadline = () => Date.now() + SMART_ACCOUNT_EXECUTION_LIFETIME_MS;
