import { chromeStorage } from 'utils/storageAPI';

import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SECRET_KEY_LENGTH,
  SLH_DSA_SIGNATURE_LIMIT,
  SLH_DSA_STATE_VERSION,
  getSLHDSAStateStorageKey,
} from './constants';
import { normalizeSLHDSAPublicKeyField } from './hex';
import type { SLHDSAProvisionedState } from './types';

export const validateSLHDSAProvisionedState = (
  state: SLHDSAProvisionedState
) => {
  if (
    !state ||
    state.version !== SLH_DSA_STATE_VERSION ||
    state.parameterSet !== SLH_DSA_PARAMETER_SET ||
    typeof state.keyId !== 'string' ||
    !state.keyId ||
    !Number.isSafeInteger(state.signatureCount) ||
    state.signatureCount < 0 ||
    state.signatureCount > SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT ||
    state.signatureLimit !== SLH_DSA_SIGNATURE_LIMIT ||
    typeof state.pkRoot !== 'string' ||
    typeof state.pkSeed !== 'string' ||
    (state.secretKeyHex !== undefined &&
      !new RegExp(`^0x[0-9a-fA-F]{${SLH_DSA_SECRET_KEY_LENGTH * 2}}$`).test(
        state.secretKeyHex
      ))
  ) {
    throw new Error(
      'Invalid SLH-DSA local signer state; usage history is unsafe'
    );
  }
  normalizeSLHDSAPublicKeyField(state.pkRoot);
  normalizeSLHDSAPublicKeyField(state.pkSeed);
};

type EncryptedSLHDSAStateEnvelope = {
  cipherText: string;
  keyId: string;
  updatedAt: number;
  version: number;
};

export type SLHDSASessionStateCrypto = {
  decrypt: (cipherText: string) => Promise<string> | string;
  encrypt: (plainText: string) => Promise<string> | string;
};

export const createSLHDSAProvisionedState = ({
  accountIndex,
  derivationLabel,
  keyId,
  pkRoot,
  pkSeed,
  secretKeyHex,
}: {
  accountIndex: number;
  derivationLabel: string;
  keyId: string;
  pkRoot: string;
  pkSeed: string;
  secretKeyHex?: string;
}): SLHDSAProvisionedState => {
  const now = Date.now();
  return {
    accountIndex,
    createdAt: now,
    derivationLabel,
    keyId,
    parameterSet: SLH_DSA_PARAMETER_SET,
    pkRoot: normalizeSLHDSAPublicKeyField(pkRoot),
    pkSeed: normalizeSLHDSAPublicKeyField(pkSeed),
    secretKeyHex,
    signatureCount: 0,
    signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
    updatedAt: now,
    version: SLH_DSA_STATE_VERSION,
  };
};

export const saveEncryptedSLHDSAState = async (
  state: SLHDSAProvisionedState,
  crypto: Pick<SLHDSASessionStateCrypto, 'encrypt'>,
  assertCurrentSession?: () => void
) => {
  assertCurrentSession?.();
  validateSLHDSAProvisionedState(state);
  const storageKey = getSLHDSAStateStorageKey(state.keyId);
  const cipherText = await crypto.encrypt(JSON.stringify(state));
  assertCurrentSession?.();
  const envelope: EncryptedSLHDSAStateEnvelope = {
    cipherText,
    keyId: state.keyId,
    updatedAt: Date.now(),
    version: SLH_DSA_STATE_VERSION,
  };
  await chromeStorage.setItem(storageKey, envelope);
  assertCurrentSession?.();
  const savedEnvelope = (await chromeStorage.getItem(
    storageKey
  )) as EncryptedSLHDSAStateEnvelope | null;
  assertCurrentSession?.();
  if (
    !savedEnvelope ||
    savedEnvelope.keyId !== state.keyId ||
    savedEnvelope.version !== SLH_DSA_STATE_VERSION ||
    savedEnvelope.cipherText !== cipherText
  ) {
    throw new Error(
      `Failed to persist SLH-DSA encrypted local signer state at ${storageKey}`
    );
  }
};

export const loadEncryptedSLHDSAState = async ({
  crypto,
  keyId,
}: {
  crypto: Pick<SLHDSASessionStateCrypto, 'decrypt'>;
  keyId: string;
}): Promise<SLHDSAProvisionedState | null> => {
  const envelope = (await chromeStorage.getItem(
    getSLHDSAStateStorageKey(keyId)
  )) as EncryptedSLHDSAStateEnvelope | null;
  if (!envelope) {
    return null;
  }
  if (
    envelope.keyId !== keyId ||
    envelope.version !== SLH_DSA_STATE_VERSION ||
    typeof envelope.cipherText !== 'string' ||
    !envelope.cipherText
  ) {
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  }
  const state = JSON.parse(await crypto.decrypt(envelope.cipherText));
  validateSLHDSAProvisionedState(state);
  if (state.keyId !== keyId) {
    throw new Error('SLH-DSA local signer state belongs to a different key');
  }
  return state;
};

export const removeEncryptedSLHDSAState = (keyId: string) =>
  chromeStorage.removeItem(getSLHDSAStateStorageKey(keyId));
