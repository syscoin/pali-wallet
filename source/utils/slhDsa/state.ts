import { chromeStorage } from 'utils/storageAPI';

import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LIMIT,
  SLH_DSA_STATE_VERSION,
  getSLHDSAStateStorageKey,
} from './constants';
import { normalizeSLHDSAPublicKeyField } from './hex';
import type { SLHDSAProvisionedState } from './types';

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
  crypto: Pick<SLHDSASessionStateCrypto, 'encrypt'>
) => {
  const storageKey = getSLHDSAStateStorageKey(state.keyId);
  const cipherText = await crypto.encrypt(JSON.stringify(state));
  const envelope: EncryptedSLHDSAStateEnvelope = {
    cipherText,
    keyId: state.keyId,
    updatedAt: Date.now(),
    version: SLH_DSA_STATE_VERSION,
  };
  await chromeStorage.setItem(storageKey, envelope);
  const savedEnvelope = (await chromeStorage.getItem(
    storageKey
  )) as EncryptedSLHDSAStateEnvelope | null;
  if (
    !savedEnvelope ||
    savedEnvelope.keyId !== state.keyId ||
    savedEnvelope.version !== SLH_DSA_STATE_VERSION
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
  return JSON.parse(await crypto.decrypt(envelope.cipherText));
};

export const removeEncryptedSLHDSAState = (keyId: string) =>
  chromeStorage.removeItem(getSLHDSAStateStorageKey(keyId));
