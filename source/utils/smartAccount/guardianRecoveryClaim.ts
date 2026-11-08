import { AbiCoder } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { sha256 } from 'ethers/crypto';

import { base64UrlToBytes, bytesToBase64Url } from '../passkey/base64url.ts';

import {
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
  type PaliSmartAccountAuthenticatorSetup,
  type PaliRecoveryTarget,
} from './account.ts';
import { captureGuardianRecoveryOperation } from './guardianRecoveryCommands.ts';
import {
  captureGuardianRecoveryIntent,
  type GuardianRecoveryIntent,
} from './guardianRecoveryIntent.ts';
import type { GuardianRecoveryApprovalVerification } from './guardianRecoveryLifecycle.ts';
import {
  getSmartAccountGuardianRecoveryHash,
  type SmartAccountGuardianRecoveryOperation,
} from './recovery.ts';

export type GuardianRecoveryReplacement = Readonly<{
  authenticator: PaliSmartAccountAuthenticatorSetup;
  backupStatus?: string;
  credentialId?: string;
  credentialIdHash?: string;
  kind: 'ecdsa' | 'p256-webauthn';
  userHandle?: string;
}>;
export type GuardianRecoveryClaim = Readonly<{
  guardian: GuardianRecoveryApprovalVerification;
  intent: GuardianRecoveryIntent;
  readyAt: number;
  replacement: GuardianRecoveryReplacement;
}>;

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 8192)
    throw new Error('Invalid guardian replacement reference');
  return value;
}

/** Snapshot public replacement references and bind them to the canonical call. */
export function captureGuardianRecoveryClaim(
  input: GuardianRecoveryClaim
): GuardianRecoveryClaim {
  const intent = captureGuardianRecoveryIntent(input.intent);
  if (
    !input.guardian ||
    !['ecdsa', 'contract'].includes(input.guardian.kind) ||
    !Number.isSafeInteger(input.readyAt) ||
    input.readyAt < 0
  )
    throw new Error('Invalid guardian recovery claim');
  const guardian = Object.freeze({
    kind: input.guardian.kind,
    guardian: getAddress(input.guardian.guardian),
  });
  const { replacement, target } = captureGuardianRecoveryReplacement(
    input.replacement,
    intent.operation.chainId
  );
  captureGuardianRecoveryIntent({ operation: intent.operation, target });
  return Object.freeze({
    guardian,
    intent,
    replacement,
    readyAt: input.readyAt,
  });
}

function captureGuardianRecoveryReplacement(
  source: GuardianRecoveryReplacement,
  chainId: number
) {
  const config = source?.authenticator?.config;
  let replacement: GuardianRecoveryReplacement, target: PaliRecoveryTarget;
  if (source?.kind === 'ecdsa' && source.authenticator.id === 'ecdsa') {
    const value = config as Extract<
      PaliSmartAccountAuthenticatorSetup,
      { id: 'ecdsa' }
    >['config'];
    if (
      !Array.isArray(value.owners) ||
      value.owners.length !== 1 ||
      (value.threshold ?? 1) !== 1
    )
      throw new Error('Invalid guardian replacement owner');
    const owners = value.owners.map(getAddress);
    Object.freeze(owners);
    replacement = Object.freeze({
      kind: 'ecdsa',
      authenticator: Object.freeze({
        id: 'ecdsa',
        config: Object.freeze({ owners, threshold: 1 }),
      }),
    });
    target = {
      auth: {
        module: 'ecdsa',
        validator: getConfiguredAuthenticatorAddress(chainId, 'ecdsa'),
        data: encodeEcdsaValidatorInitData([...owners], 1),
      },
    };
  } else if (
    source?.kind === 'p256-webauthn' &&
    source.authenticator.id === 'p256-webauthn'
  ) {
    const value = config as Extract<
      PaliSmartAccountAuthenticatorSetup,
      { id: 'p256-webauthn' }
    >['config'];
    const publicKey = Object.freeze({
      x: value.publicKey.x,
      y: value.publicKey.y,
      rpIdHash: value.publicKey.rpIdHash,
      originHash: value.publicKey.originHash,
      originLength: value.publicKey.originLength,
    });
    if (
      ![
        publicKey.x,
        publicKey.y,
        publicKey.rpIdHash,
        publicKey.originHash,
      ].every(
        (field) => typeof field === 'string' && /^0x[0-9a-f]{64}$/i.test(field)
      ) ||
      !Number.isSafeInteger(publicKey.originLength) ||
      publicKey.originLength < 1
    )
      throw new Error('Invalid guardian replacement public key');
    const credentialId = optionalString(
        source.credentialId ?? value.credentialId
      ),
      credentialIdHash = optionalString(
        source.credentialIdHash ?? value.credentialIdHash
      );
    if (
      !credentialId ||
      !credentialIdHash ||
      !/^0x[0-9a-f]{64}$/i.test(credentialIdHash) ||
      (value.credentialId && value.credentialId !== credentialId) ||
      (value.credentialIdHash && value.credentialIdHash !== credentialIdHash)
    )
      throw new Error('Invalid guardian replacement credential');
    const backupStatus = optionalString(
      source.backupStatus ?? value.backupStatus
    );
    replacement = Object.freeze({
      kind: 'p256-webauthn',
      credentialId,
      credentialIdHash,
      ...(backupStatus === undefined ? {} : { backupStatus }),
      ...(source.userHandle === undefined
        ? {}
        : { userHandle: optionalString(source.userHandle) }),
      authenticator: Object.freeze({
        id: 'p256-webauthn',
        config: Object.freeze({
          credentialId,
          credentialIdHash,
          passkeyName: optionalString(value.passkeyName) ?? '',
          ...(backupStatus === undefined
            ? {}
            : { backupStatus: backupStatus as typeof value.backupStatus }),
          publicKey,
        }),
      }),
    });
    target = {
      auth: {
        module: 'p256-webauthn',
        validator: getConfiguredAuthenticatorAddress(chainId, 'p256-webauthn'),
        data: AbiCoder.defaultAbiCoder().encode(
          ['tuple(bytes32,bytes32,bytes32,bytes32,uint256)'],
          [
            [
              publicKey.x,
              publicKey.y,
              publicKey.rpIdHash,
              publicKey.originHash,
              publicKey.originLength,
            ],
          ]
        ),
      },
    };
  } else throw new Error('Invalid guardian replacement authenticator');
  return { replacement, target };
}

/** Public localStorage schema written by the official stable v4.0.69 ZIP. */
export type ReleasedGuardianRecoveryRecord = GuardianRecoveryReplacement & {
  recoveryOperation: Omit<SmartAccountGuardianRecoveryOperation, 'hash'> & {
    readyAt: number;
  };
};

export function captureReleasedGuardianRecoveryRecord(
  input: ReleasedGuardianRecoveryRecord
): Omit<GuardianRecoveryClaim, 'guardian'> {
  const allowed = [
    'authenticator',
    'backupStatus',
    'credentialId',
    'credentialIdHash',
    'kind',
    'recoveryOperation',
    'userHandle',
  ];
  const operationKeys = [
    'account',
    'chainId',
    'policyEpoch',
    'executionCalldata',
    'mode',
    'readyAt',
    'recoveryModule',
    'salt',
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    !input.recoveryOperation ||
    Object.keys(input.recoveryOperation).length !== operationKeys.length ||
    Object.keys(input.recoveryOperation).some(
      (key) => !operationKeys.includes(key)
    )
  )
    throw new Error('Invalid released guardian recovery record');
  const operation = captureGuardianRecoveryOperation(input.recoveryOperation);
  const readyAt = input.recoveryOperation.readyAt;
  if (!Number.isSafeInteger(readyAt) || readyAt < 0)
    throw new Error('Invalid released guardian recovery time');
  const { replacement, target } = captureGuardianRecoveryReplacement(
    input,
    operation.chainId
  );
  if (replacement.kind === 'p256-webauthn') {
    const bytes = base64UrlToBytes(replacement.credentialId!);
    if (
      !bytes.length ||
      bytesToBase64Url(bytes) !== replacement.credentialId ||
      sha256(bytes).toLowerCase() !==
        replacement.credentialIdHash!.toLowerCase()
    )
      throw new Error('Invalid released guardian replacement credential');
  }
  const intent = captureGuardianRecoveryIntent({
    operation: {
      ...operation,
      hash: getSmartAccountGuardianRecoveryHash(operation),
    },
    target,
  });
  return Object.freeze({ intent, replacement, readyAt });
}

export function sameGuardianRecoveryClaim(
  left: GuardianRecoveryClaim,
  right: GuardianRecoveryClaim
): boolean {
  return (
    JSON.stringify(captureGuardianRecoveryClaim(left)) ===
    JSON.stringify(captureGuardianRecoveryClaim(right))
  );
}

/** Execution history alone does not establish today's local signing identity. */
export function guardianRecoveryReplacementApplied(
  claim: GuardianRecoveryClaim,
  metadata: import('../../types/network.ts').ISmartAccountMetadata
): boolean {
  const target = claim.intent.target.auth;
  return (
    metadata.chainId === claim.intent.operation.chainId &&
    metadata.isDeployed === true &&
    metadata.auth?.module === target.module &&
    metadata.auth.validator.toLowerCase() === target.validator.toLowerCase() &&
    metadata.auth.data.toLowerCase() === target.data.toLowerCase() &&
    metadata.installedModules?.some(
      (module) =>
        module.type === 'validator' &&
        module.id === target.module &&
        module.address.toLowerCase() === target.validator.toLowerCase()
    ) === true
  );
}
