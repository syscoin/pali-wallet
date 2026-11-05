import { assertWalletPersistenceAllowed } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
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
import type { SlhDsaStateCrypto } from '../../wallet/slhDsaStateCrypto';

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

export type SLHDSASessionStateCrypto = SlhDsaStateCrypto;

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

const readEnvelope = async (
  keyId: string
): Promise<EncryptedSLHDSAStateEnvelope | null> => {
  const storageKey = getSLHDSAStateStorageKey(keyId);
  const records = await chromeStorage.getItems([storageKey]);
  if (!Object.hasOwn(records, storageKey)) return null;
  const value = records[storageKey];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  const fields = ['cipherText', 'keyId', 'updatedAt', 'version'];
  const own = Reflect.ownKeys(value);
  if (
    own.length !== fields.length ||
    own.some((field) => typeof field !== 'string' || !fields.includes(field))
  )
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new Error(
        'Invalid SLH-DSA encrypted state; usage history is unsafe'
      );
    snapshot[field] = descriptor.value;
  }
  if (
    snapshot.keyId !== keyId ||
    snapshot.version !== SLH_DSA_STATE_VERSION ||
    typeof snapshot.cipherText !== 'string' ||
    !snapshot.cipherText ||
    !Number.isSafeInteger(snapshot.updatedAt) ||
    (snapshot.updatedAt as number) < 0
  )
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  return snapshot as EncryptedSLHDSAStateEnvelope;
};

export const saveEncryptedSLHDSAState = async (
  state: SLHDSAProvisionedState,
  crypto: Pick<SLHDSASessionStateCrypto, 'encrypt'>,
  assertCurrentSession?: () => void
) => {
  assertCurrentSession?.();
  validateSLHDSAProvisionedState(state);
  const keyId = state.keyId;
  const storageKey = getSLHDSAStateStorageKey(keyId);
  const plainText = JSON.stringify(state);
  const cipherText = await crypto.encrypt(plainText, keyId);
  assertCurrentSession?.();
  if (typeof cipherText !== 'string' || !cipherText)
    throw new Error('Invalid SLH-DSA encrypted state; usage history is unsafe');
  const envelope: EncryptedSLHDSAStateEnvelope = {
    cipherText,
    keyId,
    updatedAt: Date.now(),
    version: SLH_DSA_STATE_VERSION,
  };
  // Share the existing wallet reset/snapshot barrier, without holding it during
  // encryption or signing. A retired session cannot write after recovery.
  await walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    assertCurrentSession?.();
    await chromeStorage.setItem(storageKey, envelope);
    assertCurrentSession?.();
    const savedEnvelope = await readEnvelope(keyId);
    assertWalletPersistenceAllowed();
    assertCurrentSession?.();
    if (
      !savedEnvelope ||
      JSON.stringify(savedEnvelope) !== JSON.stringify(envelope)
    )
      throw new Error(
        `Failed to persist SLH-DSA encrypted local signer state at ${storageKey}`
      );
  });
};

export const loadEncryptedSLHDSAState = async ({
  crypto,
  keyId,
}: {
  crypto: Pick<SLHDSASessionStateCrypto, 'decrypt'>;
  keyId: string;
}): Promise<SLHDSAProvisionedState | null> => {
  const envelope = await readEnvelope(keyId);
  if (!envelope) return null;
  const state = JSON.parse(await crypto.decrypt(envelope.cipherText, keyId));
  validateSLHDSAProvisionedState(state);
  if (state.keyId !== keyId) {
    throw new Error('SLH-DSA local signer state belongs to a different key');
  }
  return state;
};

export const removeEncryptedSLHDSAState = (keyId: string) =>
  chromeStorage.removeItem(getSLHDSAStateStorageKey(keyId));
