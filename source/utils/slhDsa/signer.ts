import { isHexString } from 'utils/ethersV6Compat';

import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
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
  loadEncryptedSLHDSAState,
  saveEncryptedSLHDSAState,
  validateSLHDSAProvisionedState,
  type SLHDSASessionStateCrypto,
} from './state';
import type {
  SLHDSAProvisionedState,
  SLHDSASignActionHashParams,
} from './types';

const runtimeStates = new Map<string, SLHDSAProvisionedState>();
const signingQueues = new Map<string, Promise<void>>();
let sessionStateCrypto: SLHDSASessionStateCrypto | null = null;
let sessionGeneration = 0;

export const getSLHDSASessionGeneration = () => sessionGeneration;

export const assertSLHDSASessionGeneration = (expected: number) => {
  if (expected !== sessionGeneration) {
    throw new Error('SLH-DSA wallet session changed; unlock and retry');
  }
};

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

const mergeSLHDSAUsageHistory = (
  state: SLHDSAProvisionedState,
  previous?: SLHDSAProvisionedState | null
): SLHDSAProvisionedState => {
  validateSLHDSAProvisionedState(state);
  if (!previous) {
    return { ...state };
  }
  validateSLHDSAProvisionedState(previous);
  if (
    state.keyId !== previous.keyId ||
    normalizeSLHDSAPublicKeyField(state.pkRoot) !==
      normalizeSLHDSAPublicKeyField(previous.pkRoot) ||
    normalizeSLHDSAPublicKeyField(state.pkSeed) !==
      normalizeSLHDSAPublicKeyField(previous.pkSeed) ||
    (state.secretKeyHex &&
      previous.secretKeyHex &&
      state.secretKeyHex.toLowerCase() !== previous.secretKeyHex.toLowerCase())
  ) {
    throw new Error(
      'SLH-DSA local signer state conflicts with existing key material'
    );
  }
  return {
    ...state,
    secretKeyHex: state.secretKeyHex ?? previous.secretKeyHex,
    signatureCount: Math.max(state.signatureCount, previous.signatureCount),
  };
};

export const putRuntimeSLHDSAState = (
  state: SLHDSAProvisionedState,
  expectedGeneration = sessionGeneration
) => {
  assertSLHDSASessionGeneration(expectedGeneration);
  // Hydration can finish after another request has already used this key.
  const merged = mergeSLHDSAUsageHistory(state, runtimeStates.get(state.keyId));
  runtimeStates.set(state.keyId, merged);
  return { ...merged };
};

export const registerRuntimeSLHDSAState = (
  state: SLHDSAProvisionedState,
  expectedGeneration = sessionGeneration
) =>
  withSigningQueue(state.keyId, async () => {
    const assertSession = () =>
      assertSLHDSASessionGeneration(expectedGeneration);
    assertSession();
    const crypto = getSessionStateCrypto();
    const persisted = await loadEncryptedSLHDSAState({
      crypto,
      keyId: state.keyId,
    });
    assertSession();
    const merged = mergeSLHDSAUsageHistory(
      mergeSLHDSAUsageHistory(state, persisted),
      runtimeStates.get(state.keyId)
    );
    await saveEncryptedSLHDSAState(merged, crypto, assertSession);
    return putRuntimeSLHDSAState(merged, expectedGeneration);
  });

export const provisionRuntimeSLHDSAState = async (
  params: {
    accountIndex: number;
    derivationLabel: string;
    keyId: string;
    pkRoot: string;
    pkSeed: string;
    setupSecretHex: string;
  },
  expectedGeneration = sessionGeneration
) => {
  assertSLHDSASessionGeneration(expectedGeneration);
  const keypair = await prepareSLHDSAKeypairInOffscreen(
    {
      setupSecretHex: params.setupSecretHex,
    },
    () => assertSLHDSASessionGeneration(expectedGeneration)
  );
  assertSLHDSASessionGeneration(expectedGeneration);
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
  return registerRuntimeSLHDSAState(state, expectedGeneration);
};

export const provisionRuntimeSLHDSAStateFromSetupSecret = async (
  params: {
    accountId?: number;
    accountIndex: number;
    derivationLabel: string;
    setupSecretHex: string;
  },
  expectedGeneration = sessionGeneration
) => {
  assertSLHDSASessionGeneration(expectedGeneration);
  const keypair = await prepareSLHDSAKeypairInOffscreen(
    {
      accountId: params.accountId,
      setupSecretHex: params.setupSecretHex,
    },
    () => assertSLHDSASessionGeneration(expectedGeneration)
  );
  assertSLHDSASessionGeneration(expectedGeneration);
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
  return registerRuntimeSLHDSAState(state, expectedGeneration);
};

export const clearRuntimeSLHDSAStates = () => {
  sessionGeneration += 1;
  runtimeStates.clear();
  // Pending storage writes must finish before a new session writes this key.
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

const withSigningQueue = async <T>(
  keyId: string,
  task: () => Promise<T>
): Promise<T> => {
  const previous = signingQueues.get(keyId) || Promise.resolve();
  const queued = previous.catch(() => undefined).then(task);
  const stored = queued.then(
    () => undefined,
    () => undefined
  );
  signingQueues.set(keyId, stored);
  try {
    return await queued;
  } finally {
    if (signingQueues.get(keyId) === stored) {
      signingQueues.delete(keyId);
    }
  }
};

const signSLHDSAActionHashLocalUnlocked = async (
  params: SLHDSASignActionHashParams,
  expectedGeneration: number
) => {
  const assertSession = () => assertSLHDSASessionGeneration(expectedGeneration);
  assertSession();
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
  const canUseReservedSignature =
    params.allowReservedSignature &&
    state.signatureCount < SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT;
  if (
    state.signatureCount >= state.signatureLimit &&
    !canUseReservedSignature
  ) {
    throw new Error('SLH-DSA signature limit reached; rotate this key');
  }

  if (!state.secretKeyHex) {
    throw new Error(
      'SLH-DSA key is missing prepared local signing material. Re-run PQ validator setup before signing.'
    );
  }
  const crypto = getSessionStateCrypto();
  const signature = await signSLHDSAInOffscreen(
    {
      ...params,
      secretKeyHex: state.secretKeyHex,
    },
    assertSession
  );
  assertSession();
  validateSignature(signature);

  const currentState = mergeSLHDSAUsageHistory(
    state,
    runtimeStates.get(params.keyId)
  );
  const updatedState: SLHDSAProvisionedState = {
    ...currentState,
    signatureCount: currentState.signatureCount + 1,
    updatedAt: Date.now(),
  };
  runtimeStates.set(params.keyId, updatedState);
  await saveEncryptedSLHDSAState(updatedState, crypto, assertSession);
  assertSession();

  return signature;
};

export const signSLHDSAActionHashLocal = async (
  params: SLHDSASignActionHashParams,
  expectedGeneration = sessionGeneration
) =>
  withSigningQueue(params.keyId, () =>
    signSLHDSAActionHashLocalUnlocked(params, expectedGeneration)
  );
