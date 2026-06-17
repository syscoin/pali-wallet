import { isHexString } from '@ethersproject/bytes';

import {
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_SIGNATURE_HEX_LENGTH,
  getSLHDSAKeyId,
} from './constants';
import { normalizeSLHDSAPublicKeyField } from './hex';
import {
  prepareSLHDSAKeypairInOffscreen,
  signSLHDSAInOffscreen,
} from './offscreenClient';
import {
  createSLHDSAProvisionedState,
  saveEncryptedSLHDSAState,
  type SLHDSASessionStateCrypto,
} from './state';
import type {
  SLHDSAProvisionedState,
  SLHDSASignActionHashParams,
} from './types';

const runtimeStates = new Map<string, SLHDSAProvisionedState>();
let sessionStateCrypto: SLHDSASessionStateCrypto | null = null;

export const configureSLHDSASessionStateCrypto = (
  crypto: SLHDSASessionStateCrypto
) => {
  sessionStateCrypto = crypto;
};

const getSessionStateCrypto = () => {
  if (!sessionStateCrypto) {
    throw new Error('SLH-DSA session encryption is not available');
  }
  return sessionStateCrypto;
};

export const putRuntimeSLHDSAState = (state: SLHDSAProvisionedState) => {
  if (state.parameterSet !== SLH_DSA_PARAMETER_SET) {
    throw new Error(`Unsupported SLH-DSA parameter set ${state.parameterSet}`);
  }
  runtimeStates.set(state.keyId, state);
};

export const registerRuntimeSLHDSAState = async (
  state: SLHDSAProvisionedState
) => {
  putRuntimeSLHDSAState(state);
  await saveEncryptedSLHDSAState(state, getSessionStateCrypto());
};

export const provisionRuntimeSLHDSAState = async (params: {
  accountIndex: number;
  derivationLabel: string;
  keyId: string;
  pkRoot: string;
  pkSeed: string;
  setupSecretHex: string;
}) => {
  const keypair = await prepareSLHDSAKeypairInOffscreen({
    setupSecretHex: params.setupSecretHex,
  });
  if (
    keypair.pkRoot.toLowerCase() !==
      normalizeSLHDSAPublicKeyField(params.pkRoot).toLowerCase() ||
    keypair.pkSeed.toLowerCase() !==
      normalizeSLHDSAPublicKeyField(params.pkSeed).toLowerCase()
  ) {
    throw new Error(
      'Derived SLH-DSA keypair does not match validator metadata'
    );
  }

  const state = createSLHDSAProvisionedState({
    accountIndex: params.accountIndex,
    derivationLabel: params.derivationLabel,
    keyId: params.keyId,
    pkRoot: keypair.pkRoot,
    pkSeed: keypair.pkSeed,
    secretKeyHex: keypair.secretKeyHex,
  });
  await registerRuntimeSLHDSAState(state);
  return state;
};

export const provisionRuntimeSLHDSAStateFromSetupSecret = async (params: {
  accountId?: number;
  accountIndex: number;
  derivationLabel: string;
  setupSecretHex: string;
}) => {
  const keypair = await prepareSLHDSAKeypairInOffscreen({
    accountId: params.accountId,
    setupSecretHex: params.setupSecretHex,
  });
  const keyId = getSLHDSAKeyId({
    pkRoot: keypair.pkRoot,
    pkSeed: keypair.pkSeed,
  });
  const state = createSLHDSAProvisionedState({
    accountIndex: params.accountIndex,
    derivationLabel: params.derivationLabel,
    keyId,
    pkRoot: keypair.pkRoot,
    pkSeed: keypair.pkSeed,
    secretKeyHex: keypair.secretKeyHex,
  });
  await registerRuntimeSLHDSAState(state);
  return state;
};

export const clearRuntimeSLHDSAStates = () => {
  runtimeStates.clear();
  sessionStateCrypto = null;
};

const validateSignature = (signature: string) => {
  if (
    !isHexString(signature) ||
    signature.length !== SLH_DSA_SIGNATURE_HEX_LENGTH
  ) {
    throw new Error(
      `SLH-DSA signer returned an invalid signature length; expected ${SLH_DSA_SIGNATURE_LENGTH} bytes`
    );
  }
};

export const signSLHDSAActionHashLocal = async (
  params: SLHDSASignActionHashParams
) => {
  if (params.parameterSet !== SLH_DSA_PARAMETER_SET) {
    throw new Error(`Unsupported SLH-DSA parameter set ${params.parameterSet}`);
  }
  if (!isHexString(params.actionHash, 32)) {
    throw new Error('SLH-DSA actionHash must be a bytes32 hex string');
  }

  const state = runtimeStates.get(params.keyId);
  if (!state) {
    throw new Error(
      'SLH-DSA key is not available in this unlocked session. Provision the local PQ signer state before signing.'
    );
  }
  if (
    normalizeSLHDSAPublicKeyField(state.pkRoot).toLowerCase() !==
      normalizeSLHDSAPublicKeyField(params.pkRoot).toLowerCase() ||
    normalizeSLHDSAPublicKeyField(state.pkSeed).toLowerCase() !==
      normalizeSLHDSAPublicKeyField(params.pkSeed).toLowerCase()
  ) {
    throw new Error('SLH-DSA key metadata does not match the active validator');
  }
  if (state.signatureCount >= state.signatureLimit) {
    throw new Error('SLH-DSA signature limit reached; rotate this key');
  }

  if (!state.secretKeyHex) {
    throw new Error(
      'SLH-DSA key is missing prepared local signing material. Re-run PQ validator setup before signing.'
    );
  }
  const signature = await signSLHDSAInOffscreen({
    ...params,
    secretKeyHex: state.secretKeyHex,
  });
  validateSignature(signature);

  const updatedState: SLHDSAProvisionedState = {
    ...state,
    signatureCount: state.signatureCount + 1,
    updatedAt: Date.now(),
  };
  runtimeStates.set(params.keyId, updatedState);
  await saveEncryptedSLHDSAState(updatedState, getSessionStateCrypto());

  return signature;
};
