import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { getSLHDSAKeyId, getSLHDSAStateStorageKey, SLH_DSA_PARAMETER_SET } from '../../../../source/utils/slhDsa/constants.ts';
import { normalizeSLHDSAPublicKeyField } from '../../../../source/utils/slhDsa/hex.ts';
import type { SLHDSADispatchApproval, SLHDSAProvisionedState, SLHDSASignActionHashParams } from '../../../../source/utils/slhDsa/types.ts';
import { getSLHDSADerivationLabel } from '../../../../source/utils/slhDsa/derivation.ts';
import { createSlhDsaExecution } from '../../../../source/wallet/slhDsaExecution.ts';
import { createSlhDsaSigner } from '../../../../source/wallet/slhDsaSigner.ts';
import { createSlhDsaStateStore, parseSLHDSAStateStorageKey, type SlhDsaStateStorage } from '../../../../source/wallet/slhDsaState.ts';
import { createSlhDsaProfileStateCrypto, type SlhDsaStateCrypto } from '../../../../source/wallet/slhDsaStateCrypto.ts';
import { NativeOperationDrain } from '../custody/operationDrain.ts';
import type { NativeSlhExecutionOptions, OwnedNativeSlhExecution } from '../crypto/slhDsaNativeExecution.ts';
import { encodeStorageValue } from '../storage/json.ts';
import { WalletStorageError, type KeyringStoragePort } from '../storage/types.ts';
import type { IKeyringManager } from '@sidhujag/sysweb3-keyring';

export type NativeSlhExecutionOwner = Pick<NativeSlhExecutionOptions, 'namespace' | 'signal' | 'assertCurrent'>;
export type NativeSlhExecutionFactory = (owner: NativeSlhExecutionOwner) => OwnedNativeSlhExecution;
export type NativeSlhExecutionCapability = Readonly<{
  open: NativeSlhExecutionFactory;
  purgePublicCache(namespace: string, assertCleanupCurrent: () => void): Promise<void>;
}>;
export type NativeSlhPublicState = Readonly<Pick<SLHDSAProvisionedState,
  'accountIndex' | 'derivationLabel' | 'keyId' | 'parameterSet' | 'pkRoot' | 'pkSeed' | 'signatureCount' | 'signatureLimit'>>;
export type NativeSlhInstalledKey = Readonly<Pick<SLHDSASignActionHashParams, 'keyId' | 'parameterSet' | 'pkRoot' | 'pkSeed'>>;
type Progress = Parameters<ReturnType<typeof createSlhDsaExecution>['prepareKeypair']>[2];
type SlhKeyring = Pick<IKeyringManager,
  'deriveSLHDSASetupSecretForAccount' | 'encryptPrivateRecord' | 'decryptPrivateRecord'>;
export type NativeSlhPublicStates = Map<string, Readonly<{ state: NativeSlhPublicState; seal: string }>>;
export type NativeSlhActionSecrets = Readonly<{
  setup: Awaited<ReturnType<SlhKeyring['deriveSLHDSASetupSecretForAccount']>> | null;
  crypto: Pick<SlhKeyring, 'encryptPrivateRecord' | 'decryptPrivateRecord'>;
  dispose(): void;
}>;

const publicState = (state: SLHDSAProvisionedState): NativeSlhPublicState => Object.freeze({
  accountIndex: state.accountIndex, derivationLabel: state.derivationLabel,
  keyId: state.keyId, parameterSet: state.parameterSet, pkRoot: state.pkRoot, pkSeed: state.pkSeed,
  signatureCount: state.signatureCount, signatureLimit: state.signatureLimit,
});
const checkedPublicState = (state: SLHDSAProvisionedState): NativeSlhPublicState => {
  if (!Number.isSafeInteger(state.accountIndex) || state.accountIndex < 0 || !state.secretKeyHex ||
      state.derivationLabel !== getSLHDSADerivationLabel(state.accountIndex) ||
      state.keyId !== getSLHDSAKeyId({ pkRoot: normalizeSLHDSAPublicKeyField(state.pkRoot), pkSeed: normalizeSLHDSAPublicKeyField(state.pkSeed) }))
    throw new Error('SLH_DSA_SAVED_DERIVATION_UNAVAILABLE');
  return publicState(state);
};

/** Called only inside initial vault authentication; only public state survives. */
export async function readNativeSlhPublicStates(
  records: readonly Readonly<{ key: string; value: unknown }>[],
  keyring: Pick<SlhKeyring, 'encryptPrivateRecord' | 'decryptPrivateRecord'>,
  assertCurrent: () => void
): Promise<NativeSlhPublicStates> {
  const entries = new Map(records.map(row => [row.key, row.value]));
  const store = createSlhDsaStateStore({
    async read(key) { assertSynchronousEvmFeeGuard(assertCurrent); return entries.has(key) ? { present: true, value: entries.get(key) } : { present: false }; },
    async mutate() { throw new Error('SLH_DSA_READ_ONLY'); },
  });
  const crypto = createSlhDsaProfileStateCrypto(keyring, assertCurrent);
  const result: NativeSlhPublicStates = new Map();
  for (const row of records) {
    const keyId = parseSLHDSAStateStorageKey(row.key);
    if (keyId === null) continue;
    const state = await store.load({ keyId, crypto, assertOwner: assertCurrent });
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (!state) throw new Error('SLH_DSA_INSTALLED_STATE_MISSING');
    result.set(keyId, Object.freeze({ state: checkedPublicState(state), seal: encodeStorageValue(row.value) }));
  }
  return result;
}
const captureInstalled = (input: NativeSlhInstalledKey): NativeSlhInstalledKey => {
  const key = Object.freeze({ keyId: input.keyId, parameterSet: input.parameterSet,
    pkRoot: normalizeSLHDSAPublicKeyField(input.pkRoot), pkSeed: normalizeSLHDSAPublicKeyField(input.pkSeed) });
  if (key.parameterSet !== SLH_DSA_PARAMETER_SET || key.keyId !== getSLHDSAKeyId(key))
    throw new Error('SLH_DSA_INSTALLED_KEY_CHANGED');
  return key;
};

/** Private custody composition. Public methods never return the prepared secret or storage. */
export function createNativeSlhDsaRuntime(ports: Readonly<{
  namespace: string;
  publicStates: NativeSlhPublicStates;
  authorize<T>(purpose: 'setup' | 'sign', accountIndex: number | null, signal: AbortSignal, assertCurrent: () => void, work: (secrets: NativeSlhActionSecrets) => Promise<T>): Promise<T>;
  storage: KeyringStoragePort;
  assertCurrent(): void;
  openExecution: NativeSlhExecutionFactory;
  onStorageFault(): void;
  now(): number;
}>) {
  const { namespace, publicStates, authorize, storage, assertCurrent, openExecution, onStorageFault, now } = ports;
  if (!/^0x[0-9a-f]{64}$/.test(namespace) ||
        [assertCurrent, openExecution, onStorageFault, now, storage?.get,
        storage?.compareAndSetMany, authorize].some(value => typeof value !== 'function'))
    throw new Error('SLH_DSA_NATIVE_HOST_UNAVAILABLE');
  const drain = new NativeOperationDrain();
  const lifetime = new AbortController();
  let closed = false;
  let reportedStorageFault = false;
  const wallet = () => {
    if (closed || lifetime.signal.aborted) throw new Error('SLH_DSA_SESSION_RETIRED');
    assertSynchronousEvmFeeGuard(assertCurrent);
  };
  const fault = (error: unknown): never => {
    if (reportedStorageFault) throw error;
    // A retired wallet cannot quarantine a successor through this callback.
    wallet();
    reportedStorageFault = true;
    assertSynchronousEvmFeeGuard(onStorageFault);
    throw error;
  };
  type Observation = Readonly<{ value: unknown; seal: string | undefined }>;
  const observations = new Map<string, Observation>();
  const snapshot = (value: unknown): Observation => {
    if (value === undefined) return Object.freeze({ value: undefined, seal: undefined });
    const seal = encodeStorageValue(value);
    return Object.freeze({ value: JSON.parse(seal), seal });
  };
  const inspect = async (key: string) => {
    wallet();
    try {
      const observed = snapshot(await storage.get(key));
      wallet();
      const previous = observations.get(key);
      // Only our acknowledged CAS + exact readback advances an observation.
      // Concurrent hydration must not adopt a newer counter while old state encrypts.
      if (previous && previous.seal !== observed.seal)
        return fault(new WalletStorageError('STORAGE_CHANGED'));
      const keyId = parseSLHDSAStateStorageKey(key);
      const authenticated = keyId === null ? undefined : publicStates.get(keyId);
      if (!previous && authenticated && authenticated.seal !== observed.seal)
        return fault(new WalletStorageError('STORAGE_CHANGED'));
      if (!previous) observations.set(key, observed);
      return observed;
    } catch (error) { return fault(error); }
  };
  const commit = async (key: string, value: unknown, owner: () => void) => {
    const check = () => { wallet(); assertSynchronousEvmFeeGuard(owner); };
    check();
    const expected = observations.get(key);
    if (!expected) return fault(new WalletStorageError('STORAGE_CHANGED'));
    const next = snapshot(value);
    try {
      const committed = await storage.compareAndSetMany([{ key, expected: expected.value, value: next.value }], check);
      check();
      if (committed !== true) return fault(new WalletStorageError('STORAGE_CHANGED'));
      const actual = snapshot(await storage.get(key));
      check();
      if (actual.seal !== next.seal || observations.get(key) !== expected)
        return fault(new WalletStorageError('STORAGE_CHANGED'));
      observations.set(key, actual);
    } catch (error) { return fault(error); }
  };
  const stateStorage: SlhDsaStateStorage = {
    read: async key => {
      const observed = await inspect(key);
      return observed.value === undefined ? { present: false } : { present: true, value: observed.value };
    },
    async mutate(owner, operation) {
      wallet(); assertSynchronousEvmFeeGuard(owner);
      const result = await operation({
        read: stateStorage.read,
        write: (key, value) => commit(key, value, owner),
        remove: key => commit(key, undefined, owner),
      });
      wallet(); assertSynchronousEvmFeeGuard(owner);
      return result;
    },
  };
  const stored = createSlhDsaStateStore(stateStorage);
  type Execution = Readonly<{ engine: ReturnType<typeof createSlhDsaExecution>; native: OwnedNativeSlhExecution }>;
  let execution: Execution | undefined;
  let executionEpoch = 0;
  let contextRetirement: Promise<void> = Promise.resolve();
  const isRetired = (native: OwnedNativeSlhExecution): boolean => {
    const result: unknown = native.isRetired();
    if (result === true || result === false) return result;
    if (result && (typeof result === 'object' || typeof result === 'function')) void Promise.resolve(result).catch(() => undefined);
    throw new Error('SLH_DSA_NATIVE_HOST_UNAVAILABLE');
  };
  const refreshRetiredExecution = async () => {
    wallet();
    if (execution) {
      const retired = isRetired(execution.native);
      if (retired) {
        const previous = execution; execution = undefined;
        executionEpoch++;
        contextRetirement = Promise.all([contextRetirement, previous.native.retire()]).then(() => undefined);
      }
    }
    await contextRetirement;
    wallet();
  };
  const checkExecution = (captured: Execution) => {
    wallet();
    if (isRetired(captured.native)) throw new Error('SLH_DSA_EXECUTION_RETIRED');
  };
  const getExecution = async () => {
    wallet();
    await contextRetirement;
    wallet();
    if (execution) checkExecution(execution);
    if (!execution) {
      const native = openExecution({ namespace, signal: lifetime.signal, assertCurrent: wallet });
      if (!native || typeof native.retire !== 'function') throw new Error('SLH_DSA_NATIVE_HOST_UNAVAILABLE');
      try {
        if (typeof native.isRetired !== 'function' || typeof native.verify !== 'function') throw new Error('SLH_DSA_NATIVE_HOST_UNAVAILABLE');
        const captured = { engine: createSlhDsaExecution(native.host), native };
        checkExecution(captured);
        execution = captured;
      } catch (error) { await native.retire(); throw error; }
    }
    return execution;
  };
  let progress: Progress = () => undefined;
  let setupCheck = wallet;
  let preparing = false;
  const createSigner = (crypto: SlhDsaStateCrypto) => {
    const signer = createSlhDsaSigner({
    now,
    stateStore: {
      async load(request) {
        try { return await stored.load(request); } catch (error) { return fault(error); }
      },
      async save(state, stateCrypto, owner) {
        try {
          await stored.save(state, stateCrypto, owner);
          const observed = observations.get(getSLHDSAStateStorageKey(state.keyId));
          if (!observed?.seal) throw new Error('SLH_DSA_INSTALLED_STATE_MISSING');
          publicStates.set(state.keyId, Object.freeze({ state: checkedPublicState(state), seal: observed.seal }));
        } catch (error) { return fault(error); }
      },
    },
    execution: {
      async prepareKeypair(request, owner) {
        const captured = await getExecution();
        return captured.engine.prepareKeypair(request.setupSecretHex, () => { checkExecution(captured); setupCheck(); assertSynchronousEvmFeeGuard(owner); }, progress);
      },
      async signActionHash(request, owner, approval) {
        wallet(); assertSynchronousEvmFeeGuard(owner);
        // Match the extension: consent admits dispatch; the wallet owns usage thereafter.
        if (approval) await approval.checkDocument(true);
        wallet(); assertSynchronousEvmFeeGuard(owner);
        if (approval) assertSynchronousEvmFeeGuard(approval.assertCurrent);
        const captured = await getExecution();
        if (approval) assertSynchronousEvmFeeGuard(approval.assertCurrent);
        return (await captured.engine.signActionHash(request, () => { checkExecution(captured); assertSynchronousEvmFeeGuard(owner); })).signature;
      },
    },
    });
    signer.configureSLHDSASessionStateCrypto(crypto);
    return signer;
  };
  type Signer = ReturnType<typeof createSigner>;
  let actionTail: Promise<void> = Promise.resolve();
  const owned = <T>(purpose: 'setup' | 'sign', accountIndex: number | null, signal: AbortSignal, assertRequest: () => void,
    operation: (signer: Signer, crypto: SlhDsaStateCrypto, setup: NativeSlhActionSecrets['setup']) => Promise<T>): Promise<T> => {
    wallet();
    const finish = drain.begin();
    const work = actionTail.then(async () => {
      wallet(); assertSynchronousEvmFeeGuard(assertRequest);
      await refreshRetiredExecution();
      let entered = false, completed = false, admitted = true;
      let result: T;
      const authorization = new AbortController();
      const abort = () => authorization.abort();
      signal.addEventListener('abort', abort, { once: true });
      lifetime.signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted || lifetime.signal.aborted) abort();
      try {
        if (authorization.signal.aborted) throw new Error('SLH_DSA_SESSION_RETIRED');
        result = await authorize(purpose, accountIndex, authorization.signal, () => { wallet(); assertSynchronousEvmFeeGuard(assertRequest); }, async secrets => {
          if (!admitted || entered || authorization.signal.aborted) throw new Error('SLH_DSA_SESSION_RETIRED');
          entered = true;
          let signer: Signer | undefined;
          try {
            wallet(); assertSynchronousEvmFeeGuard(assertRequest);
            const crypto = createSlhDsaProfileStateCrypto(secrets.crypto, wallet);
            signer = createSigner(crypto);
            const value = await operation(signer, crypto, secrets.setup);
            wallet(); assertSynchronousEvmFeeGuard(assertRequest);
            completed = true; return value;
          } finally {
            signer?.clearRuntimeSLHDSAStates();
            const previous = execution; execution = undefined; executionEpoch++;
            try { if (previous) await previous.native.retire(); }
            catch (error) { fault(error); }
            finally { secrets.dispose(); }
          }
        });
        if (!entered || !completed) throw new Error('SLH_DSA_SESSION_RETIRED');
      } finally {
        admitted = false;
        signal.removeEventListener('abort', abort);
        lifetime.signal.removeEventListener('abort', abort);
      }
      wallet(); assertSynchronousEvmFeeGuard(assertRequest);
      if (signal.aborted) throw new Error('SLH_DSA_SESSION_RETIRED');
      return result;
    });
    actionTail = work.then(() => undefined, () => undefined);
    return work.finally(finish);
  };
  const loadInstalled = async (key: NativeSlhInstalledKey, assertRequest: () => void, signer: Signer, crypto: SlhDsaStateCrypto) => {
    let state: SLHDSAProvisionedState | null;
    try { state = await stored.load({ crypto, keyId: key.keyId, assertOwner: wallet }); }
    catch (error) { return fault(error); }
    wallet(); assertSynchronousEvmFeeGuard(assertRequest);
    if (!state || !state.secretKeyHex) throw new Error('SLH_DSA_INSTALLED_STATE_MISSING');
    if (normalizeSLHDSAPublicKeyField(state.pkRoot) !== key.pkRoot || normalizeSLHDSAPublicKeyField(state.pkSeed) !== key.pkSeed)
      throw new Error('SLH_DSA_INSTALLED_KEY_CHANGED');
    return signer.putRuntimeSLHDSAState(state, signer.getSLHDSASessionGeneration());
  };
  return Object.freeze({
    prepareFresh(accountIndex: number, assertRequest: () => void, onProgress: Progress, signal: AbortSignal): Promise<NativeSlhPublicState> {
      if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) return Promise.reject(new Error('SLH_DSA_ACCOUNT_CHANGED'));
      assertSynchronousEvmFeeGuard(assertRequest);
      if (preparing) return Promise.reject(new Error('SLH_DSA_SETUP_BUSY'));
      preparing = true;
      const capturedProgress = onProgress;
      return owned('setup', accountIndex, signal, assertRequest, async (signer, _crypto, setup) => {
        try {
          const admittedEpoch = executionEpoch;
          setupCheck = () => { wallet(); assertSynchronousEvmFeeGuard(assertRequest); if (admittedEpoch !== executionEpoch) throw new Error('SLH_DSA_EXECUTION_RETIRED'); };
          if (!setup) throw new Error('SLH_DSA_SAVED_DERIVATION_UNAVAILABLE');
          wallet(); assertSynchronousEvmFeeGuard(assertRequest);
          progress = value => { wallet(); assertSynchronousEvmFeeGuard(assertRequest); assertSynchronousEvmFeeGuard(() => capturedProgress(value)); };
          const state = await signer.provisionRuntimeSLHDSAStateFromSetupSecret({ accountIndex, ...setup }, signer.getSLHDSASessionGeneration());
          wallet(); assertSynchronousEvmFeeGuard(assertRequest);
          return publicState(state);
        } finally { progress = () => undefined; setupCheck = wallet; }
      }).finally(() => { preparing = false; });
    },
    inspectPrepared(keyId: string, accountIndex: number, assertRequest: () => void): Promise<NativeSlhPublicState | null> {
      wallet(); assertSynchronousEvmFeeGuard(assertRequest);
      if (!Number.isSafeInteger(accountIndex) || accountIndex < 0 || typeof keyId !== 'string' || parseSLHDSAStateStorageKey(getSLHDSAStateStorageKey(keyId)) !== keyId) throw new Error('SLH_DSA_ACCOUNT_CHANGED');
      // Authentication captured this public projection. Status verifies its
      // exact encrypted row, without decrypting signing material again.
      const finish = drain.begin();
      return (async () => {
        const row = await inspect(getSLHDSAStateStorageKey(keyId));
        wallet(); assertSynchronousEvmFeeGuard(assertRequest);
        const saved = publicStates.get(keyId);
        if (!saved && row.value === undefined) return null;
        if (!saved || saved.seal !== row.seal) return fault(new WalletStorageError('STORAGE_CHANGED'));
        return saved.state.accountIndex === accountIndex ? saved.state : null;
      })().finally(finish);
    },
    hydrateInstalled(input: NativeSlhInstalledKey, assertRequest: () => void): Promise<NativeSlhPublicState> {
      const key = captureInstalled(input);
      assertSynchronousEvmFeeGuard(assertRequest);
      const finish = drain.begin();
      return (async () => {
        const row = await inspect(getSLHDSAStateStorageKey(key.keyId));
        wallet(); assertSynchronousEvmFeeGuard(assertRequest);
        const saved = publicStates.get(key.keyId);
        if (!saved && row.value === undefined) throw new Error('SLH_DSA_INSTALLED_STATE_MISSING');
        if (!saved || saved.seal !== row.seal) return fault(new WalletStorageError('STORAGE_CHANGED'));
        if (saved.state.pkRoot !== key.pkRoot || saved.state.pkSeed !== key.pkSeed) throw new Error('SLH_DSA_INSTALLED_KEY_CHANGED');
        return saved.state;
      })().finally(finish);
    },
    rebuildInstalled(input: NativeSlhInstalledKey, assertRequest: () => void, onProgress: Progress, signal: AbortSignal): Promise<NativeSlhPublicState> {
      const key = captureInstalled(input);
      assertSynchronousEvmFeeGuard(assertRequest);
      if (preparing) return Promise.reject(new Error('SLH_DSA_SETUP_BUSY'));
      preparing = true;
      const savedPublic = publicStates.get(key.keyId)?.state;
      if (!savedPublic) { preparing = false; return Promise.reject(new Error('SLH_DSA_INSTALLED_STATE_MISSING')); }
      return owned('setup', savedPublic.accountIndex, signal, assertRequest, async (signer, crypto, setup) => {
        try {
          const admittedEpoch = executionEpoch;
          setupCheck = () => { wallet(); assertSynchronousEvmFeeGuard(assertRequest); if (admittedEpoch !== executionEpoch) throw new Error('SLH_DSA_EXECUTION_RETIRED'); };
          const saved = await loadInstalled(key, assertRequest, signer, crypto);
          if (!Number.isSafeInteger(saved.accountIndex) || saved.accountIndex < 0 || typeof saved.derivationLabel !== 'string')
            throw new Error('SLH_DSA_SAVED_DERIVATION_UNAVAILABLE');
          if (!setup) throw new Error('SLH_DSA_SAVED_DERIVATION_UNAVAILABLE');
          setupCheck();
          if (setup.derivationLabel !== saved.derivationLabel) throw new Error('SLH_DSA_SAVED_DERIVATION_UNAVAILABLE');
          progress = value => { setupCheck(); assertSynchronousEvmFeeGuard(() => onProgress(value)); };
          const restored = await signer.provisionRuntimeSLHDSAState({ ...key, ...setup, accountIndex: saved.accountIndex }, signer.getSLHDSASessionGeneration());
          setupCheck();
          if (restored.keyId !== saved.keyId || restored.signatureCount < saved.signatureCount)
            throw new Error('SLH_DSA_INSTALLED_STATE_CHANGED');
          return publicState(restored);
        } finally { progress = () => undefined; setupCheck = wallet; }
      }).finally(() => { preparing = false; });
    },
    signActionHash(input: SLHDSASignActionHashParams, approval: SLHDSADispatchApproval | null, assertDelivery: () => void, signal: AbortSignal): Promise<string> {
      const request = Object.freeze({ ...input });
      const approved = approval && Object.freeze({ assertCurrent: approval.assertCurrent.bind(approval), checkDocument: approval.checkDocument.bind(approval) });
      assertSynchronousEvmFeeGuard(assertDelivery);
      return owned('sign', null, signal, () => { assertSynchronousEvmFeeGuard(assertDelivery); if (approved) assertSynchronousEvmFeeGuard(approved.assertCurrent); }, async (signer, crypto) => {
        const admittedEpoch = executionEpoch;
        const review = () => {
          assertSynchronousEvmFeeGuard(assertDelivery);
          if (admittedEpoch !== executionEpoch) throw new Error('SLH_DSA_EXECUTION_RETIRED');
        };
        const assent: SLHDSADispatchApproval = Object.freeze({
          assertCurrent() { review(); if (approved) assertSynchronousEvmFeeGuard(approved.assertCurrent); },
          async checkDocument(recheckSite) { review(); if (approved) await approved.checkDocument(recheckSite); review(); },
        });
        await loadInstalled(captureInstalled(request), assertDelivery, signer, crypto);
        const signature = await signer.signSLHDSAActionHashLocal(request, signer.getSLHDSASessionGeneration(), assent);
        wallet(); assertSynchronousEvmFeeGuard(assertDelivery);
        return signature;
      });
    },
    retire(): Promise<void> {
      let closing: Promise<void> | undefined;
      return drain.close(() => {
        closed = true;
        lifetime.abort();
        observations.clear();
        closing = Promise.all([contextRetirement, execution?.native.retire()]).then(() => undefined);
      }, [() => closing]);
    },
  });
}

export type NativeSlhDsaRuntime = ReturnType<typeof createNativeSlhDsaRuntime>;
