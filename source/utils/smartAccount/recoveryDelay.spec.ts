import {
  getGuardianRecoveryDelayOptions,
  isGuardianRecoveryDelayAllowed,
  SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS,
} from './recovery';

describe('guardian recovery setup wait periods', () => {
  it('defaults new policies to three days', () => {
    expect(SMART_ACCOUNT_GUARDIAN_DEFAULT_RECOVERY_DELAY_SECONDS).toBe(259200);
  });

  it.each([1, 57, 570, 8453, 42161, 999999])(
    'does not offer the test-only wait on production or unknown chain %s',
    (chainId) => {
      expect(getGuardianRecoveryDelayOptions(chainId)).toEqual([
        259200, 604800,
      ]);
      expect(isGuardianRecoveryDelayAllowed(chainId, 600)).toBe(false);
      expect(isGuardianRecoveryDelayAllowed(chainId, 86400)).toBe(false);
    }
  );

  it.each([5700, 57057, 57000, 11155111])(
    'offers a visibly test-only short wait on known testnet %s',
    (chainId) => {
      expect(getGuardianRecoveryDelayOptions(chainId)).toEqual([
        600, 259200, 604800,
      ]);
      expect(isGuardianRecoveryDelayAllowed(chainId, 600)).toBe(true);
    }
  );

  it('does not round or coerce an unsupported wait into a supported one', () => {
    expect(isGuardianRecoveryDelayAllowed(57057, 0)).toBe(false);
    expect(isGuardianRecoveryDelayAllowed(57057, 601)).toBe(false);
    expect(isGuardianRecoveryDelayAllowed(57057, Number.NaN)).toBe(false);
    expect(isGuardianRecoveryDelayAllowed(1, 604800)).toBe(true);
  });
});
