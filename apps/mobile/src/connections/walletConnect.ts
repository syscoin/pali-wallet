import {
  assertJsonWorkBudget,
  assertProviderRequestBudget,
  DAPP_REQUEST_LIMITS,
} from '../../../../source/utils/requestPayloadBudget.ts';
import { getDappOrigin } from '../../../../source/utils/dappOrigin.ts';
import { CONNECTION_RECORD_LIMITS } from '../storage/connectionRecordKey.ts';
import type {
  NativeConnectionBinding,
  NativeConnectionRepository,
} from './storage.ts';

type Metadata = Readonly<{
  name: string;
  description: string;
  url: string;
  icons: readonly string[];
}>;
type Namespace = Readonly<{
  accounts: readonly string[];
  methods: readonly string[];
  events: readonly string[];
  chains?: readonly string[];
}>;
type MutableNamespaces = Record<string, {
  accounts: string[];
  methods: string[];
  events: string[];
  chains?: string[];
}>;
export type WalletConnectNamespaces = Readonly<Record<string, Namespace>>;
export type WalletConnectVerification = Readonly<{
  validation: 'VALID' | 'INVALID' | 'UNKNOWN';
  isScam: boolean;
}>;
export type WalletConnectProposal = Readonly<{
  id: number;
  pairingTopic: string;
  peerPublicKey: string;
  metadata: Metadata;
  verification: WalletConnectVerification;
  requiredNamespaces: Readonly<Record<string, unknown>>;
  optionalNamespaces: Readonly<Record<string, unknown>>;
}>;
export type WalletConnectSession = Readonly<{
  binding: NativeConnectionBinding;
  metadata: Metadata;
  expiry: number;
  namespaces: WalletConnectNamespaces;
}>;
export type WalletConnectRequest = Readonly<{
  /** Derived only by this SDK adapter; omission never grants hardware admission. */
  freshness: 'fresh' | 'unproven';
  id: number;
  expiresAt: number;
  session: WalletConnectSession;
  chainId: string;
  method: string;
  params: unknown;
  verification: WalletConnectVerification;
}>;
export type WalletConnectTransportEvent =
  | Readonly<{ type: 'proposal'; proposal: WalletConnectProposal }>
  | Readonly<{ type: 'request'; request: WalletConnectRequest }>
  | Readonly<{ type: 'session'; session: WalletConnectSession }>
  | Readonly<{ type: 'session-ended'; topic: string }>
  | Readonly<{ type: 'proposal-expired'; id: number }>
  | Readonly<{ type: 'request-expired'; id: number }>
  | Readonly<{ type: 'unavailable' }>;
type EventName =
  | 'session_proposal'
  | 'session_request'
  | 'session_update'
  | 'session_delete'
  | 'session_expire'
  | 'proposal_expire'
  | 'session_request_expire';
type Reason = Readonly<{ code: number; message: string; data?: string }>;
export type WalletConnectResponse = Readonly<
  { result: unknown } | { error: Reason }
>;

interface CoreClient {
  dispose(): Promise<void>;
  storage: NativeConnectionRepository['transport'];
  history: { readonly values: unknown[]; readonly records: ReadonlyMap<number, unknown>; get(topic: string, id: number): Promise<unknown> };
  pairing: {
    pairings: { getAll(): unknown[] };
    disconnect(input: { topic: string }): Promise<void>;
  };
}
interface SignClient {
  dispose(): Promise<void>;
  core: CoreClient;
  session: { get(topic: string): unknown; getAll(): unknown[] };
  proposal: { get(id: number): unknown; getAll(): unknown[] };
  pendingRequest: { get(id: number): unknown };
  getPendingSessionRequests(): unknown[];
  on(event: EventName, listener: (value: unknown) => void): unknown;
  off(event: EventName, listener: (value: unknown) => void): unknown;
  pair(input: { uri: string }): Promise<unknown>;
  approve(input: {
    id: number;
    namespaces: MutableNamespaces;
  }): Promise<{ topic: string; acknowledged(): Promise<unknown> }>;
  update(input: { topic: string; namespaces: MutableNamespaces }): Promise<{
    acknowledged(): Promise<void>;
  }>;
  reject(input: { id: number; reason: Reason }): Promise<void>;
  respond(input: {
    topic: string;
    response: { id: number; jsonrpc: '2.0' } & (
      | { result: unknown }
      | { error: Reason }
    );
  }): Promise<void>;
  disconnect(input: { topic: string; reason: Reason }): Promise<void>;
  emit(input: {
    topic: string;
    chainId: string;
    event: { name: string; data: unknown };
  }): Promise<void>;
}
/** The loader requires the reviewed public Core/SignClient disposal contract. */
export type WalletConnectSdk = Readonly<{
  requestExpirySeconds: Readonly<{ min: number; max: number }>;
  createCore(input: {
    projectId: string;
    storage: NativeConnectionRepository['transport'];
    telemetryEnabled: false;
    logger: 'silent';
  }): CoreClient;
  initialize(input: {
    core: CoreClient;
    metadata: Metadata;
    logger: 'silent';
  }): Promise<SignClient>;
  parseUri(value: string): {
    topic: string;
    version: number;
    symKey: string;
    relay: { protocol: string };
    expiryTimestamp?: number;
  };
}>;
export type WalletConnectPairing = Readonly<{
  topic: string;
  expiresAt: number;
  cancel(): Promise<void>;
}>;
export type WalletConnectTransport = Readonly<{
  pair(
    uri: string,
    assertPairingCurrent: () => void,
    onPairing: (pairing: WalletConnectPairing) => void
  ): Promise<WalletConnectPairing>;
  approve(
    proposal: WalletConnectProposal,
    namespaces: WalletConnectNamespaces,
    assertApprovalCurrent: () => void
  ): Promise<WalletConnectSession>;
  reject(proposal: WalletConnectProposal, reason: Reason): Promise<void>;
  respond(
    binding: NativeConnectionBinding,
    id: number,
    response: WalletConnectResponse,
    assertRequestCurrent: () => void,
    onDispatch: () => void
  ): Promise<void>;
  updatePreparedAccount(
    binding: NativeConnectionBinding,
    id: number,
    address: string,
    signal: AbortSignal,
    assertRequestCurrent: () => void,
    onCommitted: (session: WalletConnectSession) => void
  ): Promise<WalletConnectSession>;
  disconnect(binding: NativeConnectionBinding): Promise<void>;
  emit(
    binding: NativeConnectionBinding,
    chainId: string,
    event: { name: string; data: unknown },
    assertCurrent: () => void
  ): Promise<void>;
  /** Same live adapter only: never creates an admission from saved public data. */
  pending(binding: NativeConnectionBinding, id: number, assertCurrent: () => void): Promise<WalletConnectRequest | null>;
  sessions(): Promise<readonly WalletConnectSession[]>;
  close(): Promise<void>;
}>;
export class WalletConnectTransportError extends Error {
  constructor() {
    super('CONNECTION_UNAVAILABLE');
    this.name = 'WalletConnectTransportError';
  }
}
// Retain the original cleanup cause privately; caller-supplied fields cannot brand it.
const cleanupFailures = new WeakMap<object, unknown>();
export function isWalletConnectCleanupFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && cleanupFailures.has(error)
  );
}
const fail = (): never => {
  throw new WalletConnectTransportError();
};
const HEX = /^[0-9a-f]{64}$/;
const MAX_PENDING_EVENTS = DAPP_REQUEST_LIMITS.pendingRequests;
const MAX_REQUESTS_PER_PEER = DAPP_REQUEST_LIMITS.requestsPerOrigin;
const MAX_PENDING_REQUEST_BYTES = 4 * DAPP_REQUEST_LIMITS.bytes;
const MAX_SEEN_REQUEST_IDS = CONNECTION_RECORD_LIMITS.nodes;
const DISCONNECT_REASON = Object.freeze({
  code: 6000,
  message: 'User disconnected',
});
const copy = <T>(value: T, bytes = 64 * 1024): T => {
  assertJsonWorkBudget(value, bytes);
  const text = JSON.stringify(value);
  return text === undefined ? fail() : (JSON.parse(text) as T);
};
const immutable = <T>(value: T): T => {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === 'object') {
      pending.push(...Object.values(item));
      Object.freeze(item);
    }
  }
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
};
function metadata(value: unknown): Metadata {
  const data = record(copy(value));
  if (
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 256 ||
    typeof data.description !== 'string' ||
    data.description.length > 2048 ||
    typeof data.url !== 'string' ||
    data.url.length > 2048 ||
    !getDappOrigin(data.url) ||
    !Array.isArray(data.icons) ||
    data.icons.length > 8 ||
    data.icons.some((icon) => typeof icon !== 'string' || icon.length > 2048)
  )
    return fail();
  return Object.freeze({
    name: data.name,
    description: data.description,
    url: data.url,
    icons: Object.freeze([...data.icons]) as string[],
  });
}
function checkedId(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fail();
}
function checkedTopic(value: unknown): string {
  return typeof value === 'string' && HEX.test(value) ? value : fail();
}

/** SDK evidence belongs to this event and never replaces the peer's permission origin. */
function readVerification(
  value: unknown,
  metadataUrl: string
): WalletConnectVerification {
  let verified: Record<string, unknown>;
  try {
    verified = record(record(value).verified);
  } catch {
    return Object.freeze({ validation: 'UNKNOWN', isScam: false });
  }
  const isScam = verified.isScam === true;
  if (verified.validation === 'INVALID')
    return Object.freeze({ validation: 'INVALID', isScam });
  const origin =
    typeof verified.origin === 'string' && verified.origin.length <= 2048
      ? getDappOrigin(verified.origin)
      : null;
  const validShape =
    origin !== null &&
    verified.origin === origin &&
    typeof verified.verifyUrl === 'string' &&
    verified.verifyUrl.length <= 2048 &&
    getDappOrigin(verified.verifyUrl) !== null &&
    (verified.isScam === undefined || typeof verified.isScam === 'boolean');
  let validation: WalletConnectVerification['validation'] = 'UNKNOWN';
  if (validShape && verified.validation === 'VALID')
    validation = origin === getDappOrigin(metadataUrl) ? 'VALID' : 'INVALID';
  return Object.freeze({ validation, isScam });
}
function namespaces(value: unknown): WalletConnectNamespaces {
  const data = record(copy(value));
  for (const [name, raw] of Object.entries(data)) {
    if (!/^[a-z0-9]+(?::[a-zA-Z0-9_-]+)?$/.test(name)) return fail();
    const item = record(raw);
    for (const field of ['accounts', 'methods', 'events']) {
      if (
        !Array.isArray(item[field]) ||
        item[field].length > 64 ||
        item[field].some(
          (value) => typeof value !== 'string' || !value || value.length > 256
        )
      )
        return fail();
    }
    if (
      item.chains !== undefined &&
      (!Array.isArray(item.chains) ||
        item.chains.length > 64 ||
        item.chains.some(
          (chain) => typeof chain !== 'string' || chain.length > 256
        ))
    )
      return fail();
    Object.freeze(item.accounts);
    Object.freeze(item.methods);
    Object.freeze(item.events);
    if (item.chains) Object.freeze(item.chains);
    Object.freeze(item);
  }
  return Object.freeze(data) as WalletConnectNamespaces;
}
function session(value: unknown): WalletConnectSession {
  const data = record(copy(value));
  const peer = record(data.peer),
    details = metadata(peer.metadata);
  if (!Number.isSafeInteger(data.expiry) || Number(data.expiry) <= 0)
    return fail();
  return Object.freeze({
    binding: Object.freeze({
      topic: checkedTopic(data.topic),
      peerPublicKey: checkedTopic(peer.publicKey),
      origin: getDappOrigin(details.url)!,
    }),
    metadata: details,
    expiry: Number(data.expiry),
    namespaces: namespaces(data.namespaces),
  });
}
function sameBinding(
  a: NativeConnectionBinding,
  b: NativeConnectionBinding
): boolean {
  return (
    a.topic === b.topic &&
    a.peerPublicKey === b.peerPublicKey &&
    a.origin === b.origin
  );
}
async function officialSdk(): Promise<WalletConnectSdk> {
  const [
    { Core },
    { SignClient: Client, SESSION_REQUEST_EXPIRY_BOUNDARIES },
    { parseUri },
  ] = await Promise.all([
    import('@walletconnect/core'),
    import('@walletconnect/sign-client'),
    import('@walletconnect/utils'),
  ]);
  return {
    requestExpirySeconds: SESSION_REQUEST_EXPIRY_BOUNDARIES,
    createCore: (input) => new Core(input),
    initialize: (input) => {
      if (!(input.core instanceof Core)) return fail();
      return Client.init({
        ...input,
        core: input.core,
        metadata: { ...input.metadata, icons: [...input.metadata.icons] },
      });
    },
    parseUri,
  };
}

/** Transport only. Permissions and every signing decision remain with the shared wallet owner. */
export async function openWalletConnectTransport(options: {
  projectId: string;
  metadata: Metadata;
  repository: Pick<NativeConnectionRepository, 'assertHealthy' | 'transport'>;
  supportedMethods: readonly string[];
  supportedEvents: readonly string[];
  assertOwner(): void;
  preparePlatform(): Promise<void>;
  signal: AbortSignal;
  onEvent(event: WalletConnectTransportEvent): void;
  loadSdk?: () => Promise<WalletConnectSdk>;
}): Promise<WalletConnectTransport> {
  const { repository } = options;
  let closed = false,
    closePromise: Promise<void> | undefined;
  let core: CoreClient | undefined, client: SignClient | undefined;
  let creating: Promise<CoreClient> | undefined;
  let initializing: Promise<SignClient> | undefined;
  let eventTail: Promise<void> = Promise.resolve();
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new WalletConnectTransportError());
  });
  void aborted.catch(() => undefined);
  const owned = <T>(promise: Promise<T>) => Promise.race([promise, aborted]);
  const listeners = new Map<EventName, (value: unknown) => void>();
  const proposals = new Map<number, WalletConnectProposal>();
  const requests = new Map<string, Readonly<{ serialized: string; wire: WalletConnectRequest; session: string; history: unknown }>>();
  const dispatchedRequests = new Set<string>();
  const preparedAccountAttempts = new WeakSet<WalletConnectRequest>();
  const updatingTopics = new Set<string>();
  // Core history is keyed globally by numeric id, including across topics. Never
  // evict a negative identity: an overflow makes hardware replay proof unavailable.
  const seenRequestIds = new Set<number>();
  const startupTopics = new Set<string>();
  let replayProofUnavailable = false;
  const ownField = (value: unknown, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(record(value), key);
    return descriptor && 'value' in descriptor ? descriptor.value : fail();
  };
  const rememberRequestId = (id: number) => {
    if (seenRequestIds.has(id)) return;
    if (seenRequestIds.size >= MAX_SEEN_REQUEST_IDS) replayProofUnavailable = true;
    else seenRequestIds.add(id);
  };
  let queuedEvents = 0;
  let requestExpirySeconds: WalletConnectSdk['requestExpirySeconds'];
  const guard = (check = options.assertOwner) => {
    if (closed || options.signal.aborted) return fail();
    let result: unknown;
    try {
      result = check();
      repository.assertHealthy();
    } catch {
      return fail();
    }
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      return fail();
    }
  };
  const storageCall = async <T>(operation: () => Promise<T>): Promise<T> => {
    guard();
    const result = await operation();
    guard();
    return result;
  };
  const protocolStorage: NativeConnectionRepository['transport'] =
    Object.freeze({
      getKeys: () => storageCall(() => repository.transport.getKeys()),
      getEntries: <T>() =>
        storageCall(() => repository.transport.getEntries<T>()),
      getItem: <T>(key: string) =>
        storageCall(() => repository.transport.getItem<T>(key)),
      setItem: <T>(key: string, value: T) =>
        storageCall(() => repository.transport.setItem(key, value)),
      removeItem: (key: string) =>
        storageCall(() => repository.transport.removeItem(key)),
    });
  const barrier = async () => {
    await repository.transport.getKeys();
    guard();
  };
  const signalUnavailable = () => {
    if (!closed) {
      closed = true;
      try {
        options.onEvent({ type: 'unavailable' });
      } catch {
        /* No private error leaves the adapter. */
      }
      void close().catch(() => undefined);
    }
  };
  const cleanup = async () => {
    const failures: unknown[] = [];
    const attempt = async (operation: () => unknown) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    if (client)
      for (const [name, listener] of listeners)
        await attempt(() => client!.off(name, listener));
    listeners.clear();
    proposals.clear();
    requests.clear();
    dispatchedRequests.clear();
    updatingTopics.clear();
    seenRequestIds.clear();
    startupTopics.clear();
    // Retirement is local and must also complete offline. Per-session remote
    // disconnect remains an explicit command, never a prerequisite to erasure.
    // Core disposal aborts in-flight initialization and drains admitted storage
    // and transport work. A late client still owns its terminal cleanup.
    const created = core ?? (await creating?.catch(() => undefined));
    await Promise.all([
      attempt(() => created?.dispose()),
      attempt(async () => {
        const initialized =
          client ?? (await initializing?.catch(() => undefined));
        await initialized?.dispose();
      }),
    ]);
    await attempt(async () => {
      await repository.transport.getKeys();
      repository.assertHealthy();
    });
    if (failures.length) {
      const error = new WalletConnectTransportError();
      cleanupFailures.set(error, failures[0]);
      throw error;
    }
  };
  const close = () => {
    if (closePromise) return closePromise;
    let resolve!: () => void, reject!: (error: unknown) => void;
    closePromise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    closed = true;
    abort();
    options.signal.removeEventListener('abort', onAbort);
    void cleanup().then(resolve, reject);
    return closePromise;
  };
  const onAbort = () => {
    abort();
    void close().catch(() => undefined);
  };
  options.signal.addEventListener('abort', onAbort, { once: true });
  const ownerOrStorageFailed = () => {
    try {
      repository.assertHealthy();
      return options.assertOwner() !== undefined;
    } catch {
      return true;
    }
  };
  const run = async <T>(
    operation: () => Promise<T>,
    assertRequestCurrent?: () => void
  ): Promise<T> => {
    try {
      guard();
      await barrier();
      if (assertRequestCurrent) guard(assertRequestCurrent);
      const result = await owned(operation());
      await barrier();
      if (assertRequestCurrent) guard(assertRequestCurrent);
      return result;
    } catch {
      if (!closed && ownerOrStorageFailed()) signalUnavailable();
      return fail();
    }
  };
  const readSession = (binding: NativeConnectionBinding) => {
    const current = session(client!.session.get(binding.topic));
    if (
      !sameBinding(binding, current.binding) ||
      current.expiry * 1000 <= Date.now()
    )
      return fail();
    return current;
  };
  const unresolvedHistoryMatches = (historical: unknown, topic: string, id: number, params: unknown) => {
    try {
      if (historical === undefined || historical !== core!.history.records.get(id)) return false;
      const priorRequest = record(ownField(historical, 'request')),
        response = Object.getOwnPropertyDescriptor(record(historical), 'response');
      return checkedId(ownField(historical, 'id')) === id &&
        ownField(historical, 'topic') === topic &&
        ownField(priorRequest, 'method') === 'wc_sessionRequest' &&
        JSON.stringify(copy(ownField(priorRequest, 'params'), DAPP_REQUEST_LIMITS.bytes + 1024)) === JSON.stringify(params) &&
        (!response || ('value' in response && response.value === undefined));
    } catch { return false; }
  };
  const readHistory = async (topic: string, id: number, assertCurrent: () => void) => {
    guard(); guard(assertCurrent);
    let historical: unknown;
    try { historical = await owned(core!.history.get(topic, id)); }
    catch { /* A failed lookup never proves an unresolved request. */ }
    guard(); guard(assertCurrent);
    return historical;
  };
  type AdmittedRequest = NonNullable<ReturnType<typeof requests.get>>;
  const matchesPending = (binding: NativeConnectionBinding, id: number, admitted: AdmittedRequest) => {
    const key = `${binding.topic}:${id}`;
    if (requests.get(key) !== admitted || dispatchedRequests.has(key) || admitted.wire.expiresAt <= Date.now()) return false;
    try {
      const current = readSession(binding), pending = record(client!.pendingRequest.get(id));
      return JSON.stringify(current) === admitted.session && pending.topic === binding.topic &&
        JSON.stringify({ params: copy(pending.params, DAPP_REQUEST_LIMITS.bytes + 1024),
          verification: readVerification(pending.verifyContext, current.metadata.url) }) === admitted.serialized;
    } catch { return false; }
  };
  const retireRequest = (key: string, admitted: AdmittedRequest) => {
    if (requests.get(key) === admitted && !dispatchedRequests.has(key)) requests.delete(key);
  };
  const readProposal = (
    raw: unknown
  ): Omit<WalletConnectProposal, 'verification'> => {
    const data = record(copy(raw));
    const proposer = record(data.proposer);
    return Object.freeze({
      id: checkedId(data.id),
      pairingTopic: checkedTopic(data.pairingTopic),
      peerPublicKey: checkedTopic(proposer.publicKey),
      metadata: metadata(proposer.metadata),
      requiredNamespaces: immutable(record(data.requiredNamespaces)),
      optionalNamespaces: immutable(record(data.optionalNamespaces ?? {})),
    });
  };
  const currentProposal = (proposal: WalletConnectProposal) => {
    if (
      proposals.get(proposal.id) !== proposal ||
      JSON.stringify({
        ...readProposal(client!.proposal.get(proposal.id)),
        verification: proposal.verification,
      }) !== JSON.stringify(proposal)
    )
      return fail();
  };
  const rejectPeerEvent = async (name: EventName, raw: unknown) => {
    if (closed) return;
    if (ownerOrStorageFailed()) {
      signalUnavailable();
      return;
    }
    const field = (key: string) => {
      if (!raw || typeof raw !== 'object') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    try {
      const id = checkedId(field('id'));
      if (name === 'session_proposal') {
        if (checkedId(record(client!.proposal.get(id)).id) !== id) return;
        await client!.reject({
          id,
          reason: { code: -32602, message: 'Invalid connection proposal' },
        });
      } else if (name === 'session_request') {
        const topic = checkedTopic(field('topic'));
        if (record(client!.pendingRequest.get(id)).topic !== topic) return;
        await client!.respond({
          topic,
          response: {
            id,
            jsonrpc: '2.0',
            error: { code: -32602, message: 'Invalid or unavailable request' },
          },
        });
      }
      await barrier();
    } catch {
      if (!closed && ownerOrStorageFailed()) signalUnavailable();
    }
  };
  const dispatch = (name: EventName, raw: unknown) => {
    if (closed) return;
    let seenRequest = false;
    if (name === 'session_request') {
      try {
        const id = checkedId(ownField(raw, 'id'));
        seenRequest = seenRequestIds.has(id);
        rememberRequestId(id);
      } catch { replayProofUnavailable = true; }
    }
    let data: Record<string, unknown>;
    try {
      if (queuedEvents >= MAX_PENDING_EVENTS)
        return void rejectPeerEvent(name, raw);
      data = record(copy(raw, DAPP_REQUEST_LIMITS.bytes + 64 * 1024));
    } catch {
      return void rejectPeerEvent(name, raw);
    }
    queuedEvents++;
    eventTail = eventTail
      .then(async () => {
        if (closed) return;
        guard();
        await barrier();
        let event: WalletConnectTransportEvent;
        if (name === 'session_proposal') {
          const decoded = readProposal(data.params);
          const proposal = Object.freeze({
            ...decoded,
            verification: readVerification(
              data.verifyContext,
              decoded.metadata.url
            ),
          });
          if (proposal.id !== checkedId(data.id)) return fail();
          if (
            proposals.size >= MAX_PENDING_EVENTS &&
            !proposals.has(proposal.id)
          )
            return fail();
          proposals.set(proposal.id, proposal);
          event = { type: 'proposal', proposal };
        } else if (name === 'session_request') {
          const current = session(
            client!.session.get(checkedTopic(data.topic))
          );
          readSession(current.binding);
          const params = record(data.params),
            request = record(params.request);
          assertProviderRequestBudget(request);
          if (
            typeof params.chainId !== 'string' ||
            params.chainId.length > 256 ||
            typeof request.method !== 'string'
          )
            return fail();
          const id = checkedId(data.id),
            payload = copy(params, DAPP_REQUEST_LIMITS.bytes + 1024);
          const now = Date.now();
          const expiry =
            request.expiryTimestamp === undefined
              ? Math.floor(now / 1000) + requestExpirySeconds.min
              : request.expiryTimestamp;
          if (
            typeof expiry !== 'number' ||
            !Number.isSafeInteger(expiry) ||
            expiry <= now / 1000 ||
            expiry > Math.floor(now / 1000) + requestExpirySeconds.max ||
            !Number.isSafeInteger(current.expiry * 1000)
          )
            return fail();
          const expiresAt = Math.min(expiry * 1000, current.expiry * 1000);
          if (expiresAt <= now) return fail();
          const verification = readVerification(
            data.verifyContext,
            current.metadata.url
          );
          const key = `${current.binding.topic}:${id}`,
            serialized = JSON.stringify({ params: payload, verification });
          if (requests.has(key)) return;
          const peerRequests = [...requests.keys()].filter((key) =>
            key.startsWith(`${current.binding.topic}:`)
          ).length;
          const totalBytes = [...requests.values()].reduce(
            (total, value) => total + new TextEncoder().encode(value.serialized).length,
            0
          );
          if (
            peerRequests >= MAX_REQUESTS_PER_PEER ||
            requests.size >= MAX_PENDING_EVENTS ||
            totalBytes + new TextEncoder().encode(serialized).length >
              MAX_PENDING_REQUEST_BYTES
          )
            return fail();
          const historical = await readHistory(current.binding.topic, id, options.assertOwner);
          if (JSON.stringify(readSession(current.binding)) !== JSON.stringify(current)) return fail();
          const currentHistoryMatches = unresolvedHistoryMatches(historical, current.binding.topic, id, payload);
          const wire: WalletConnectRequest = Object.freeze({
              freshness: replayProofUnavailable || seenRequest || !currentHistoryMatches ||
                (startupTopics.has(current.binding.topic) && request.expiryTimestamp === undefined)
                ? 'unproven' : 'fresh',
              id,
              expiresAt,
              session: current,
              chainId: params.chainId,
              method: request.method,
              params:
                request.params === undefined
                  ? undefined
                  : immutable(copy(request.params, DAPP_REQUEST_LIMITS.bytes)),
              verification,
            });
          requests.set(key, Object.freeze({ serialized, wire, session: JSON.stringify(current), history: historical }));
          event = { type: 'request', request: wire };
        } else if (name === 'session_update') {
          event = {
            type: 'session',
            session: session(client!.session.get(checkedTopic(data.topic))),
          };
        } else if (name === 'proposal_expire') {
          const id = checkedId(data.id);
          proposals.delete(id);
          event = { type: 'proposal-expired', id };
        } else if (name === 'session_request_expire') {
          const id = checkedId(data.id);
          for (const key of requests.keys())
            if (key.endsWith(`:${id}`)) {
              requests.delete(key);
              dispatchedRequests.delete(key);
            }
          event = { type: 'request-expired', id };
        } else {
          const topic = checkedTopic(data.topic);
          for (const key of requests.keys())
            if (key.startsWith(`${topic}:`)) {
              requests.delete(key);
              dispatchedRequests.delete(key);
            }
          event = { type: 'session-ended', topic };
        }
        guard();
        options.onEvent(Object.freeze(event));
      })
      .catch(() => rejectPeerEvent(name, data))
      .finally(() => {
        queuedEvents--;
      });
  };
  try {
    guard();
    if (
      typeof options.projectId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(options.projectId) ||
      !Array.isArray(options.supportedMethods) ||
      !Array.isArray(options.supportedEvents)
    )
      return fail();
    const ownMetadata = metadata(options.metadata);
    process.env.DISABLE_GLOBAL_CORE = 'true';
    if (process.env.DISABLE_GLOBAL_CORE !== 'true') return fail();
    await owned(options.preparePlatform());
    guard();
    const sdk = await owned((options.loadSdk ?? officialSdk)());
    guard();
    requestExpirySeconds = sdk.requestExpirySeconds;
    if (
      !requestExpirySeconds ||
      !Number.isSafeInteger(requestExpirySeconds.min) ||
      !Number.isSafeInteger(requestExpirySeconds.max) ||
      requestExpirySeconds.min <= 0 ||
      requestExpirySeconds.max < requestExpirySeconds.min
    )
      return fail();
    creating = Promise.resolve().then(() => {
      guard();
      const value = sdk.createCore({
        projectId: options.projectId,
        storage: protocolStorage,
        telemetryEnabled: false,
        logger: 'silent',
      });
      if (typeof value.dispose !== 'function') return fail();
      return value;
    });
    core = await owned(creating);
    guard();
    if (core.storage !== protocolStorage) return fail();
    initializing = Promise.resolve().then(() => {
      guard();
      return sdk.initialize({
        core: core!,
        metadata: ownMetadata,
        logger: 'silent',
      });
    });
    client = await owned(initializing);
    if (typeof client.dispose !== 'function' || typeof client.getPendingSessionRequests !== 'function' || typeof client.update !== 'function') return fail();
    // Snapshot before the first post-init storage barrier/listener admission.
    // SDK cached relay replay can arrive later than the pending snapshot. Its
    // original explicit expiry is at most seven days; Core history retains ids
    // for thirty days. Timestamp-less cached requests have no such age proof.
    try {
      if (requestExpirySeconds.max >= 30 * 24 * 60 * 60) replayProofUnavailable = true;
      const pending = client.getPendingSessionRequests(), history = core.history.values,
        sessions = client.session.getAll();
      if (!Array.isArray(pending) || !Array.isArray(history) || !Array.isArray(sessions) ||
        pending.length > MAX_SEEN_REQUEST_IDS || history.length > MAX_SEEN_REQUEST_IDS ||
        sessions.length > MAX_PENDING_EVENTS) throw Error('Unbounded SDK snapshot');
      for (const values of [pending, history]) for (const value of values)
        rememberRequestId(checkedId(ownField(value, 'id')));
      for (const value of sessions) startupTopics.add(checkedTopic(ownField(value, 'topic')));
    } catch { replayProofUnavailable = true; }
    if (client.core !== core || client.core.storage !== protocolStorage)
      return fail();
    await barrier();
    for (const name of [
      'session_proposal',
      'session_request',
      'session_update',
      'session_delete',
      'session_expire',
      'proposal_expire',
      'session_request_expire',
    ] as const) {
      const listener = (value: unknown) => dispatch(name, value);
      client.on(name, listener);
      listeners.set(name, listener);
    }
    return Object.freeze({
      pair: (
        uri: string,
        assertPairingCurrent: () => void,
        onPairing: (pairing: WalletConnectPairing) => void
      ) => {
        if (
          typeof assertPairingCurrent !== 'function' ||
          typeof onPairing !== 'function'
        )
          return Promise.reject(new WalletConnectTransportError());
        let topic: string | undefined;
        return run(async () => {
          if (
            typeof uri !== 'string' ||
            uri.length > 4096 ||
            !uri.startsWith('wc:') ||
            /[\s\u0000-\u001f]/.test(uri)
          )
            return fail();
          const parsed = sdk.parseUri(uri);
          if (
            !HEX.test(parsed.topic) ||
            !HEX.test(parsed.symKey) ||
            parsed.version !== 2 ||
            parsed.relay.protocol !== 'irn' ||
            (parsed.expiryTimestamp !== undefined &&
              (!Number.isSafeInteger(parsed.expiryTimestamp) ||
                parsed.expiryTimestamp * 1000 <= Date.now()))
          )
            return fail();
          topic = parsed.topic;
          let expiresAt =
            parsed.expiryTimestamp === undefined
              ? Date.now() + 5 * 60 * 1000
              : parsed.expiryTimestamp * 1000;
          const pairing = Object.freeze({
            topic,
            get expiresAt() {
              return expiresAt;
            },
            cancel: () =>
              run(() => core!.pairing.disconnect({ topic: parsed.topic })),
          });
          onPairing(pairing);
          guard(assertPairingCurrent);
          const paired = await client!.pair({ uri });
          if (
            paired &&
            typeof paired === 'object' &&
            Number.isSafeInteger((paired as { expiry?: unknown }).expiry)
          )
            expiresAt = Number((paired as { expiry: number }).expiry) * 1000;
          return pairing;
        }, assertPairingCurrent).catch(() => {
          if (topic) {
            void core!.pairing.disconnect({ topic }).catch(() => undefined);
          }
          return fail();
        });
      },
      approve: (
        proposal: WalletConnectProposal,
        requested: WalletConnectNamespaces,
        assertApprovalCurrent: () => void
      ) => {
        if (typeof assertApprovalCurrent !== 'function')
          return Promise.reject(new WalletConnectTransportError());
        let createdTopic: string | undefined;
        return run(async () => {
          currentProposal(proposal);
          const approved = namespaces(requested);
          for (const entry of Object.values(approved))
            if (
              entry.methods.some(
                (name) => !options.supportedMethods.includes(name)
              ) ||
              entry.events.some(
                (name) => !options.supportedEvents.includes(name)
              )
            )
              return fail();
          guard(assertApprovalCurrent);
          const result = await client!.approve({
            id: proposal.id,
            namespaces: copy(approved) as Parameters<
              SignClient['approve']
            >[0]['namespaces'],
          });
          createdTopic = checkedTopic(result.topic);
          const approvedSession = session(await result.acknowledged());
          if (
            approvedSession.binding.topic !== createdTopic ||
            approvedSession.binding.peerPublicKey !== proposal.peerPublicKey ||
            approvedSession.binding.origin !==
              getDappOrigin(proposal.metadata.url)
          )
            return fail();
          proposals.delete(proposal.id);
          return approvedSession;
        }, assertApprovalCurrent).catch(() => {
          if (createdTopic) {
            void client!
              .disconnect({
                topic: createdTopic,
                reason: DISCONNECT_REASON,
              })
              .catch(() => undefined);
          }
          return fail();
        });
      },
      reject: (proposal: WalletConnectProposal, reason: Reason) =>
        run(async () => {
          currentProposal(proposal);
          const checked = copy(reason);
          if (
            !Number.isInteger(checked.code) ||
            typeof checked.message !== 'string' ||
            checked.message.length > 256
          )
            return fail();
          await client!.reject({ id: proposal.id, reason: checked });
          proposals.delete(proposal.id);
        }),
      respond: (
        binding: NativeConnectionBinding,
        id: number,
        response: WalletConnectResponse,
        assertRequestCurrent: () => void,
        onDispatch: () => void
      ) => {
        if (
          typeof assertRequestCurrent !== 'function' ||
          typeof onDispatch !== 'function'
        )
          return Promise.reject(new WalletConnectTransportError());
        let handedOff = false;
        // Approval authorizes the handoff. Later cancellation cannot recall it.
        const assertBeforeHandoff = () => {
          if (!handedOff) assertRequestCurrent();
        };
        return run(async () => {
          const key = `${binding.topic}:${checkedId(id)}`;
          const admitted = requests.get(key);
          if (!admitted || !matchesPending(binding, id, admitted)) return fail();
          const result = copy(response, DAPP_REQUEST_LIMITS.bytes);
          const names = Object.keys(record(result));
          if (names.length !== 1 || !['result', 'error'].includes(names[0]!))
            return fail();
          if (
            'error' in result &&
            (!Number.isInteger(result.error.code) ||
              typeof result.error.message !== 'string' ||
              result.error.message.length > 256)
          )
            return fail();
          const historical = await readHistory(binding.topic, id, assertRequestCurrent);
          if (!unresolvedHistoryMatches(historical, binding.topic, id, JSON.parse(admitted.serialized).params) ||
              !matchesPending(binding, id, admitted)) {
            retireRequest(key, admitted);
            return fail();
          }
          guard(assertRequestCurrent);
          dispatchedRequests.add(key);
          const dispatchResult = onDispatch();
          if (dispatchResult !== undefined) {
            void Promise.resolve(dispatchResult).catch(() => undefined);
            return fail();
          }
          handedOff = true;
          await client!.respond({
            topic: binding.topic,
            response: { ...result, id, jsonrpc: '2.0' },
          });
          if (requests.get(key) === admitted) {
            requests.delete(key);
            dispatchedRequests.delete(key);
          }
        }, assertBeforeHandoff);
      },
      updatePreparedAccount: (
        binding: NativeConnectionBinding,
        id: number,
        address: string,
        signal: AbortSignal,
        assertRequestCurrent: () => void,
        onCommitted: (session: WalletConnectSession) => void
      ) => {
        if (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || signal.aborted ||
          typeof assertRequestCurrent !== 'function' || typeof onCommitted !== 'function')
          return Promise.reject(new WalletConnectTransportError());
        let expiresAt: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
        let cancel!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new WalletConnectTransportError());
        });
        void cancelled.catch(() => undefined);
        signal.addEventListener('abort', cancel, { once: true });
        const assertLifetime = () => {
          if (signal.aborted || (expiresAt !== undefined && expiresAt <= Date.now())) fail();
        };
        const requestOwned = async <T>(promise: Promise<T>) => {
          const result = await Promise.race([owned(promise), cancelled]);
          assertLifetime();
          return result;
        };
        let adopted: AdmittedRequest | undefined;
        const assertTransportCurrent = () => {
          guard();
          if (client!.core !== core || core!.storage !== protocolStorage || client!.core.storage !== protocolStorage) fail();
        };
        const assertAdoptedCurrent = () => {
          assertTransportCurrent();
          assertLifetime();
          assertRequestCurrent();
          if (adopted && (!matchesPending(binding, id, adopted) ||
            !unresolvedHistoryMatches(adopted.history, binding.topic, id, JSON.parse(adopted.serialized).params))) fail();
        };
        const updating = run(async () => {
          const key = `${binding.topic}:${checkedId(id)}`;
          const admitted = requests.get(key);
          if (!admitted || !matchesPending(binding, id, admitted) ||
            admitted.wire.method !== 'wallet_prepareSmartAccount' ||
            !options.supportedMethods.includes(admitted.wire.method) ||
            !/^eip155:\d+$/.test(admitted.wire.chainId) ||
            typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address) ||
            preparedAccountAttempts.has(admitted.wire) || updatingTopics.has(binding.topic)) return fail();
          expiresAt = admitted.wire.expiresAt;
          assertLifetime();
          timer = setTimeout(cancel, Math.max(0, expiresAt - Date.now()));
          updatingTopics.add(binding.topic);
          let attempted = false;
          try {
            await requestOwned(eventTail);
            assertTransportCurrent();
            guard(assertRequestCurrent);
            if (!matchesPending(binding, id, admitted)) return fail();
            const original = readSession(binding), chainId = admitted.wire.chainId;
            const next = copy(original.namespaces) as MutableNamespaces;
            let negotiated = false;
            for (const [name, entry] of Object.entries(next)) {
              const hasChainAccount = entry.accounts.some(value => value.startsWith(`${chainId}:`));
              if ((name === 'eip155' || name === chainId) && hasChainAccount && entry.methods.includes(admitted.wire.method))
                negotiated = true;
              let replaced = false;
              entry.accounts = entry.accounts.flatMap(value => {
                if (!value.startsWith(`${chainId}:`)) return [value];
                if (replaced) return [];
                replaced = true;
                return [`${chainId}:${address}`];
              });
            }
            if (!negotiated) return fail();
            const expected = Object.freeze({ ...original, namespaces: namespaces(next) });
            const expectedSerialized = JSON.stringify(expected);
            const historical = await requestOwned(readHistory(binding.topic, id, assertRequestCurrent));
            assertTransportCurrent();
            if (historical !== admitted.history ||
              !unresolvedHistoryMatches(historical, binding.topic, id, JSON.parse(admitted.serialized).params) ||
              !matchesPending(binding, id, admitted)) return fail();
            guard(assertRequestCurrent);
            // The SDK may persist the new namespaces before ACK. Never repeat
            // this admission's update, even when dispatch or ACK is unknown.
            preparedAccountAttempts.add(admitted.wire);
            attempted = true;
            const update = await requestOwned(client!.update({ topic: binding.topic, namespaces: copy(next) }));
            assertTransportCurrent();
            // After dispatch, prove correlation without moving the original
            // request deadline. Commit notification precedes its final guard.
            const matchesExpected = () => {
              if (requests.get(key) !== admitted || dispatchedRequests.has(key)) return false;
              try {
                const current = readSession(binding), pending = record(client!.pendingRequest.get(id));
                return JSON.stringify(current) === expectedSerialized && pending.topic === binding.topic &&
                  JSON.stringify({ params: copy(pending.params, DAPP_REQUEST_LIMITS.bytes + 1024),
                    verification: readVerification(pending.verifyContext, current.metadata.url) }) === admitted.serialized;
              } catch { return false; }
            };
            if (!matchesExpected() || typeof update.acknowledged !== 'function') return fail();
            await requestOwned(update.acknowledged());
            assertTransportCurrent();
            await requestOwned(barrier());
            assertTransportCurrent();
            const confirmedHistory = await requestOwned(readHistory(binding.topic, id, options.assertOwner));
            assertTransportCurrent();
            if (confirmedHistory !== historical ||
              !unresolvedHistoryMatches(confirmedHistory, binding.topic, id, JSON.parse(admitted.serialized).params) ||
              !matchesExpected()) return fail();
            const confirmed = readSession(binding);
            adopted = Object.freeze({ ...admitted, session: expectedSerialized });
            requests.set(key, adopted);
            const committed = onCommitted(confirmed);
            if (committed !== undefined) {
              void Promise.resolve(committed).catch(() => undefined);
              return fail();
            }
            guard(assertAdoptedCurrent);
            return confirmed;
          } finally {
            // Unknown dispatch/ACK keeps the topic fenced until disconnect or
            // transport retirement; another request cannot continue this update.
            if (!attempted) updatingTopics.delete(binding.topic);
          }
        }, assertAdoptedCurrent).then(result => {
          updatingTopics.delete(binding.topic);
          return result;
        });
        return requestOwned(updating).finally(() => {
          signal.removeEventListener('abort', cancel);
          if (timer !== undefined) clearTimeout(timer);
        });
      },
      disconnect: (binding: NativeConnectionBinding) =>
        run(async () => {
          readSession(binding);
          await client!.disconnect({
            topic: binding.topic,
            reason: DISCONNECT_REASON,
          });
        }),
      emit: (
        binding: NativeConnectionBinding,
        chainId: string,
        event: { name: string; data: unknown },
        assertCurrent: () => void
      ) => {
        if (typeof assertCurrent !== 'function')
          return Promise.reject(new WalletConnectTransportError());
        return run(async () => {
          const current = readSession(binding);
          if (
            !options.supportedEvents.includes(event.name) ||
            !Object.values(current.namespaces).some(
              (value) =>
                value.events.includes(event.name) &&
                (value.chains?.includes(chainId) ||
                  value.accounts.some((account) =>
                    account.startsWith(`${chainId}:`)
                  ))
            )
          )
            return fail();
          guard(assertCurrent);
          await client!.emit({
            topic: binding.topic,
            chainId,
            event: copy(event),
          });
        }, assertCurrent);
      },
      pending: (binding: NativeConnectionBinding, id: number, assertCurrent: () => void) => {
        const key = `${binding.topic}:${checkedId(id)}`;
        let admitted: AdmittedRequest | undefined;
        const matches = () => !!admitted && matchesPending(binding, id, admitted);
        const check = () => { guard(assertCurrent); if (admitted && !matches()) fail(); };
        return run(async () => {
          // A queued session/expiry event must settle before a restore decision.
          await eventTail;
          guard(assertCurrent);
          admitted = requests.get(key);
          if (!matches()) { admitted = undefined; return null; }
          return admitted!.wire;
        }, check).then(async wire => {
          if (!wire || !admitted) return null;
          // History is independent of pendingRequest: SDK sendError can answer
          // a duplicate id while leaving the original pending row untouched.
          // Read after run's final storage barrier, then repeat the sync scope checks.
          const captured = admitted;
          const historical = await readHistory(binding.topic, id, check);
          if (!unresolvedHistoryMatches(historical, binding.topic, id, JSON.parse(captured.serialized).params) || !matches()) {
            retireRequest(key, captured);
            return null;
          }
          return wire;
        }).catch(() => {
          if (!closed && ownerOrStorageFailed()) signalUnavailable();
          return fail();
        });
      },
      sessions: () =>
        run(async () => Object.freeze(client!.session.getAll().map(session))),
      close,
    });
  } catch {
    await close();
    return fail();
  }
}
