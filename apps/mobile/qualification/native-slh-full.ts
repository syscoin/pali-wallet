import { assertSynchronousEvmFeeGuard } from '../../../source/shared/evmFeeGuard.ts';
import {
  getSLHDSAKeyId,
  SLH_DSA_PARAMETER_SET,
} from '../../../source/utils/slhDsa/constants.ts';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  normalizeSLHDSAPublicKeyField,
} from '../../../source/utils/slhDsa/hex.ts';
import {
  createNativeSlhExecution,
  type NativeSlhExecutionModule,
  type OwnedNativeSlhExecution,
} from '../src/crypto/slhDsaNativeExecution.ts';
import {
  createNativeSlhDsaRuntime,
  readNativeSlhPublicStates,
  type NativeSlhInstalledKey,
  type NativeSlhPublicState,
} from '../src/smartAccount/slhDsaRuntime.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type { NativeKeyringSdk } from '../src/custody/keyringSdk.ts';
import { createNativeCredentialVault, type NativeCredentialPort } from '../src/custody/credentialVault.ts';
import { decodeStorageValue } from '../src/storage/json.ts';
import { parseSLHDSAStateStorageKey } from '../../../source/wallet/slhDsaState.ts';
import { SLH_DSA_PROFILE_STATE_DOMAIN } from '../../../source/wallet/slhDsaStateCrypto.ts';
import { httpBuild } from './http-contract.ts';

export const FULL_SLH_PHASE_TIMEOUT_MS = 1_800_000;
export const FULL_SLH_CHECK = 'native full SLH execution and durable usage';
type Build = ReturnType<typeof httpBuild>;
type Keyring = InstanceType<NativeKeyringSdk['HostKeyring']>;
type Phase = 'create' | 'restart';
type Counts = {
  loads: number;
  setups: number;
  prelude: number;
  fors: number;
  finish: number;
  cached: number;
  forced: number;
};
type Signed = Readonly<{
  actionHash: string;
  signatureHash: string;
  signMs: number;
  count: number;
  verified: true;
  mutatedSignatureRefused: true;
  mutatedActionRefused: true;
  native: Counts;
}>;
export type FullSlhEvidence = Readonly<
  Build & {
    parameterSet: typeof SLH_DSA_PARAMETER_SET;
    accountIndex: 0;
    profileHash: string;
    keyIdHash: string;
    publicKey32: string;
    signatureCount: 2 | 3;
    deriveCalls: 0 | 1;
    prepared: boolean;
    canceledAdmissionDrained: boolean;
    timings: Readonly<{
      deriveSetupSecretMs: number | null;
      prepareFreshMs: number | null;
      hydrateInstalledMs: number;
    }>;
    healthy: Signed;
    fallback: Signed | null;
  }
>;
function fail(): never {
  throw Error('FULL_SLH_QUALIFICATION_FAILED');
}
const exact = (
  input: unknown,
  keys: readonly string[]
): input is Record<string, unknown> =>
  !!input &&
  typeof input === 'object' &&
  !Array.isArray(input) &&
  Object.keys(input).length === keys.length &&
  keys.every((key) => Object.hasOwn(input, key));
const hash = (input: unknown): input is string =>
  typeof input === 'string' && /^0x[0-9a-f]{64}$/.test(input);
const milliseconds = (input: unknown): input is number =>
  typeof input === 'number' &&
  Number.isFinite(input) &&
  input >= 0 &&
  input <= FULL_SLH_PHASE_TIMEOUT_MS;
const blank = (): Counts => ({
  loads: 0,
  setups: 0,
  prelude: 0,
  fors: 0,
  finish: 0,
  cached: 0,
  forced: 0,
});
const signedKeys = [
  'actionHash',
  'signatureHash',
  'signMs',
  'count',
  'verified',
  'mutatedSignatureRefused',
  'mutatedActionRefused',
  'native',
];
function signed(input: unknown, count: number, fallback: boolean): boolean {
  if (
    !exact(input, signedKeys) ||
    input.actionHash !== `0x${String(count).padStart(2, '0').repeat(32)}` ||
    !hash(input.signatureHash) ||
    !milliseconds(input.signMs) ||
    input.count !== count ||
    input.verified !== true ||
    input.mutatedSignatureRefused !== true ||
    input.mutatedActionRefused !== true ||
    !exact(input.native, Object.keys(blank()))
  )
    return false;
  const n = input.native;
  return (
    Object.values(n).every(
      (v) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10_000
    ) &&
    n.setups === 0 &&
    n.prelude === 1 &&
    (fallback ? Number(n.fors) <= 5 : n.fors === 6) &&
    n.finish === (fallback ? 0 : 1) &&
    n.cached === (fallback ? 1 : 0) &&
    n.forced === (fallback ? 1 : 0) &&
    n.loads === 1
  );
}

/** Same immutable build schema as the existing isolated HTTP/proof modes. */
export const fullSlhBuild = (value: unknown): Build => httpBuild(value);
export function readFullSlhEvidence(
  value: unknown,
  phase: Phase,
  build: Build
): FullSlhEvidence {
  if (!['create', 'restart'].includes(phase)) fail();
  if (
    !exact(value, [
      'version',
      'sourceRevision',
      'lockfileSha256',
      'parameterSet',
      'accountIndex',
      'profileHash',
      'keyIdHash',
      'publicKey32',
      'signatureCount',
      'deriveCalls',
      'prepared',
      'canceledAdmissionDrained',
      'timings',
      'healthy',
      'fallback',
    ]) ||
    value.version !== build.version ||
    value.sourceRevision !== build.sourceRevision ||
    value.lockfileSha256 !== build.lockfileSha256 ||
    value.parameterSet !== SLH_DSA_PARAMETER_SET ||
    value.accountIndex !== 0 ||
    !hash(value.profileHash) ||
    !hash(value.keyIdHash) ||
    !hash(value.publicKey32) ||
    value.signatureCount !== (phase === 'create' ? 2 : 3) ||
    value.deriveCalls !== (phase === 'create' ? 1 : 0) ||
    value.prepared !== (phase === 'create') ||
    value.canceledAdmissionDrained !== (phase === 'create') ||
    !exact(value.timings, [
      'deriveSetupSecretMs',
      'prepareFreshMs',
      'hydrateInstalledMs',
    ]) ||
    !milliseconds(value.timings.hydrateInstalledMs) ||
    (phase === 'create'
      ? !milliseconds(value.timings.deriveSetupSecretMs) ||
        !milliseconds(value.timings.prepareFreshMs) ||
        value.timings.deriveSetupSecretMs > value.timings.prepareFreshMs
      : value.timings.deriveSetupSecretMs !== null ||
        value.timings.prepareFreshMs !== null) ||
    !signed(value.healthy, phase === 'create' ? 1 : 3, false) ||
    (phase === 'create'
      ? !signed(value.fallback, 2, true)
      : value.fallback !== null)
  )
    fail();
  if (
    phase === 'create' &&
    (value.healthy as Signed).signatureHash ===
      (value.fallback as Signed).signatureHash
  )
    fail();
  return Object.freeze(value) as FullSlhEvidence;
}
export function matchesFullSlhRestart(
  created: unknown,
  restored: unknown,
  build: Build
): boolean {
  try {
    const a = readFullSlhEvidence(created, 'create', build),
      b = readFullSlhEvidence(restored, 'restart', build);
    return (
      a.publicKey32 === b.publicKey32 &&
      a.profileHash === b.profileHash &&
      a.keyIdHash === b.keyIdHash &&
      a.healthy.signatureHash !== b.healthy.signatureHash
    );
  } catch {
    return false;
  }
}
const installed = (publicKey32: string): NativeSlhInstalledKey => {
  if (!hash(publicKey32)) fail();
  const bytes = hexToBytes(publicKey32);
  const fields = {
    pkSeed: normalizeSLHDSAPublicKeyField(bytesToHex(bytes.subarray(0, 16))),
    pkRoot: normalizeSLHDSAPublicKeyField(bytesToHex(bytes.subarray(16))),
  };
  return Object.freeze({
    ...fields,
    parameterSet: SLH_DSA_PARAMETER_SET,
    keyId: getSLHDSAKeyId(fields),
  });
};
const publicKey = (state: NativeSlhPublicState) =>
  bytesToHex(
    concatBytes(
      hexToBytes(state.pkSeed).subarray(0, 16),
      hexToBytes(state.pkRoot).subarray(0, 16)
    )
  );

export class FullSlhForsTracker {
  private active = 0;
  get inFlight(): number {
    return this.active;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
  assertDrained(): void {
    if (this.active !== 0) fail();
  }
}
const diagnosticStages = [
  'setup',
  'cancel',
  'healthy',
  'fallback',
  'restart',
] as const;
const diagnosticPoints = [
  'entry',
  'execution',
  'load',
  'leaf',
  'tree',
  'write',
  'publish',
  'prepared',
  'prelude',
  'fors',
  'cached',
  'signature',
  'verification',
  'complete',
] as const;
export type FullSlhDiagnostic = Readonly<{
  stage: (typeof diagnosticStages)[number];
  point: (typeof diagnosticPoints)[number];
  native: Readonly<Counts>;
  inFlightFors: number;
  signalAborted: boolean;
  executionState: 'not-open' | 'active' | 'retired' | 'unknown';
}>;
export function readFullSlhDiagnostic(value: unknown): FullSlhDiagnostic {
  if (
    !exact(value, [
      'stage',
      'point',
      'native',
      'inFlightFors',
      'signalAborted',
      'executionState',
    ]) ||
    !diagnosticStages.includes(value.stage as FullSlhDiagnostic['stage']) ||
    !diagnosticPoints.includes(value.point as FullSlhDiagnostic['point']) ||
    !exact(value.native, Object.keys(blank())) ||
    !Object.values(value.native).every(
      (v) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10000
    ) ||
    !Number.isSafeInteger(value.inFlightFors) ||
    Number(value.inFlightFors) < 0 ||
    Number(value.inFlightFors) > 6 ||
    typeof value.signalAborted !== 'boolean' ||
    typeof value.executionState !== 'string' ||
    !['not-open', 'active', 'retired', 'unknown'].includes(value.executionState)
  )
    fail();
  return value as unknown as FullSlhDiagnostic;
}

/** Fixed public fixture only. Every cryptographic primitive delegates to the real native host. */
export async function qualifyNativeSlhFull(
  ports: Readonly<{
    phase: Phase;
    build: Build;
    keyring: Keyring;
    credentialPort: NativeCredentialPort;
    signal: AbortSignal;
    storage: OpenWalletStorage;
    productionCapability: null;
    nativeModule: NativeSlhExecutionModule;
    previous: FullSlhEvidence | null;
    assertCurrent(): void;
    onStorageFault(): void;
    onDiagnostic(value: FullSlhDiagnostic): void;
    randomFill(bytes: Uint8Array): void;
    yield(): Promise<void>;
    digest(bytes: Uint8Array): Promise<Uint8Array>;
    now(): number;
  }>
): Promise<FullSlhEvidence> {
  if (
    ports.productionCapability !== null ||
    typeof ports.now !== 'function' ||
    typeof ports.onDiagnostic !== 'function' ||
    !['create', 'restart'].includes(ports.phase) ||
    (ports.phase === 'create'
      ? ports.previous !== null
      : ports.previous === null)
  )
    fail();
  let stage: FullSlhDiagnostic['stage'] =
    ports.phase === 'create' ? 'setup' : 'restart';
  let counts = blank(),
    forceFors = false,
    admitted: (() => void) | undefined;
  let native: OwnedNativeSlhExecution | undefined;
  const forsTracker = new FullSlhForsTracker();
  let lastPoint: FullSlhDiagnostic['point'] = 'entry';
  const diagnose = (point: FullSlhDiagnostic['point'] = lastPoint) => {
    lastPoint = point;
    let executionState: FullSlhDiagnostic['executionState'] = 'not-open';
    if (native) {
      try {
        executionState = native.isRetired() ? 'retired' : 'active';
      } catch {
        executionState = 'unknown';
      }
    }
    ports.onDiagnostic(
      Object.freeze({
        stage,
        point,
        native: Object.freeze({ ...counts }),
        inFlightFors: forsTracker.inFlight,
        signalAborted: ports.signal.aborted,
        executionState,
      })
    );
  };
  diagnose('entry');
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  check();
  const unlocked = ports.keyring.capturePublicSessionGuard();
  const owner = () => {
    check();
    assertSynchronousEvmFeeGuard(unlocked);
    if (!ports.keyring.hasPublicSession()) fail();
  };
  owner();
  const identity = await ports.storage.recovery?.readIdentity();
  owner();
  const namespace = identity?.root?.profileId;
  if (
    !identity?.root ||
    identity.root.profileId !== namespace ||
    typeof namespace !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(namespace)
  )
    fail();
  const vault = createNativeCredentialVault(ports.storage.credential, ports.credentialPort);
  const withSecret = async <T>(signal: AbortSignal, guard: () => void, work: () => Promise<T>): Promise<T> => {
    let authenticated = false;
    const result = await ports.keyring.withSecretOperation({ async withSecret(sdkCheck, consume) {
      const check = () => { owner(); assertSynchronousEvmFeeGuard(guard); assertSynchronousEvmFeeGuard(sdkCheck); };
      await vault.withSecret({ purpose: 'transaction', signal, assertCurrent: check }, async secret => { authenticated = true; await consume(secret); });
    } }, { signal, assertCurrent: () => { owner(); assertSynchronousEvmFeeGuard(guard); } }, async () => {
      if (!authenticated) fail();
      owner();
      return work();
    });
    owner(); if (ports.keyring.isUnlocked()) fail();
    return result;
  };
  const publicStates = await withSecret(ports.signal, owner, async () => {
    if (await ports.keyring.getPrivateRecordProfileId() !== namespace) fail();
    const snapshot = await ports.storage.recovery!.readSnapshot(); owner();
    return readNativeSlhPublicStates(snapshot.records.filter(row => parseSLHDSAStateStorageKey(row.key) !== null)
      .map(row => ({ key: row.key, value: decodeStorageValue(row.value) })), ports.keyring, owner);
  });
  const digest = async (bytes: Uint8Array) => {
    owner();
    const result = await ports.digest(bytes);
    owner();
    if (result.length !== 32) fail();
    return bytesToHex(result);
  };
  const profileHash = await digest(new TextEncoder().encode(namespace));
  let lastTime = 0;
  const clock = () => {
    const value = ports.now();
    if (!Number.isFinite(value) || value < lastTime) fail();
    lastTime = value;
    return value;
  };
  const elapsed = (start: number) => {
    const value = clock() - start;
    if (!milliseconds(value)) fail();
    return value;
  };
  let deriveSetupSecretMs: number | null = null,
    prepareFreshMs: number | null = null,
    hydrateInstalledMs = 0;
  const openExecution: Parameters<
    typeof createNativeSlhDsaRuntime
  >[0]['openExecution'] = (captured) => {
    owner();
    const actual = createNativeSlhExecution(ports.nativeModule, {
      ...captured,
      randomFill: ports.randomFill,
      yield: ports.yield,
    });
    native = actual;
    diagnose('execution');
    const base = actual.host;
    return Object.freeze({
      ...actual,
      host: Object.freeze({
        ...base,
        async loadTree(id: string) {
          counts.loads++;
          diagnose('load');
          return base.loadTree(id);
        },
        async openSetup(seed: Uint8Array) {
          counts.setups++;
          const setup = await base.openSetup(seed);
          return { ...setup, buildChunk(...args: Parameters<typeof setup.buildChunk>) {
            diagnose('tree');
            return setup.buildChunk(...args);
          } };
        },
        createLeafLanes(count: number) {
          return base.createLeafLanes(count).map(lane => ({
            buildLeaves(...args: Parameters<typeof lane.buildLeaves>) {
              diagnose('leaf');
              return lane.buildLeaves(...args);
            },
            dispose: () => lane.dispose(),
          }));
        },
        writeTree(...args: Parameters<typeof base.writeTree>) {
          diagnose('write');
          return base.writeTree(...args);
        },
        saveTree(...args: Parameters<typeof base.saveTree>) {
          diagnose('publish');
          return base.saveTree(...args);
        },
        async signPrelude(...args: Parameters<typeof base.signPrelude>) {
          counts.prelude++;
          diagnose('prelude');
          const pending = base.signPrelude(...args);
          if (stage === 'cancel') {
            const notify = admitted;
            admitted = undefined;
            notify?.();
          }
          return pending;
        },
        async signForsTree(...args: Parameters<typeof base.signForsTree>) {
          if (forceFors) {
            forceFors = false;
            counts.forced++;
            throw Error('FULL_SLH_BEFORE_NATIVE_FORS');
          }
          counts.fors++;
          return forsTracker.run(async () => {
            diagnose('fors');
            return base.signForsTree(...args);
          });
        },
        async finishSignature(
          ...args: Parameters<typeof base.finishSignature>
        ) {
          counts.finish++;
          return base.finishSignature(...args);
        },
        async signCached(...args: Parameters<typeof base.signCached>) {
          forsTracker.assertDrained();
          counts.cached++;
          diagnose('cached');
          return base.signCached(...args);
        },
      }),
    });
  };
  let deriveCalls = 0;
  const derive = async (request: { accountIndex: number }) => {
      owner();
      if (
        ports.phase !== 'create' ||
        request.accountIndex !== 0 ||
        deriveCalls !== 0
      )
        fail();
      deriveCalls++;
      const start = clock();
      const result = await ports.keyring.deriveSLHDSASetupSecretForAccount(
        request
      );
      deriveSetupSecretMs = elapsed(start);
      owner();
      return result;
  };
  const create = () =>
    createNativeSlhDsaRuntime({
      namespace,
      publicStates,
      async authorize(_purpose, accountIndex, signal, guard, work) {
        let access: Awaited<ReturnType<Keyring['createPrivateRecordAccess']>> | undefined;
        try {
          return await withSecret(signal, guard, async () => {
            access = await ports.keyring.createPrivateRecordAccess([SLH_DSA_PROFILE_STATE_DOMAIN], { transferable: false });
            const setup = accountIndex === null ? null : await derive({ accountIndex });
            try { return await work(Object.freeze({ setup, crypto: access, dispose() { access?.dispose(); access = undefined; } })); }
            finally { access?.dispose(); access = undefined; }
          });
        } catch (error) { access?.dispose(); throw error; }
      },
      storage: ports.storage.keyringStorage,
      assertCurrent: owner,
      openExecution,
      onStorageFault: ports.onStorageFault,
      now: Date.now,
    });
  let runtime = create();
  try {
    let state: NativeSlhPublicState;
    if (ports.phase === 'create') {
      const start = clock();
      // Includes SDK/seed derivation, XMSS cache generation and durable setup.
      state = await runtime.prepareFresh(0, owner, () => {
        owner();
      }, ports.signal, null);
      prepareFreshMs = elapsed(start);
      diagnose('prepared');
      owner();
      if (
        state.accountIndex !== 0 ||
        state.signatureCount !== 0 ||
        counts.setups !== 1
      )
        fail();
      const key = installed(publicKey(state));
      stage = 'cancel';
      const admission = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      let delivered = false;
      const pending = runtime
        .signActionHash(
          { ...key, actionHash: `0x${'09'.repeat(32)}` },
          null,
          owner,
          ports.signal
        , null)
        .then(
          () => {
            delivered = true;
          },
          () => undefined
        );
      // The marker means admitted to the real native primitive port, not C-start.
      await Promise.race([admission, pending.then(() => fail())]);
      owner();
      const retirement = runtime.retire();
      await pending;
      await retirement;
      owner();
      if (delivered || !native?.isRetired()) fail();
      runtime = create();
      stage = 'healthy';
      counts = blank();
      const hydrateStart = clock();
      state = await runtime.hydrateInstalled(key, owner);
      hydrateInstalledMs = elapsed(hydrateStart);
      owner();
      if (state.signatureCount !== 0) fail();
    } else {
      const previous = readFullSlhEvidence(
        ports.previous,
        'create',
        ports.build
      );
      if (previous.profileHash !== profileHash) fail();
      const key = installed(previous.publicKey32);
      if (
        (await digest(new TextEncoder().encode(key.keyId))) !==
        previous.keyIdHash
      )
        fail();
      const hydrateStart = clock();
      state = await runtime.hydrateInstalled(key, owner);
      hydrateInstalledMs = elapsed(hydrateStart);
      owner();
      if (state.signatureCount !== 2) fail();
    }
    if (
      state.accountIndex !== 0 ||
      state.parameterSet !== SLH_DSA_PARAMETER_SET
    )
      fail();
    const key = installed(publicKey(state)),
      publicBytes = hexToBytes(publicKey(state));
    const verifySign = async (
      byte: string,
      expected: number
    ): Promise<Signed> => {
      const actionHash = `0x${byte.repeat(32)}`;
      diagnose('signature');
      const start = clock();
      const signatureHex = await runtime.signActionHash(
        { ...key, actionHash },
        null,
        owner,
        ports.signal
      , null);
      // Includes signer state/cache I/O and usage persistence; excludes the
      // following verifier calls, mutation checks, readback and report digest.
      const signMs = elapsed(start);
      diagnose('verification');
      owner();
      const signature = hexToBytes(signatureHex),
        action = hexToBytes(actionHash);
      const verifier = createNativeSlhExecution(ports.nativeModule, { namespace, signal: ports.signal,
        assertCurrent: owner, randomFill: ports.randomFill, yield: ports.yield });
      try {
      if (
        signature.length !== 3856 ||
        !verifier ||
        !(await verifier.verify(publicBytes, action, signature))
      )
        fail();
      owner();
      const mutated = signature.slice();
      mutated[0] = mutated[0]! ^ 1;
      if (await verifier.verify(publicBytes, action, mutated)) fail();
      owner();
      const wrongAction = action.slice();
      wrongAction[0] = wrongAction[0]! ^ 1;
      if (await verifier.verify(publicBytes, wrongAction, signature)) fail();
      owner();
      } finally { await verifier.retire(); }
      state = await runtime.hydrateInstalled(key, owner);
      owner();
      if (state.signatureCount !== expected) fail();
      return Object.freeze({
        actionHash,
        signatureHash: await digest(signature),
        signMs,
        count: expected,
        verified: true,
        mutatedSignatureRefused: true,
        mutatedActionRefused: true,
        native: Object.freeze({ ...counts }),
      });
    };
    const healthy = await verifySign(
      ports.phase === 'create' ? '01' : '03',
      ports.phase === 'create' ? 1 : 3
    );
    let fallback: Signed | null = null;
    if (ports.phase === 'create') {
      stage = 'fallback';
      forceFors = true;
      counts = blank();
      fallback = await verifySign('02', 2);
    }
    const result = readFullSlhEvidence(
      {
        ...ports.build,
        parameterSet: SLH_DSA_PARAMETER_SET,
        accountIndex: 0,
        profileHash,
        keyIdHash: await digest(new TextEncoder().encode(key.keyId)),
        publicKey32: publicKey(state),
        signatureCount: state.signatureCount,
        deriveCalls,
        prepared: ports.phase === 'create',
        canceledAdmissionDrained: ports.phase === 'create',
        timings: Object.freeze({
          deriveSetupSecretMs,
          prepareFreshMs,
          hydrateInstalledMs,
        }),
        healthy,
        fallback,
      },
      ports.phase,
      ports.build
    );
    diagnose('complete');
    return result;
  } catch (error) {
    diagnose();
    throw error;
  } finally {
    await runtime.retire();
  }
}
