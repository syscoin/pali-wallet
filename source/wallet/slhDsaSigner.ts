import { isHexString } from 'ethers/utils';

import {
  SLH_DSA_ABSOLUTE_SIGNATURE_LIMIT,
  SLH_DSA_PARAMETER_SET,
  SLH_DSA_SIGNATURE_LENGTH,
  SLH_DSA_SIGNATURE_HEX_LENGTH,
  getSLHDSAKeyId,
} from '../utils/slhDsa/constants.ts';
import { normalizeSLHDSAPublicKeyField } from '../utils/slhDsa/hex.ts';

import {
  createSLHDSAProvisionedState,
  validateSLHDSAProvisionedState,
  type createSlhDsaStateStore,
  type SLHDSASessionStateCrypto,
} from './slhDsaState.ts';
import type {
  SLHDSAProvisionedState,
  SLHDSADispatchApproval,
  SLHDSASignActionHashParams,
} from '../utils/slhDsa/types.ts';

export type SlhDsaExecution = Readonly<{
  prepareKeypair(
    request: Readonly<{
      accountId?: number;
      setupJobId?: string;
      setupSecretHex: string;
    }>,
    assertSession: () => void
  ): Promise<{ pkRoot: string; pkSeed: string; secretKeyHex: string }>;
  signActionHash(
    request: SLHDSASignActionHashParams & { secretKeyHex: string },
    assertSession: () => void,
    approval?: SLHDSADispatchApproval
  ): Promise<string>;
}>;

export type SlhDsaSignerPorts = Readonly<{
  execution: SlhDsaExecution;
  now: () => number;
  stateStore: Pick<ReturnType<typeof createSlhDsaStateStore>, 'load' | 'save'>;
}>;

/** Per-host signer state and queues. Execution is supplied by the owning host. */
export function createSlhDsaSigner(ports: SlhDsaSignerPorts) {
  const { stateStore, execution, now } = ports;
  if (
    typeof stateStore?.load !== 'function' ||
    typeof stateStore?.save !== 'function' ||
    typeof execution?.prepareKeypair !== 'function' ||
    typeof execution?.signActionHash !== 'function' ||
    typeof now !== 'function'
  )
    throw new Error('SLH-DSA signer host is unavailable');

  const runtimeStates = new Map<string, SLHDSAProvisionedState>();
  const signingQueues = new Map<string, Promise<void>>();
  let sessionStateCrypto: SLHDSASessionStateCrypto | null = null;
  let sessionGeneration = 0;

  const getSLHDSASessionGeneration = () => sessionGeneration;

  const assertSLHDSASessionGeneration = (expected: number) => {
    if (expected !== sessionGeneration) {
      throw new Error('SLH-DSA wallet session changed; unlock and retry');
    }
  };

  const configureSLHDSASessionStateCrypto = (
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
        state.secretKeyHex.toLowerCase() !==
          previous.secretKeyHex.toLowerCase())
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

  const putRuntimeSLHDSAState = (
    state: SLHDSAProvisionedState,
    expectedGeneration: number
  ) => {
    assertSLHDSASessionGeneration(expectedGeneration);
    // Hydration can finish after another request has already used this key.
    const merged = mergeSLHDSAUsageHistory(
      state,
      runtimeStates.get(state.keyId)
    );
    runtimeStates.set(state.keyId, merged);
    return { ...merged };
  };

  const registerRuntimeSLHDSAState = (
    state: SLHDSAProvisionedState,
    expectedGeneration: number
  ) =>
    withSigningQueue(state.keyId, async () => {
      const assertSession = () =>
        assertSLHDSASessionGeneration(expectedGeneration);
      assertSession();
      const crypto = getSessionStateCrypto();
      const persisted = await stateStore.load({
        crypto,
        keyId: state.keyId,
        assertOwner: assertSession,
      });
      assertSession();
      const merged = mergeSLHDSAUsageHistory(
        mergeSLHDSAUsageHistory(state, persisted),
        runtimeStates.get(state.keyId)
      );
      await stateStore.save(merged, crypto, assertSession);
      return putRuntimeSLHDSAState(merged, expectedGeneration);
    });

  const provisionRuntimeSLHDSAState = async (
    params: {
      accountIndex: number;
      derivationLabel: string;
      keyId: string;
      pkRoot: string;
      pkSeed: string;
      setupSecretHex: string;
    },
    expectedGeneration: number
  ) => {
    assertSLHDSASessionGeneration(expectedGeneration);
    const keypair = await execution.prepareKeypair(
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

  const provisionRuntimeSLHDSAStateFromSetupSecret = async (
    params: {
      accountId?: number;
      accountIndex: number;
      derivationLabel: string;
      setupJobId?: string;
      setupSecretHex: string;
    },
    expectedGeneration: number
  ) => {
    assertSLHDSASessionGeneration(expectedGeneration);
    const keypair = await execution.prepareKeypair(
      {
        accountId: params.accountId,
        ...(params.setupJobId ? { setupJobId: params.setupJobId } : {}),
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

  const clearRuntimeSLHDSAStates = () => {
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
    expectedGeneration: number,
    approval?: SLHDSADispatchApproval
  ) => {
    const assertSession = () =>
      assertSLHDSASessionGeneration(expectedGeneration);
    assertSession();
    approval?.assertCurrent();
    if (params.parameterSet !== SLH_DSA_PARAMETER_SET) {
      throw new Error(
        `Unsupported SLH-DSA parameter set ${params.parameterSet}`
      );
    }
    if (!isHexString(params.actionHash, 32)) {
      throw new Error('SLH-DSA actionHash must be a bytes32 hex string');
    }

    const runtimeState = runtimeStates.get(params.keyId);
    if (!runtimeState) {
      throw new Error(
        'SLH-DSA key is not available in this unlocked session. Provision the local PQ signer state before signing.'
      );
    }
    const crypto = getSessionStateCrypto();
    const persisted = await stateStore.load({
      crypto,
      keyId: params.keyId,
      assertOwner: assertSession,
    });
    assertSession();
    if (!persisted) {
      throw new Error(
        'SLH-DSA persisted signer state is missing; usage history is unsafe'
      );
    }
    // Keep the existing high-water policy while refusing unreadable/replaced
    // storage before handing any key material to the signing worker.
    const state = mergeSLHDSAUsageHistory(
      mergeSLHDSAUsageHistory(runtimeState, runtimeStates.get(params.keyId)),
      persisted
    );
    if (
      normalizeSLHDSAPublicKeyField(state.pkRoot).toLowerCase() !==
        normalizeSLHDSAPublicKeyField(params.pkRoot).toLowerCase() ||
      normalizeSLHDSAPublicKeyField(state.pkSeed).toLowerCase() !==
        normalizeSLHDSAPublicKeyField(params.pkSeed).toLowerCase()
    ) {
      throw new Error(
        'SLH-DSA key metadata does not match the active validator'
      );
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
    const signature = await execution.signActionHash(
      {
        ...params,
        secretKeyHex: state.secretKeyHex,
      },
      assertSession,
      ...(approval ? [approval] : [])
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
      updatedAt: now(),
    };
    runtimeStates.set(params.keyId, updatedState);
    await stateStore.save(updatedState, crypto, assertSession);
    assertSession();

    return signature;
  };

  const signSLHDSAActionHashLocal = async (
    params: SLHDSASignActionHashParams,
    expectedGeneration: number,
    approval?: SLHDSADispatchApproval
  ) => {
    const request = Object.freeze({ ...params });
    return withSigningQueue(request.keyId, () =>
      signSLHDSAActionHashLocalUnlocked(request, expectedGeneration, approval)
    );
  };

  return Object.freeze({
    getSLHDSASessionGeneration,
    assertSLHDSASessionGeneration,
    configureSLHDSASessionStateCrypto,
    putRuntimeSLHDSAState,
    registerRuntimeSLHDSAState,
    provisionRuntimeSLHDSAState,
    provisionRuntimeSLHDSAStateFromSetupSecret,
    clearRuntimeSLHDSAStates,
    signSLHDSAActionHashLocal,
  });
}
