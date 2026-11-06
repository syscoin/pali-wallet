import { createSlhDsaSigner } from '../../wallet/slhDsaSigner';

import {
  prepareSLHDSAKeypairInOffscreen,
  signSLHDSAInOffscreen,
} from './offscreenClient';
import { loadEncryptedSLHDSAState, saveEncryptedSLHDSAState } from './state';

const signer = createSlhDsaSigner({
  stateStore: {
    load: (request) => loadEncryptedSLHDSAState(request),
    save: (state, crypto, owner) =>
      saveEncryptedSLHDSAState(state, crypto, owner),
  },
  execution: {
    prepareKeypair: (request, owner) =>
      prepareSLHDSAKeypairInOffscreen(request, owner),
    signActionHash: (request, owner, approval) =>
      signSLHDSAInOffscreen(request, owner, ...(approval ? [approval] : [])),
  },
  now: () => Date.now(),
});

export const getSLHDSASessionGeneration = signer.getSLHDSASessionGeneration;
export const assertSLHDSASessionGeneration =
  signer.assertSLHDSASessionGeneration;
export const configureSLHDSASessionStateCrypto =
  signer.configureSLHDSASessionStateCrypto;
export const clearRuntimeSLHDSAStates = signer.clearRuntimeSLHDSAStates;

export const putRuntimeSLHDSAState = (
  state: Parameters<typeof signer.putRuntimeSLHDSAState>[0],
  generation = signer.getSLHDSASessionGeneration()
) => signer.putRuntimeSLHDSAState(state, generation);

export const registerRuntimeSLHDSAState = (
  state: Parameters<typeof signer.registerRuntimeSLHDSAState>[0],
  generation = signer.getSLHDSASessionGeneration()
) => signer.registerRuntimeSLHDSAState(state, generation);

export const provisionRuntimeSLHDSAState = (
  request: Parameters<typeof signer.provisionRuntimeSLHDSAState>[0],
  generation = signer.getSLHDSASessionGeneration()
) => signer.provisionRuntimeSLHDSAState(request, generation);

export const provisionRuntimeSLHDSAStateFromSetupSecret = (
  request: Parameters<
    typeof signer.provisionRuntimeSLHDSAStateFromSetupSecret
  >[0],
  generation = signer.getSLHDSASessionGeneration()
) => signer.provisionRuntimeSLHDSAStateFromSetupSecret(request, generation);

export const signSLHDSAActionHashLocal = (
  request: Parameters<typeof signer.signSLHDSAActionHashLocal>[0],
  generation = signer.getSLHDSASessionGeneration(),
  approval?: Parameters<typeof signer.signSLHDSAActionHashLocal>[2]
) => signer.signSLHDSAActionHashLocal(request, generation, approval);
