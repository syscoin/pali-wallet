import { sha256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import {
  guardianRecoveryFixture,
  releasedGuardianRecoveryRecord,
} from 'tests/fixtures/guardianRecoveryClaim';

import { toP256WebAuthnRecoveryTarget } from '../passkey/identity';

import { getConfiguredAuthenticatorAddress } from './account';
import {
  captureGuardianRecoveryClaim,
  captureReleasedGuardianRecoveryRecord,
} from './guardianRecoveryClaim';
import { buildSmartAccountGuardianRecoveryOperation } from './recovery';

const account = `0x${'11'.repeat(20)}`,
  guardian = `0x${'22'.repeat(20)}`;
const ecdsa = guardianRecoveryFixture(account, guardian);
const publicKey = {
  x: `0x${'11'.repeat(32)}`,
  y: `0x${'22'.repeat(32)}`,
  rpIdHash: `0x${'33'.repeat(32)}`,
  originHash: `0x${'44'.repeat(32)}`,
  originLength: 52,
};
function passkey() {
  const target = toP256WebAuthnRecoveryTarget({
    validator: getConfiguredAuthenticatorAddress(57057, 'p256-webauthn'),
    ...publicKey,
  });
  const replacement = {
    kind: 'p256-webauthn' as const,
    credentialId: 'cmVwbGFjZW1lbnQ',
    credentialIdHash: sha256(toUtf8Bytes('replacement')),
    userHandle: 'dXNlcg',
    authenticator: {
      id: 'p256-webauthn' as const,
      config: {
        credentialId: 'cmVwbGFjZW1lbnQ',
        credentialIdHash: sha256(toUtf8Bytes('replacement')),
        passkeyName: 'Released credential',
        publicKey,
      },
    },
  };
  const operation = buildSmartAccountGuardianRecoveryOperation({
    ...ecdsa.operation,
    target,
  });
  return captureGuardianRecoveryClaim({
    intent: { operation, target },
    replacement,
    guardian: ecdsa.claim.guardian,
    readyAt: 1,
  });
}

test.each(['ecdsa', 'p256'] as const)(
  'normalizes only official v4.0.69 %s fields into the same canonical intent',
  (kind) => {
    const claim = kind === 'ecdsa' ? ecdsa.claim : passkey();
    const record = releasedGuardianRecoveryRecord(claim);
    const before = JSON.stringify(record);
    expect(Object.keys(record.recoveryOperation).sort()).toEqual(
      [
        'account',
        'chainId',
        'policyEpoch',
        'executionCalldata',
        'mode',
        'readyAt',
        'recoveryModule',
        'salt',
      ].sort()
    );
    const captured = captureReleasedGuardianRecoveryRecord(record);
    expect(captured).toEqual({
      intent: claim.intent,
      replacement: claim.replacement,
      readyAt: claim.readyAt,
    });
    expect(JSON.stringify(record)).toBe(before);
  }
);

test.each([
  'hash',
  'target',
  'guardian',
  'missing epoch',
  'credential ID',
  'credential hash',
  'config refs',
  'public key',
  'threshold',
])('refuses nonreleased or inconsistent public data: %s', (axis) => {
  const record: any = structuredClone(
    releasedGuardianRecoveryRecord(
      axis === 'threshold' ? ecdsa.claim : passkey()
    )
  );
  if (axis === 'hash') record.recoveryOperation.hash = ecdsa.operation.hash;
  if (axis === 'target') record.recoveryTarget = ecdsa.target;
  if (axis === 'guardian') record.guardianApproval = 'ecdsa';
  if (axis === 'missing epoch') delete record.recoveryOperation.policyEpoch;
  if (axis === 'credential ID') record.credentialId = 'b3RoZXI';
  if (axis === 'credential hash') {
    record.credentialIdHash = `0x${'99'.repeat(32)}`;
    record.authenticator.config.credentialIdHash = record.credentialIdHash;
  }
  if (axis === 'config refs')
    record.authenticator.config.credentialId = 'b3RoZXI';
  if (axis === 'public key')
    record.authenticator.config.publicKey.x = `0x${'99'.repeat(32)}`;
  if (axis === 'threshold') record.authenticator.config.threshold = 2;
  expect(() => captureReleasedGuardianRecoveryRecord(record)).toThrow();
});
