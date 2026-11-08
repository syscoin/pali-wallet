import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
} from 'utils/smartAccount/account';
import {
  captureGuardianRecoveryClaim,
  type GuardianRecoveryClaim,
} from 'utils/smartAccount/guardianRecoveryClaim';
import { buildSmartAccountGuardianRecoveryOperation } from 'utils/smartAccount/recovery';

export function guardianRecoveryFixture(
  account: string,
  guardian: string,
  chainId = 57057,
  salt = `0x${'00'.repeat(32)}`
) {
  const target = {
    auth: {
      module: 'ecdsa' as const,
      validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'),
      data: encodeEcdsaValidatorInitData([guardian], 1),
    },
  };
  const replacement = {
    kind: 'ecdsa' as const,
    authenticator: {
      id: 'ecdsa' as const,
      config: { owners: [guardian], threshold: 1 },
    },
  };
  const operation = buildSmartAccountGuardianRecoveryOperation({
    account,
    chainId,
    policyEpoch: '7',
    recoveryModule: getConfiguredAuthenticatorAddress(
      chainId,
      'guardian-recovery'
    ),
    salt,
    target,
  });
  const claim = captureGuardianRecoveryClaim({
    intent: { operation, target },
    replacement,
    guardian: { kind: 'ecdsa', guardian },
    readyAt: 1,
  });
  return { target, replacement, operation: claim.intent.operation, claim };
}

/** The mocked transport substitutes only the acknowledged background commit. */
export function acknowledgedGuardianRecoveryClaim(
  payload: any,
  response: any
): GuardianRecoveryClaim {
  return captureGuardianRecoveryClaim({
    intent: { operation: response.operation, target: payload.target },
    replacement: payload.replacement,
    readyAt: payload.readyAt,
    guardian: {
      kind: response.smartGuardian ? 'contract' : 'ecdsa',
      guardian: payload.guardian,
    },
  });
}
