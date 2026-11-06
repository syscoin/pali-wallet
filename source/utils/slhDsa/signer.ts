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

export const putRuntimeSLHDSAState = signer.putRuntimeSLHDSAState;
export const registerRuntimeSLHDSAState = signer.registerRuntimeSLHDSAState;
export const provisionRuntimeSLHDSAState = signer.provisionRuntimeSLHDSAState;
export const provisionRuntimeSLHDSAStateFromSetupSecret =
  signer.provisionRuntimeSLHDSAStateFromSetupSecret;
export const signSLHDSAActionHashLocal = signer.signSLHDSAActionHashLocal;
