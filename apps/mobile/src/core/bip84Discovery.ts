import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import type { UtxoAddressUsage, UtxoAddressUsageReader, UtxoAddressUsageSession } from './utxoAddressUsage.ts';
import { utxoCount, utxoUnits } from './utxoReadSession.ts';

export const BIP84_DISCOVERY_LIMITS = Object.freeze({ gap: 20, workers: 2, perBranch: 100, timeoutMs: 30000, maximumIndex: 4095 });
export type Bip84DiscoveryScope = Readonly<{ networkId: UtxoNetworkId; sourceId: string }>;
export type Bip84DiscoveryCursor = Readonly<{ version: 1; scope: Bip84DiscoveryScope; branches: readonly Readonly<{ nextIndex: number; lastUsedIndex: number }>[] }>;
export type PublicBip84Deriver = (request: Readonly<{ networkId: UtxoNetworkId; branch: 0 | 1; index: number }>) => Readonly<{ address: string; branch: 0 | 1; index: number }>;
export type DiscoveryErrorCode = 'INVALID_INPUT' | 'BUSY' | 'CANCELLED' | 'UNAVAILABLE';
export class Bip84DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  constructor(code: DiscoveryErrorCode) { super(code); this.name = 'Bip84DiscoveryError'; this.code = code; }
}
const fail = (code: DiscoveryErrorCode): never => { throw new Bip84DiscoveryError(code); };
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== fields.length) return fail('INVALID_INPUT');
  const result: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail('INVALID_INPUT');
    result[field] = descriptor.value;
  }
  return result;
}
function scope(value: unknown): Bip84DiscoveryScope {
  const raw = record(value, ['networkId', 'sourceId']);
  if (typeof raw.sourceId !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(raw.sourceId)) return fail('INVALID_INPUT');
  try { getUtxoNetwork(raw.networkId as UtxoNetworkId); } catch { return fail('INVALID_INPUT'); }
  return Object.freeze({ networkId: raw.networkId as UtxoNetworkId, sourceId: raw.sourceId });
}
/** Shape validation only. A saved cursor never proves an account key or coverage. */
export function parseBip84DiscoveryCursor(value: unknown, expected: Bip84DiscoveryScope): Bip84DiscoveryCursor {
  const raw = record(value, ['version', 'scope', 'branches']), bound = scope(raw.scope), wanted = scope(expected);
  if (raw.version !== 1 || bound.networkId !== wanted.networkId || bound.sourceId !== wanted.sourceId || !Array.isArray(raw.branches) ||
      raw.branches.length !== 2 || Reflect.ownKeys(raw.branches).length !== 3) return fail('INVALID_INPUT');
  const branches = [0, 1].map((i) => {
    const d = Object.getOwnPropertyDescriptor(raw.branches, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail('INVALID_INPUT');
    const branch = record(d.value, ['nextIndex', 'lastUsedIndex']);
    if (!Number.isSafeInteger(branch.nextIndex) || (branch.nextIndex as number) < 0 || (branch.nextIndex as number) > 4096 ||
        !Number.isSafeInteger(branch.lastUsedIndex) || (branch.lastUsedIndex as number) < -1 || (branch.lastUsedIndex as number) >= (branch.nextIndex as number)) return fail('INVALID_INPUT');
    return Object.freeze({ nextIndex: branch.nextIndex as number, lastUsedIndex: branch.lastUsedIndex as number });
  });
  return Object.freeze({ version: 1, scope: bound, branches: Object.freeze(branches) });
}
type Branch = { nextIndex: number; lastUsedIndex: number; unused: number };
export type Bip84DiscoverySnapshot = Readonly<{
  status: 'idle' | 'loading' | 'partial' | 'gap-reached' | 'unavailable';
  reason: 'pass-limit' | 'index-limit' | 'cancelled' | 'read-failed' | null;
  scope: Bip84DiscoveryScope;
  cursor: Bip84DiscoveryCursor;
  restoredHint: Bip84DiscoveryCursor | null;
  observedAddresses: number;
  observedThisPass: number;
  totals: Readonly<{ confirmedUnits: string; pendingDeltaUnits: string }> | null;
  observationsSpanPasses: boolean;
  anchor: Readonly<{ height: number; hash: string; endHeight: number }> | null;
}>;

/**
 * Host foundation only: injected public derivation, no account-key parser/SDK,
 * persistence, custody or UI enablement. Resume uses only this live instance's
 * verified prefix. Imported cursor hints never change its starting index zero.
 */
export class Bip84Discovery {
  private readonly bound: Bip84DiscoveryScope;
  private readonly derive: PublicBip84Deriver;
  private readonly reader: UtxoAddressUsageReader;
  private readonly guard: () => void;
  private readonly hint: Bip84DiscoveryCursor | null;
  private branches: Branch[] = [{ nextIndex: 0, lastUsedIndex: -1, unused: 0 }, { nextIndex: 0, lastUsedIndex: -1, unused: 0 }];
  private observations = new Map<string, { branch: number; index: number; value: UtxoAddressUsage }>();
  private snapshot: Bip84DiscoverySnapshot;
  private pending: object | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  constructor(options: Readonly<{ scope: Bip84DiscoveryScope; derive: PublicBip84Deriver; reader: UtxoAddressUsageReader; assertCurrent(): void; restoredCursor?: unknown }>) {
    this.bound = scope(options.scope);
    if (typeof options.derive !== 'function' || typeof options.reader?.open !== 'function' || typeof options.assertCurrent !== 'function') fail('INVALID_INPUT');
    this.derive = options.derive; this.reader = options.reader; this.guard = options.assertCurrent;
    this.hint = options.restoredCursor === undefined ? null : parseBip84DiscoveryCursor(options.restoredCursor, this.bound);
    this.snapshot = this.project('idle', null, null, 0, false);
  }
  getSnapshot(): Bip84DiscoverySnapshot { return this.snapshot; }
  private cursor(branches = this.branches): Bip84DiscoveryCursor {
    return Object.freeze({ version: 1, scope: this.bound, branches: Object.freeze(branches.map(({ nextIndex, lastUsedIndex }) => Object.freeze({ nextIndex, lastUsedIndex }))) });
  }
  private project(status: Bip84DiscoverySnapshot['status'], reason: Bip84DiscoverySnapshot['reason'], anchor: Bip84DiscoverySnapshot['anchor'], observedThisPass: number, span: boolean): Bip84DiscoverySnapshot {
    let confirmed = 0n, pending = 0n;
    for (const { value } of this.observations.values()) { confirmed += BigInt(value.confirmedUnits); pending += BigInt(value.pendingDeltaUnits); }
    return Object.freeze({ status, reason, scope: this.bound, cursor: this.cursor(), restoredHint: this.hint,
      observedAddresses: this.observations.size, observedThisPass,
      totals: status === 'idle' || status === 'loading' || status === 'unavailable' ? null : Object.freeze({ confirmedUnits: confirmed.toString(), pendingDeltaUnits: pending.toString() }),
      observationsSpanPasses: span, anchor });
  }
  cancel(): void {
    this.generation++; this.abort?.abort();
    this.snapshot = this.project('unavailable', 'cancelled', null, 0, false);
  }
  scan(mode: 'refresh' | 'resume' = 'refresh'): Promise<Bip84DiscoverySnapshot> {
    if (this.pending) return Promise.reject(new Bip84DiscoveryError('BUSY'));
    if (mode !== 'refresh' && mode !== 'resume') return Promise.reject(new Bip84DiscoveryError('INVALID_INPUT'));
    const token = {}; this.pending = token;
    const generation = ++this.generation, controller = new AbortController(); this.abort = controller;
    this.snapshot = this.project('loading', null, null, 0, false);
    const timer = setTimeout(() => controller.abort(), BIP84_DISCOVERY_LIMITS.timeoutMs);
    const check = () => {
      if (generation !== this.generation || this.pending !== token || controller.signal.aborted) return fail('CANCELLED');
      const returned: unknown = this.guard();
      if (returned !== undefined) {
        if (returned && (typeof returned === 'object' || typeof returned === 'function')) void Promise.resolve(returned).catch(() => undefined);
        return fail('CANCELLED');
      }
      if (generation !== this.generation || this.pending !== token || controller.signal.aborted) return fail('CANCELLED');
    };
    const task = (async () => {
      let session: UtxoAddressUsageSession | undefined;
      const owned = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => reject(new Bip84DiscoveryError('CANCELLED'));
        controller.signal.addEventListener('abort', abort, { once: true });
        work.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
        if (controller.signal.aborted) abort();
      });
      const branches: Branch[] = mode === 'refresh' ? [{ nextIndex: 0, lastUsedIndex: -1, unused: 0 }, { nextIndex: 0, lastUsedIndex: -1, unused: 0 }] : this.branches.map((branch) => ({ ...branch }));
      const values = mode === 'refresh' ? new Map<string, { branch: number; index: number; value: UtxoAddressUsage }>() : new Map(this.observations);
      const beforeCount = values.size;
      const seen = new Set(values.keys());
      try {
        check();
        const opening = this.reader.open(this.bound.networkId, controller.signal).then((value) => {
          if (controller.signal.aborted) value.close();
          return value;
        });
        session = await owned(opening); check();
        if (!Number.isSafeInteger(session.observedHeight) || session.observedHeight < 0 || !/^[0-9a-f]{64}$/.test(session.anchorHash)) return fail('INVALID_INPUT');
        await Promise.all(([0, 1] as const).map(async (branch) => {
          const state = branches[branch]!;
          for (let work = 0; work < BIP84_DISCOVERY_LIMITS.perBranch && state.unused < 20 && state.nextIndex <= 4095; work++) {
            check(); const index = state.nextIndex;
            const candidate: unknown = this.derive(Object.freeze({ networkId: this.bound.networkId, branch, index }));
            if (candidate instanceof Promise) { void candidate.catch(() => undefined); return fail('INVALID_INPUT'); }
            const derived = record(candidate, ['address', 'branch', 'index']); check();
            if (derived.branch !== branch || derived.index !== index) return fail('INVALID_INPUT');
            const address = normalizeUtxoAddress(derived.address, this.bound.networkId);
            if (seen.has(address)) return fail('INVALID_INPUT');
            seen.add(address);
            const raw = record(await owned(session!.readAddress(address)), ['address', 'confirmedUnits', 'pendingDeltaUnits', 'historicalTransactions', 'unconfirmedTransactions', 'used']); check();
            // Reader output is public, but an injected port is still validated.
            if (raw.address !== address || typeof raw.used !== 'boolean') return fail('INVALID_INPUT');
            const value = Object.freeze({ address, used: raw.used, confirmedUnits: utxoUnits(raw.confirmedUnits, false), pendingDeltaUnits: utxoUnits(raw.pendingDeltaUnits, true),
              historicalTransactions: utxoCount(raw.historicalTransactions), unconfirmedTransactions: utxoCount(raw.unconfirmedTransactions) });
            const used = value.historicalTransactions > 0 || value.unconfirmedTransactions > 0 || BigInt(value.confirmedUnits) !== 0n || BigInt(value.pendingDeltaUnits) !== 0n;
            if (used !== value.used) return fail('INVALID_INPUT');
            values.set(address, { branch, index, value: Object.freeze({ ...value }) });
            state.nextIndex++; state.unused = used ? 0 : state.unused + 1;
            if (used) state.lastUsedIndex = index;
          }
        }));
        check(); const endHeight = await owned(session.verifyAnchor()); check();
        if (!Number.isSafeInteger(endHeight) || endHeight < session.observedHeight) return fail('INVALID_INPUT');
        const gap = branches.every((branch) => branch.unused >= 20);
        this.branches = branches; this.observations = values;
        this.snapshot = this.project(gap ? 'gap-reached' : 'partial', gap ? null : branches.some((b) => b.nextIndex > 4095 && b.unused < 20) ? 'index-limit' : 'pass-limit',
          Object.freeze({ height: session.observedHeight, hash: session.anchorHash, endHeight }), values.size - beforeCount, mode === 'resume' && beforeCount > 0);
        return this.snapshot;
      } catch (cause) {
        controller.abort();
        this.snapshot = this.project('unavailable', generation !== this.generation || cause instanceof Bip84DiscoveryError && cause.code === 'CANCELLED' ? 'cancelled' : 'read-failed', null, 0, false);
        throw cause instanceof Bip84DiscoveryError ? cause : new Bip84DiscoveryError(controller.signal.aborted && generation !== this.generation ? 'CANCELLED' : 'UNAVAILABLE');
      } finally {
        session?.close(); clearTimeout(timer);
        if (this.pending === token) { this.pending = null; this.abort = null; }
      }
    })();
    return task;
  }
}
