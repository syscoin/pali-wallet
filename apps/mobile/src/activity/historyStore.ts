import { snapshotNftTransferIntent } from '../../../../source/shared/nftTransfer.ts';
import {
  validateActivityView as view,
  validateActivityCandidate as candidate,
  ACTIVITY_CACHE_LIMIT,
  ACTIVITY_VIEW_LIMIT,
} from './cacheValidation.ts';
import { isNativeAccountId } from '../custody/accountIdentity.ts';
import { getAddress } from 'ethers/address';
import { parseErc20Metadata } from '../portfolio/erc20Metadata.ts';
import { decodeStorageValue, encodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import {
  ActivityError,
  LOCAL_ACTIVITY_LIMIT,
  DEFAULT_ACTIVITY_VIEW,
  localScopeKey,
  type ActivityCandidate,
  type ActivityScope,
  type ActivityViewState,
  type ArchivedActivityRecord,
} from './types.ts';

export const ACTIVITY_STORAGE_KEY = 'native-activity-v1';
const BYTE_LIMIT = 60 * 1024;
const queues = new WeakMap<KeyringStoragePort, Promise<unknown>>();
type Cached = Readonly<{
  sourceId: string;
  scopeKey: string;
  candidates: readonly ActivityCandidate[];
}>;
type SavedView = Readonly<{ sourceId: string; view: ActivityViewState }>;
type Document = Readonly<{
  version: 1;
  walletFingerprint: string;
  revision: number;
  truncated: boolean;
  archived: readonly ArchivedActivityRecord[];
  cached: readonly Cached[];
  views: readonly SavedView[];
}>;
export type ActivityHistorySnapshot = Readonly<{
  archived: readonly ArchivedActivityRecord[];
  candidates: readonly ActivityCandidate[];
  view: ActivityViewState;
  truncated: boolean;
}>;
const copy = <T>(value: T): T =>
  decodeStorageValue(encodeStorageValue(value)) as T;
const invalid = (): never => {
  throw new ActivityError('INVALID');
};
function exact(
  value: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  const names = Object.keys(value);
  if (
    names.length !== fields.length ||
    names.some((name) => !fields.includes(name))
  )
    return invalid();
  return value as Record<string, unknown>;
}
export function validateArchivedActivity(
  value: unknown
): ArchivedActivityRecord {
  const data = exact(copy(value), [
    'walletFingerprint',
    'accountId',
    'address',
    'networkId',
    'registrationHash',
    'chainId',
    'hash',
    'phase',
    'nonce',
    'createdAt',
    'recipient',
    'amountUnits',
    'maximumFeeUnits',
    ...(value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'smartAccount')
      ? ['smartAccount']
      : []),
    ...(value && typeof value === 'object' && Object.hasOwn(value, 'contractInteraction') ? ['contractInteraction'] : []),
    ...(value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'collectibleTransfer')
      ? ['collectibleTransfer']
      : []),
    ...(value && typeof value === 'object' && Object.hasOwn(value, 'token')
      ? ['token']
      : []),
  ]);
  if (
    typeof data.walletFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.walletFingerprint) ||
    typeof data.accountId !== 'string' ||
    !isNativeAccountId(data.accountId) ||
    typeof data.address !== 'string' ||
    getAddress(data.address) !== data.address ||
    typeof data.recipient !== 'string' ||
    getAddress(data.recipient) !== data.recipient ||
    typeof data.networkId !== 'string' ||
    data.networkId.length > 64 ||
    typeof data.registrationHash !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(data.registrationHash) ||
    typeof data.chainId !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(data.chainId) ||
    typeof data.hash !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(data.hash) ||
    !['confirmed', 'reverted', 'nonce-consumed', 'submitted'].includes(
      data.phase as string
    ) ||
    !Number.isSafeInteger(data.nonce) ||
    (data.nonce as number) < 0 ||
    !Number.isSafeInteger(data.createdAt) ||
    (data.createdAt as number) < 0 ||
    [data.amountUnits, data.maximumFeeUnits].some(
      (v) => typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v)
    )
  )
    return invalid();
  if (
    data.accountId.startsWith('smart:') !== (data.smartAccount !== undefined) ||
    (data.phase === 'submitted' && data.smartAccount === undefined)
  )
    return invalid();
  if (data.smartAccount !== undefined) {
    const identity = exact(data.smartAccount, [
      'payer',
      'operationHash',
      'operationNonce',
      ...(data.smartAccount && typeof data.smartAccount === 'object' && Object.hasOwn(data.smartAccount, 'cancellation') ? ['cancellation'] : []),
    ]);
    if (
      !data.accountId.startsWith('smart:') ||
      typeof identity.payer !== 'string' ||
      getAddress(identity.payer) !== identity.payer ||
      typeof identity.operationHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/.test(identity.operationHash) ||
      typeof identity.operationNonce !== 'string' ||
      !/^(0|[1-9][0-9]{0,77})$/.test(identity.operationNonce) ||
      BigInt(identity.operationNonce) >= BigInt(1) << BigInt(256) ||
      (identity.cancellation !== undefined && identity.cancellation !== true)
    )
      return invalid();
    data.smartAccount = Object.freeze(identity);
  }
  if (
    data.contractInteraction !== undefined &&
    (data.contractInteraction !== true ||
      !data.smartAccount ||
      data.token !== undefined ||
      data.collectibleTransfer !== undefined)
  )
    return invalid();
  if (data.collectibleTransfer !== undefined) {
    const intent = snapshotNftTransferIntent(data.collectibleTransfer);
    if (
      data.token !== undefined ||
      !data.smartAccount ||
      intent.from !== data.address ||
      intent.chainId !== data.chainId ||
      intent.recipient !== data.recipient ||
      intent.amountUnits !== data.amountUnits
    )
      return invalid();
    data.collectibleTransfer = intent;
  }
  if (data.token !== undefined) {
    try {
      data.token = parseErc20Metadata(data.token);
    } catch {
      return invalid();
    }
  }
  return Object.freeze(data as unknown as ArchivedActivityRecord);
}
function decode(value: unknown, fingerprint: string): Document {
  const data = exact(copy(value), [
    'version',
    'walletFingerprint',
    'revision',
    'truncated',
    'archived',
    'cached',
    'views',
  ]);
  if (
    data.version !== 1 ||
    data.walletFingerprint !== fingerprint ||
    !Number.isSafeInteger(data.revision) ||
    (data.revision as number) < 0 ||
    typeof data.truncated !== 'boolean' ||
    !Array.isArray(data.archived) ||
    data.archived.length > LOCAL_ACTIVITY_LIMIT ||
    !Array.isArray(data.cached) ||
    data.cached.length > ACTIVITY_CACHE_LIMIT ||
    !Array.isArray(data.views) ||
    data.views.length > ACTIVITY_VIEW_LIMIT
  )
    return invalid();
  const archived = data.archived.map(validateArchivedActivity);
  if (
    archived.some((r) => r.walletFingerprint !== fingerprint) ||
    new Set(archived.map((r) => `${localScopeKey(r)}:${r.hash}`)).size !==
      archived.length
  )
    return invalid();
  const cached = data.cached.map((raw) => {
    const c = exact(raw, ['sourceId', 'scopeKey', 'candidates']);
    if (
      typeof c.sourceId !== 'string' ||
      !/^0x[0-9a-f]{64}$/.test(c.sourceId) ||
      typeof c.scopeKey !== 'string' ||
      !/^0x[0-9a-f]{64}$/.test(c.scopeKey) ||
      !Array.isArray(c.candidates) ||
      c.candidates.length > ACTIVITY_CACHE_LIMIT
    )
      return invalid();
    return {
      sourceId: c.sourceId,
      scopeKey: c.scopeKey,
      candidates: c.candidates.map(candidate),
    };
  });
  if (
    cached.reduce((count, c) => count + c.candidates.length, 0) >
      ACTIVITY_CACHE_LIMIT ||
    new Set(cached.map((c) => c.sourceId)).size !== cached.length
  )
    return invalid();
  const views = data.views.map((raw) => {
    const v = exact(raw, ['sourceId', 'view']);
    if (typeof v.sourceId !== 'string' || !/^0x[0-9a-f]{64}$/.test(v.sourceId))
      return invalid();
    return { sourceId: v.sourceId, view: view(v.view) };
  });
  if (new Set(views.map((v) => v.sourceId)).size !== views.length)
    return invalid();
  return {
    version: 1,
    walletFingerprint: fingerprint,
    revision: data.revision as number,
    truncated: data.truncated,
    archived,
    cached,
    views,
  };
}
function fresh(fingerprint: string): Document {
  return {
    version: 1,
    walletFingerprint: fingerprint,
    revision: 0,
    truncated: false,
    archived: [],
    cached: [],
    views: [],
  };
}
/** Validate the complete saved document without packing, pruning or persisting it. */
export function inspectRecoveryHistory(
  value: unknown,
  walletFingerprint: string
) {
  if (new TextEncoder().encode(encodeStorageValue(value)).length > BYTE_LIMIT)
    return invalid();
  const record = decode(value, walletFingerprint);
  return Object.freeze({
    summaries: record.archived.length,
    cachedTransactions: record.cached.reduce(
      (count, group) => count + group.candidates.length,
      0
    ),
    preferences: record.views.length,
    accounts: Object.freeze(
      record.archived.map((row) =>
        Object.freeze({ id: row.accountId, address: row.address })
      )
    ),
  });
}
function packed(input: Document, protect?: string): Document {
  const next = {
    ...input,
    archived: [...input.archived],
    cached: [...input.cached],
    views: [...input.views],
  };
  while (next.archived.length > LOCAL_ACTIVITY_LIMIT) {
    next.archived.shift();
    next.truncated = true;
  }
  while (
    next.cached.length > ACTIVITY_CACHE_LIMIT ||
    next.cached.reduce((sum, c) => sum + c.candidates.length, 0) >
      ACTIVITY_CACHE_LIMIT
  ) {
    next.cached.pop();
    next.truncated = true;
  }
  while (next.views.length > ACTIVITY_VIEW_LIMIT) next.views.pop();
  for (;;) {
    try {
      if (
        new TextEncoder().encode(encodeStorageValue(next)).length <= BYTE_LIMIT
      )
        return next;
    } catch {
      /* prune public cache before refusing */
    }
    next.truncated = true;
    if (next.cached.length) next.cached.pop();
    else {
      const removable = next.archived.findIndex(
        (r) => `${localScopeKey(r)}:${r.hash}` !== protect
      );
      if (removable >= 0) next.archived.splice(removable, 1);
      else if (next.views.length) next.views.pop();
      else throw new ActivityError('INVALID');
    }
  }
}
/** One bounded encrypted public-history document. It never authorizes a spend. */
export class NativeActivityHistory {
  requiresReopen = false;
  private readonly storage: KeyringStoragePort;
  constructor(storage: KeyringStoragePort) {
    this.storage = storage;
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const prior = queues.get(this.storage) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    queues.set(
      this.storage,
      next.catch(() => undefined)
    );
    return next;
  }
  private async read(fingerprint: string, guard: () => void) {
    guard();
    const raw = await this.storage.get(ACTIVITY_STORAGE_KEY);
    guard();
    return {
      raw,
      data: raw === undefined ? fresh(fingerprint) : decode(raw, fingerprint),
    };
  }
  private mutate(
    fingerprint: string,
    guard: () => void,
    change: (data: Document) => Document,
    protect?: string
  ): Promise<void> {
    return this.exclusive(async () => {
      if (this.requiresReopen) throw new ActivityError('REOPEN_REQUIRED');
      for (let i = 0; i < 3; i++) {
        const { raw, data } = await this.read(fingerprint, guard);
        if (data.revision === Number.MAX_SAFE_INTEGER)
          throw new ActivityError('INVALID');
        const next = change(data);
        guard();
        if (encodeStorageValue(next) === encodeStorageValue(data)) return;
        const stored = packed(
          { ...next, revision: data.revision + 1 },
          protect
        );
        let committed: boolean;
        try {
          committed =
            raw === undefined
              ? await this.storage.createManyIfAbsent(
                  {
                    [ACTIVITY_STORAGE_KEY]: stored,
                  },
                  guard
                )
              : await this.storage.compareAndSet(
                  ACTIVITY_STORAGE_KEY,
                  raw,
                  stored,
                  undefined,
                  guard
                );
        } catch {
          this.requiresReopen = true;
          throw new ActivityError('REOPEN_REQUIRED');
        }
        if (typeof committed !== 'boolean') {
          this.requiresReopen = true;
          throw new ActivityError('REOPEN_REQUIRED');
        }
        if (!committed) {
          guard();
          continue;
        }
        guard();
        let checked: unknown;
        try {
          checked = await this.storage.get(ACTIVITY_STORAGE_KEY);
        } catch {
          this.requiresReopen = true;
          throw new ActivityError('REOPEN_REQUIRED');
        }
        guard();
        if (encodeStorageValue(checked) !== encodeStorageValue(stored)) {
          this.requiresReopen = true;
          throw new ActivityError('REOPEN_REQUIRED');
        }
        decode(checked, fingerprint);
        return;
      }
      throw new ActivityError('CONFLICT');
    });
  }
  recordObservation(
    record: ArchivedActivityRecord,
    guard: () => void
  ): Promise<void> {
    const checked = validateArchivedActivity(record);
    const id = `${localScopeKey(checked)}:${checked.hash}`;
    return this.mutate(
      checked.walletFingerprint,
      guard,
      (data) => {
        const old = data.archived.find(
          (r) => `${localScopeKey(r)}:${r.hash}` === id
        );
        if (old) {
          if (encodeStorageValue(old) === encodeStorageValue(checked))
            return data;
          // Receipt outcome can change after a reorg; immutable transaction fields cannot.
          if (
            encodeStorageValue({ ...old, phase: checked.phase }) !==
            encodeStorageValue(checked)
          )
            throw new ActivityError('INVALID');
          return packed(
            {
              ...data,
              archived: data.archived.map((record) =>
                record === old ? checked : record
              ),
            },
            id
          );
        }
        return packed({ ...data, archived: [...data.archived, checked] }, id);
      },
      id
    );
  }
  clearScope(scope: ActivityScope, guard: () => void): Promise<void> {
    return this.mutate(scope.walletFingerprint, guard, (data) => ({
      ...data,
      archived: data.archived.filter(
        (record) =>
          record.chainId !== scope.network.chainId ||
          record.address !== scope.address
      ),
      // These disposable indexes also cover aliases removed from the catalogue.
      cached: [],
      views: [],
    }));
  }
  async load(
    scope: ActivityScope,
    guard: () => void
  ): Promise<ActivityHistorySnapshot> {
    const { data } = await this.read(scope.walletFingerprint, guard);
    return Object.freeze({
      archived: Object.freeze(
        data.archived.filter((r) => localScopeKey(r) === scope.key)
      ),
      candidates:
        data.cached.find((c) => c.sourceId === scope.sourceId)?.candidates ??
        [],
      view:
        data.views.find((v) => v.sourceId === scope.sourceId)?.view ??
        DEFAULT_ACTIVITY_VIEW,
      truncated: data.truncated,
    });
  }
  saveCache(
    scope: ActivityScope,
    candidates: readonly ActivityCandidate[],
    guard: () => void
  ): Promise<void> {
    const admitted = candidates.slice(0, ACTIVITY_CACHE_LIMIT).map(candidate);
    return this.mutate(scope.walletFingerprint, guard, (data) =>
      packed({
        ...data,
        truncated: data.truncated || candidates.length > ACTIVITY_CACHE_LIMIT,
        cached: [
          {
            sourceId: scope.sourceId,
            scopeKey: scope.key,
            candidates: admitted,
          },
          ...data.cached.filter((c) => c.sourceId !== scope.sourceId),
        ],
      })
    );
  }
  saveView(
    scope: ActivityScope,
    input: ActivityViewState,
    guard: () => void
  ): Promise<void> {
    const checked = view(input);
    return this.mutate(scope.walletFingerprint, guard, (data) =>
      packed({
        ...data,
        views: [
          { sourceId: scope.sourceId, view: checked },
          ...data.views.filter((v) => v.sourceId !== scope.sourceId),
        ],
      })
    );
  }
}
