import {
  DAPP_REQUEST_LIMITS,
  measureJsonWorkBudget,
} from '../../../../source/utils/requestPayloadBudget.ts';

const MAX_STEPS = 8;
const MAX_LIFETIME_MS = 5 * 60_000;
const CALLBACK_PREFIX = 'pali://trezor-callback/';
const HEX_ID = /^[0-9a-f]{64}$/;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const SECRET_FIELDS = new Set([
  'password',
  'passphrase',
  'mnemonic',
  'seed',
  'xprv',
  'privatekey',
  'private_key',
]);

export const NATIVE_TREZOR_HANDOFF_METHODS = [
  'getFeatures',
  'getAccountInfo',
  'getPublicKey',
  'getAddress',
  'ethereumGetAddress',
  'ethereumGetPublicKey',
  'ethereumSignTransaction',
  'signTransaction',
  'ethereumSignMessage',
  'ethereumSignTypedData',
  'signMessage',
] as const;
export type NativeTrezorHandoffMethod =
  (typeof NATIVE_TREZOR_HANDOFF_METHODS)[number];
type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export type NativeTrezorResponse = Readonly<{
  success: boolean;
  payload?: Json;
  error?: Readonly<{ code: string; message: string }>;
  device?: Readonly<Record<string, Json>>;
}>;
/** Only public identity. registrationHash must cover the full saved endpoint. */
export type NativeTrezorHandoffOwner = Readonly<{
  walletFingerprint: string;
  accountId: string | null;
  accountIndex: number | null;
  accountAddress: string | null;
  network: Readonly<{
    id: string;
    kind: 'evm' | 'utxo';
    chainId: string;
    slip44: number;
    registrationHash: string;
  }>;
}>;
declare const jobBrand: unique symbol;
declare const invocationBrand: unique symbol;
export type NativeTrezorHandoffJob = Readonly<{ [jobBrand]: true }>;
export type NativeTrezorHandoffInvocation = Readonly<{
  [invocationBrand]: true;
}>;
export type NativeTrezorHandoffAdmission = Readonly<{
  sessionGeneration: number;
  assertCurrent(): void;
}>;
export type NativeTrezorHandoffSnapshot = Readonly<{
  job: NativeTrezorHandoffJob;
  owner: NativeTrezorHandoffOwner;
  workflow: 'import' | 'send';
  expiresAt: number;
  phase:
    | 'active'
    | 'awaiting-response'
    | 'retiring'
    | 'locked'
    | 'response-ready';
  completedSteps: number;
}>;
export type NativeTrezorHandoffCall = Readonly<{
  result: Promise<NativeTrezorResponse>;
  dispatch?: Readonly<{
    method: NativeTrezorHandoffMethod;
    params: Readonly<Record<string, Json>>;
    callbackUrl: string;
  }>;
}>;
type Step = {
  method: NativeTrezorHandoffMethod;
  params: Readonly<Record<string, Json>>;
  canonical: string;
  bytes: number;
  callbackId: string;
  requestId?: string;
  response?: NativeTrezorResponse;
};
type Invocation = {
  token: NativeTrezorHandoffInvocation;
  sessionGeneration: number;
  cursor: number;
  pending?: {
    resolve(value: NativeTrezorResponse): void;
    reject(error: Error): void;
  };
};
type Job = {
  token: NativeTrezorHandoffJob;
  owner: NativeTrezorHandoffOwner;
  ownerKey: string;
  workflow: 'import' | 'send';
  expiresAt: number;
  steps: Step[];
  bytes: number;
  sessionGeneration: number;
  invocation?: Invocation;
  retiring?: Promise<void>;
};
const failure = (code = 'TREZOR_HANDOFF_CANCELLED') =>
  Object.assign(new Error(code), { code });
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Callers construct allowed public SDK fields; field rejection adds defense in depth. */
function snapshotJson(value: unknown): {
  value: Json;
  canonical: string;
  bytes: number;
} {
  const bytes = measureJsonWorkBudget(value, DAPP_REQUEST_LIMITS.bytes);
  const copy = (input: unknown): Json => {
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean'
    )
      return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object')
      throw failure('TREZOR_HANDOFF_INVALID');
    if (Array.isArray(input)) {
      const result: Json[] = [];
      for (let index = 0; index < input.length; index++) {
        const property = Object.getOwnPropertyDescriptor(input, index);
        if (!property || !('value' in property))
          throw failure('TREZOR_HANDOFF_INVALID');
        result.push(copy(property.value));
      }
      return Object.freeze(result);
    }
    const result: Record<string, Json> = Object.create(null);
    for (const key of Object.keys(input).sort()) {
      if (SECRET_FIELDS.has(key.toLowerCase()))
        throw failure('TREZOR_HANDOFF_INVALID');
      const property = Object.getOwnPropertyDescriptor(input, key);
      if (!property || !('value' in property))
        throw failure('TREZOR_HANDOFF_INVALID');
      result[key] = copy(property.value);
    }
    return Object.freeze(result);
  };
  const detached = copy(value);
  return { value: detached, canonical: JSON.stringify(detached), bytes };
}
function snapshotOwner(input: NativeTrezorHandoffOwner) {
  const snapshot = snapshotJson(input);
  const value = snapshot.value as NativeTrezorHandoffOwner;
  if (
    !isObject(value) ||
    Object.keys(value).sort().join(',') !==
      'accountAddress,accountId,accountIndex,network,walletFingerprint' ||
    !HASH.test(value.walletFingerprint) ||
    (value.accountId === null) !== (value.accountIndex === null) ||
    (value.accountId !== null &&
      (typeof value.accountId !== 'string' ||
        value.accountId.length < 1 ||
        value.accountId.length > 128)) ||
    (value.accountIndex !== null &&
      (!Number.isSafeInteger(value.accountIndex) ||
        value.accountIndex < 0 ||
        value.accountIndex > 0x7fffffff)) ||
    (value.accountAddress !== null &&
      (typeof value.accountAddress !== 'string' ||
        !/^[\x21-\x7e]{1,256}$/.test(value.accountAddress))) ||
    !isObject(value.network) ||
    Object.keys(value.network).sort().join(',') !==
      'chainId,id,kind,registrationHash,slip44' ||
    typeof value.network.id !== 'string' ||
    !/^[\x21-\x7e]{1,128}$/.test(value.network.id) ||
    !['evm', 'utxo'].includes(value.network.kind) ||
    typeof value.network.chainId !== 'string' ||
    !/^[\x21-\x7e]{1,128}$/.test(value.network.chainId) ||
    !Number.isSafeInteger(value.network.slip44) ||
    value.network.slip44 < 0 ||
    value.network.slip44 > 0x7fffffff ||
    !HASH.test(value.network.registrationHash)
  )
    throw failure('TREZOR_HANDOFF_INVALID');
  return { value, canonical: snapshot.canonical };
}
function checkGuard(check: () => void) {
  const result: unknown = check();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw failure();
  }
}
function checkGeneration(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw failure('TREZOR_HANDOFF_INVALID');
}
function signing(method: NativeTrezorHandoffMethod) {
  return (
    method === 'ethereumSignTransaction' ||
    method === 'signTransaction' ||
    method === 'ethereumSignMessage' ||
    method === 'ethereumSignTypedData' ||
    method === 'signMessage'
  );
}

/**
 * Process-memory transport correlation, never custody authority. The caller supplies
 * current guards per call; none are retained. Background lock retires the invocation,
 * while an explicitly launched public job may await its response until the deadline.
 */
export class NativeTrezorHandoff {
  private job?: Job;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private poisoned = false;
  private cleanup?: Promise<void>;
  private disposal?: Promise<void>;
  private readonly closings = new WeakMap<
    NativeTrezorHandoffJob,
    Promise<void>
  >();
  private readonly retired = new WeakMap<
    NativeTrezorHandoffInvocation,
    Promise<void>
  >();
  private readonly listeners = new Set<() => void>();
  private readonly options: Readonly<{
    randomBytes(length: number): Uint8Array;
    /**
     * Drain only this process-owned transport, without a wallet/session guard.
     * Do not await coordinator teardown from cleanup: it already awaits this drain.
     */
    retireTransport(job: NativeTrezorHandoffJob): void | Promise<void>;
    now?: () => number;
  }>;
  constructor(options: NativeTrezorHandoff['options']) {
    this.options = options;
  }

  getSnapshot = (): NativeTrezorHandoffSnapshot | null => {
    const job = this.current();
    if (!job) return null;
    const pending =
      job.steps.at(-1)?.response === undefined && job.steps.length > 0;
    return Object.freeze({
      job: job.token,
      owner: job.owner,
      workflow: job.workflow,
      expiresAt: job.expiresAt,
      completedSteps: job.steps.filter((step) => step.response !== undefined)
        .length,
      phase: job.retiring
        ? 'retiring'
        : job.invocation
        ? pending
          ? 'awaiting-response'
          : 'active'
        : pending
        ? 'locked'
        : 'response-ready',
    });
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private current() {
    if (this.job && this.now() >= this.job.expiresAt) this.clear(this.job);
    return this.disposed ? undefined : this.job;
  }
  private publish() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot authorize or interrupt cleanup. */
      }
    }
  }
  private clear(job: Job): Promise<void> {
    const previous = this.closings.get(job.token);
    if (previous) return previous;
    if (this.job !== job) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const closing = new Promise<void>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    // Install the barrier before invalidation can notify reentrant observers.
    this.closings.set(job.token, closing);
    this.cleanup = closing;
    this.job = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    job.invocation?.pending?.reject(failure());
    job.invocation = undefined;
    job.steps = [];
    const work = [
      job.retiring,
      Promise.resolve().then(() => {
        const result = this.options.retireTransport(job.token);
        // A reentrant dispose/cancel returns this same installed barrier.
        if (result !== closing) return result;
      }),
    ];
    void Promise.allSettled(work).then((results) => {
      const failed = results.find((result) => result.status === 'rejected');
      if (this.cleanup === closing && !failed) this.cleanup = undefined;
      if (failed?.status === 'rejected') {
        this.poisoned = true;
        reject(failed.reason);
      } else resolve();
    });
    void closing.catch(() => undefined);
    this.publish();
    return closing;
  }
  private owned(token: NativeTrezorHandoffJob) {
    const job = this.current();
    if (!job || job.token !== token) throw failure();
    return job;
  }
  private invocation(token: NativeTrezorHandoffInvocation, guard: () => void) {
    checkGuard(guard);
    const job = this.current();
    if (!job || job.invocation?.token !== token || job.retiring)
      throw failure();
    return { job, invocation: job.invocation };
  }

  begin(
    owner: NativeTrezorHandoffOwner,
    workflow: 'import' | 'send',
    expiresAt: number,
    admission: NativeTrezorHandoffAdmission
  ) {
    checkGuard(admission.assertCurrent);
    checkGeneration(admission.sessionGeneration);
    const current = this.current();
    if (this.disposed || this.poisoned || this.cleanup || current)
      throw failure('TREZOR_HANDOFF_BUSY');
    const now = this.now();
    if (
      !Number.isFinite(now) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt - now > MAX_LIFETIME_MS ||
      !['import', 'send'].includes(workflow)
    )
      throw failure('TREZOR_HANDOFF_INVALID');
    const captured = snapshotOwner(owner);
    if (
      workflow === 'send' &&
      (captured.value.accountId === null ||
        captured.value.accountIndex === null ||
        captured.value.accountAddress === null)
    )
      throw failure('TREZOR_HANDOFF_INVALID');
    const token = Object.freeze({}) as NativeTrezorHandoffJob;
    const invocation = {
      token: Object.freeze({}) as NativeTrezorHandoffInvocation,
      sessionGeneration: admission.sessionGeneration,
      cursor: 0,
    };
    this.job = {
      token,
      owner: captured.value,
      ownerKey: captured.canonical,
      workflow,
      expiresAt,
      sessionGeneration: admission.sessionGeneration,
      steps: [],
      bytes: 0,
      invocation,
    };
    this.timer = setTimeout(() => {
      if (this.job?.token === token) this.clear(this.job);
    }, expiresAt - now);
    this.publish();
    return Object.freeze({ job: token, invocation: invocation.token });
  }

  request(
    token: NativeTrezorHandoffInvocation,
    method: NativeTrezorHandoffMethod,
    params: unknown,
    assertCurrent: () => void
  ): NativeTrezorHandoffCall {
    const { job, invocation } = this.invocation(token, assertCurrent);
    if (invocation.pending) throw failure('TREZOR_HANDOFF_BUSY');
    if (
      !NATIVE_TREZOR_HANDOFF_METHODS.includes(method) ||
      (job.workflow !== 'send' && signing(method)) ||
      (method.startsWith('ethereum') !== (job.owner.network.kind === 'evm') &&
        method !== 'getFeatures') ||
      (method === 'getAccountInfo' && job.owner.network.kind !== 'utxo')
    )
      throw failure('TREZOR_HANDOFF_INVALID');
    const captured = snapshotJson(params);
    if (!isObject(captured.value)) throw failure('TREZOR_HANDOFF_INVALID');
    this.invocation(token, assertCurrent);
    const prior = job.steps[invocation.cursor];
    if (prior) {
      if (
        prior.method !== method ||
        prior.canonical !== captured.canonical ||
        !prior.response
      )
        throw failure();
      invocation.cursor++;
      return Object.freeze({ result: Promise.resolve(prior.response) });
    }
    if (
      job.steps.length >= MAX_STEPS ||
      job.steps.some((step) => signing(step.method)) ||
      job.bytes + captured.bytes > DAPP_REQUEST_LIMITS.bytes
    )
      throw failure('TREZOR_HANDOFF_LIMIT');
    const random = this.options.randomBytes(32);
    this.invocation(token, assertCurrent);
    if (!(random instanceof Uint8Array) || random.length !== 32)
      throw failure('TREZOR_HANDOFF_INVALID');
    const callbackId = Array.from(random, (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    if (job.steps.some((step) => step.callbackId === callbackId))
      throw failure('TREZOR_HANDOFF_INVALID');
    const step: Step = {
      method,
      params: captured.value,
      canonical: captured.canonical,
      bytes: captured.bytes,
      callbackId,
    };
    job.steps.push(step);
    job.bytes += captured.bytes;
    invocation.cursor++;
    const result = new Promise<NativeTrezorResponse>((resolve, reject) => {
      invocation.pending = { resolve, reject };
    });
    // Retirement may precede the transport consumer attaching its handler.
    void result.catch(() => undefined);
    this.publish();
    try {
      this.invocation(token, assertCurrent);
    } catch (error) {
      void this.clear(job);
      throw error;
    }
    return Object.freeze({
      result,
      dispatch: Object.freeze({
        method,
        params: step.params,
        callbackUrl: CALLBACK_PREFIX + callbackId,
      }),
    });
  }

  /** Bind the Connect-generated ID before opening Suite. It never grants authority. */
  bindRequestId(
    token: NativeTrezorHandoffInvocation,
    requestId: string,
    assertCurrent: () => void
  ): void {
    const { job, invocation } = this.invocation(token, assertCurrent);
    const step = job.steps.at(-1);
    if (
      !invocation.pending ||
      !step ||
      step.requestId !== undefined ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)
    )
      throw failure('TREZOR_HANDOFF_INVALID');
    step.requestId = requestId;
  }

  /** Only the registered route and the exact pending IDs are accepted, including while locked. */
  receiveCallback(value: unknown): boolean {
    const job = this.current(),
      step = job?.steps.at(-1);
    if (
      !job ||
      !step?.requestId ||
      step.response ||
      typeof value !== 'string' ||
      value.length > DAPP_REQUEST_LIMITS.bytes * 3 + 512 ||
      !/^[\x21-\x7e]+$/.test(value)
    )
      return false;
    let response: NativeTrezorResponse;
    let bytes: number;
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'pali:' ||
        url.host !== 'trezor-callback' ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== '/' + step.callbackId ||
        !HEX_ID.test(url.pathname.slice(1))
      )
        return false;
      const parameters = [...url.searchParams];
      if (
        parameters.length !== 2 ||
        url.searchParams.getAll('id').length !== 1 ||
        url.searchParams.getAll('response').length !== 1 ||
        url.searchParams.get('id') !== step.requestId
      )
        return false;
      const raw = url.searchParams.get('response')!;
      if (raw.length > DAPP_REQUEST_LIMITS.bytes)
        throw failure('TREZOR_HANDOFF_LIMIT');
      const captured = snapshotJson(JSON.parse(raw));
      const candidate = captured.value;
      if (
        !isObject(candidate) ||
        Object.keys(candidate).some(
          (key) => !['success', 'payload', 'error', 'device'].includes(key)
        ) ||
        typeof candidate.success !== 'boolean' ||
        (candidate.device !== undefined && !isObject(candidate.device)) ||
        (candidate.success
          ? !Object.hasOwn(candidate, 'payload') ||
            candidate.error !== undefined
          : candidate.payload !== undefined ||
            !isObject(candidate.error) ||
            typeof candidate.error.code !== 'string' ||
            typeof candidate.error.message !== 'string')
      )
        throw failure('TREZOR_HANDOFF_INVALID');
      response = candidate as NativeTrezorResponse;
      bytes = captured.bytes;
      if (job.bytes + bytes > DAPP_REQUEST_LIMITS.bytes)
        throw failure('TREZOR_HANDOFF_LIMIT');
    } catch {
      this.clear(job);
      return false;
    }
    job.bytes += bytes;
    step.response = response;
    const pending = job.invocation?.pending;
    if (job.invocation) job.invocation.pending = undefined;
    pending?.resolve(response);
    this.publish();
    return true;
  }

  /**
   * Reject the old SDK invocation now; drain only that invocation's SDK resources
   * before admitting another. Cleanup must not await coordinator teardown.
   */
  retireInvocation(
    token: NativeTrezorHandoffInvocation,
    cleanup: () => void | Promise<void>
  ): Promise<void> {
    const previous = this.retired.get(token);
    if (previous) return previous;
    const job = this.current();
    if (!job || job.invocation?.token !== token)
      return Promise.reject(failure());
    const invocation = job.invocation;
    job.invocation = undefined;
    invocation.pending?.reject(failure());
    invocation.pending = undefined;
    const retirement: Promise<void> = Promise.resolve()
      .then(() => {
        const result = cleanup();
        // Teardown may reenter cancel/dispose or this same retirement. Neither
        // can become a dependency of the callback they are already draining.
        if (result !== retirement && result !== this.closings.get(job.token))
          return result;
      })
      .then(
        () => {
          if (this.job === job) {
            job.retiring = undefined;
            this.publish();
          }
        },
        (error) => {
          this.poisoned = true;
          this.clear(job);
          throw error;
        }
      )
      .finally(() => {
        if (this.cleanup === retirement) this.cleanup = undefined;
      });
    this.cleanup = retirement;
    job.retiring = retirement;
    this.retired.set(token, retirement);
    void retirement.catch(() => undefined);
    this.publish();
    return retirement;
  }

  acceptFresh(
    token: NativeTrezorHandoffJob,
    owner: NativeTrezorHandoffOwner,
    admission: NativeTrezorHandoffAdmission & { accepted: true }
  ): NativeTrezorHandoffInvocation {
    checkGuard(admission.assertCurrent);
    checkGeneration(admission.sessionGeneration);
    const job = this.owned(token);
    if (
      job.invocation ||
      job.retiring ||
      admission.accepted !== true ||
      admission.sessionGeneration <= job.sessionGeneration ||
      snapshotOwner(owner).canonical !== job.ownerKey ||
      (job.steps.length > 0 && !job.steps.at(-1)?.response)
    )
      throw failure();
    const invocation: Invocation = {
      token: Object.freeze({}) as NativeTrezorHandoffInvocation,
      sessionGeneration: admission.sessionGeneration,
      cursor: 0,
    };
    job.sessionGeneration = admission.sessionGeneration;
    job.invocation = invocation;
    this.publish();
    return invocation.token;
  }

  finish(
    token: NativeTrezorHandoffInvocation,
    assertCurrent: () => void
  ): Promise<void> {
    const { job, invocation } = this.invocation(token, assertCurrent);
    if (
      invocation.pending ||
      invocation.cursor !== job.steps.length ||
      !job.steps.length ||
      job.steps.some((step) => !step.response) ||
      (job.workflow === 'send' && !signing(job.steps.at(-1)!.method))
    )
      throw failure();
    return this.clear(job);
  }

  cancel(token: NativeTrezorHandoffJob): Promise<void> {
    const previous = this.closings.get(token);
    if (previous) return previous;
    const job = this.job?.token === token ? this.job : undefined;
    if (!job) return Promise.resolve();
    return this.clear(job);
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.listeners.clear();
    // Return the installed barrier itself: wrapping it introduces a cycle when
    // the transport cleanup reenters disposal.
    this.disposal = this.job
      ? this.clear(this.job)
      : this.cleanup ?? Promise.resolve();
    return this.disposal;
  }
}
