import type { DappPermissionPort } from '../../../../source/wallet/dappSessions.ts';
import type {
  DappGrant,
  DappPermissionFrame,
} from '../../../../source/shared/dappTypes.ts';
import {
  MAX_DAPP_ORIGIN_LENGTH,
  matchesDappAccountIdentity,
  readStoredDappPermissions,
} from '../../../../source/shared/dappTypes.ts';
import type { KeyringAccountType } from '../../../../source/types/network.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import { getDappOrigin } from '../../../../source/utils/dappOrigin.ts';
import { validateStorageKey } from '../storage/json.ts';
import type { KeyringStoragePort } from '../storage/types.ts';
import { ACCOUNT_RECORD_KEY } from '../storage/accountRecordKey.ts';

import {
  CONNECTION_RECORD_LIMITS,
  NATIVE_CONNECTION_STORAGE_KEY,
  decodeConnectionRecord,
  encodeConnectionRecord,
} from '../storage/connectionRecordKey.ts';
export { NATIVE_CONNECTION_STORAGE_KEY } from '../storage/connectionRecordKey.ts';
const MAX_SESSIONS = 64;
const MAX_TRANSPORT_ENTRIES = 128;
const HEX_32 = /^[0-9a-f]{64}$/;
const ACCOUNT_TYPES = new Set([
  'HDAccount',
  'Imported',
  'Ledger',
  'Trezor',
  'SmartAccount',
]);
const EMPTY_FRAME: DappPermissionFrame = Object.freeze({
  dapps: Object.freeze({}),
  pendingOrigins: Object.freeze([]),
});

/** Trusted transport identity. The reported origin alone never selects a grant. */
export type NativeConnectionBinding = Readonly<{
  peerPublicKey: string;
  topic: string;
  origin: string;
}>;
type SessionRecord = Readonly<{
  binding: NativeConnectionBinding;
  permissions: DappPermissionFrame;
}>;
type TransportEntry = Readonly<{ key: string; value: unknown }>;
type ConnectionRecord = Readonly<{
  version: 1;
  walletBindingId: string;
  sessions: readonly SessionRecord[];
  transport: readonly TransportEntry[];
}>;

export class NativeConnectionStorageError extends Error {
  readonly code: 'INVALID_CONNECTION_STATE' | 'CONNECTION_STORAGE_UNAVAILABLE';
  constructor(code: NativeConnectionStorageError['code']) {
    super(code);
    this.code = code;
    this.name = 'NativeConnectionStorageError';
  }
}
const invalid = (): never => {
  throw new NativeConnectionStorageError('INVALID_CONNECTION_STATE');
};
const unavailable = (): never => {
  throw new NativeConnectionStorageError('CONNECTION_STORAGE_UNAVAILABLE');
};
const object = (value: unknown): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    )
      return invalid();
  }
  return value as Record<string, unknown>;
};
function fields(
  value: unknown,
  names: readonly string[]
): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).sort().join(',') !== [...names].sort().join(','))
    return invalid();
  return result;
}
function bindingKey(binding: NativeConnectionBinding): string {
  return `${binding.peerPublicKey}:${binding.topic}`;
}
function readBinding(value: unknown): NativeConnectionBinding {
  const binding = fields(value, ['peerPublicKey', 'topic', 'origin']);
  if (
    typeof binding.peerPublicKey !== 'string' ||
    !HEX_32.test(binding.peerPublicKey) ||
    typeof binding.topic !== 'string' ||
    !HEX_32.test(binding.topic) ||
    typeof binding.origin !== 'string' ||
    binding.origin.length > MAX_DAPP_ORIGIN_LENGTH ||
    getDappOrigin(binding.origin) !== binding.origin
  )
    return invalid();
  return Object.freeze({
    peerPublicKey: binding.peerPublicKey,
    topic: binding.topic,
    origin: binding.origin,
  });
}
function readGrant(value: unknown, origin: string): DappGrant {
  const grant = object(value);
  const required = [
    'accountId',
    'accountType',
    'chain',
    'chainId',
    'date',
    'host',
  ];
  if (
    required.some((name) => !Object.hasOwn(grant, name)) ||
    Object.keys(grant).some(
      (name) => ![...required, 'logo', 'utxoAccount'].includes(name)
    ) ||
    !Number.isSafeInteger(grant.accountId) ||
    Number(grant.accountId) < 0 ||
    typeof grant.accountType !== 'string' ||
    !ACCOUNT_TYPES.has(grant.accountType) ||
    typeof grant.chain !== 'string' ||
    !['ethereum', 'syscoin'].includes(grant.chain) ||
    !Number.isSafeInteger(grant.chainId) ||
    Number(grant.chainId) < 0 ||
    (grant.chain === 'ethereum' && grant.chainId === 0) ||
    !Number.isFinite(grant.date) ||
    Number(grant.date) < 0 ||
    grant.host !== origin ||
    (grant.logo !== undefined &&
      (typeof grant.logo !== 'string' || grant.logo.length > 2048))
  )
    return invalid();
  if (grant.utxoAccount !== undefined) {
    const reference = fields(grant.utxoAccount, ['slip44', 'xpub']);
    if (
      grant.chain !== 'syscoin' ||
      !Number.isSafeInteger(reference.slip44) ||
      Number(reference.slip44) < 0 ||
      typeof reference.xpub !== 'string' ||
      !reference.xpub ||
      reference.xpub.length > 512
    )
      return invalid();
    Object.freeze(reference);
  } else if (grant.chain === 'syscoin') return invalid();
  return Object.freeze(grant) as DappGrant;
}
/** Preserve grant object identity while detaching the frame's mutable containers. */
function readFrame(value: unknown, origin: string): DappPermissionFrame {
  const frame = fields(value, ['dapps', 'pendingOrigins']);
  const dapps = object(frame.dapps);
  if (
    Object.keys(dapps).some((name) => name !== origin) ||
    !Array.isArray(frame.pendingOrigins) ||
    frame.pendingOrigins.length > 1 ||
    frame.pendingOrigins.some((name) => name !== origin)
  )
    return invalid();
  return Object.freeze({
    dapps: Object.freeze(
      Object.fromEntries(
        Object.entries(dapps).map(([name, grant]) => [
          name,
          readGrant(grant, origin),
        ])
      )
    ),
    pendingOrigins: Object.freeze([
      ...frame.pendingOrigins,
    ]) as readonly string[],
  });
}
function cloneValue<T>(value: T): T {
  return decodeConnectionRecord(encodeConnectionRecord(value)) as T;
}
/** Match the transport SDK's JSON storage semantics without invoking custom serialization. */
function normalizeTransportValue(value: unknown): unknown {
  assertJsonWorkBudget(
    value,
    CONNECTION_RECORD_LIMITS.valueBytes,
    CONNECTION_RECORD_LIMITS.depth,
    CONNECTION_RECORD_LIMITS.nodes
  );
  const json = JSON.stringify(value);
  if (json === undefined) return invalid();
  return JSON.parse(json);
}
function readRecord(value: unknown, walletBindingId: string): ConnectionRecord {
  const detached = fields(cloneValue(value), [
    'version',
    'walletBindingId',
    'sessions',
    'transport',
  ]);
  if (
    detached.version !== 1 ||
    detached.walletBindingId !== walletBindingId ||
    !HEX_32.test(walletBindingId) ||
    !Array.isArray(detached.sessions) ||
    detached.sessions.length > MAX_SESSIONS ||
    !Array.isArray(detached.transport) ||
    detached.transport.length > MAX_TRANSPORT_ENTRIES
  )
    return invalid();
  const sessionIds = new Set<string>();
  const sessions = detached.sessions.map((value): SessionRecord => {
    const row = fields(value, ['binding', 'permissions']);
    const binding = readBinding(row.binding);
    const id = bindingKey(binding);
    if (sessionIds.has(id)) return invalid();
    sessionIds.add(id);
    return Object.freeze({
      binding,
      permissions: readFrame(row.permissions, binding.origin),
    });
  });
  const transportKeys = new Set<string>();
  const transport = detached.transport.map((value): TransportEntry => {
    const row = fields(value, ['key', 'value']);
    validateStorageKey(row.key);
    if (transportKeys.has(row.key)) return invalid();
    transportKeys.add(row.key);
    return Object.freeze({ key: row.key, value: row.value });
  });
  return Object.freeze({
    version: 1,
    walletBindingId,
    sessions: Object.freeze(sessions),
    transport: Object.freeze(transport),
  });
}

/** Recovery validates this domain without returning any transport secrets. */
export function inspectNativeConnectionRecord(
  value: unknown,
  walletBindingId: string
): void {
  readRecord(value, walletBindingId);
}

/** Internal custom-storage surface for the transport SDK, never a screen prop. */
export interface NativeConnectionTransportStorage {
  getKeys(): Promise<string[]>;
  getEntries<T = unknown>(): Promise<[string, T][]>;
  getItem<T = unknown>(key: string): Promise<T | undefined>;
  setItem<T = unknown>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export type NativeConnectionRepository = Readonly<{
  assertHealthy(): void;
  permissions(binding: NativeConnectionBinding): DappPermissionPort;
  /** Trusted host inventory only. Includes public peer identifiers, never protocol secret values. */
  bindings(): readonly NativeConnectionBinding[];
  transport: NativeConnectionTransportStorage;
  retireAccount<T>(
    account: Readonly<{
      accountId: number;
      accountType: KeyringAccountType;
      slip44: number;
    }>,
    operation: (
      commit: (
        key: string,
        expected: unknown,
        value: unknown,
        assertCurrent: () => void
      ) => Promise<boolean>
    ) => Promise<T>,
    assertCurrent: () => void
  ): Promise<T>;
  dispose(): Promise<void>;
}>;

/** One queue owns both protocol KV updates and shared permission transactions. */
export async function openNativeConnectionRepository({
  storage,
  walletBindingId,
  assertOwner,
}: {
  storage: KeyringStoragePort;
  walletBindingId: string;
  /** Installation/wallet/runtime lifetime, separate from temporary screen or lock state. */
  assertOwner(): void;
}): Promise<NativeConnectionRepository> {
  let closed = false;
  let poisoned = false;
  const check = () => {
    if (closed || poisoned) return unavailable();
    let result: unknown;
    try {
      result = assertOwner();
    } catch {
      return unavailable();
    }
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      return unavailable();
    }
  };
  if (
    !storage ||
    ['get', 'createManyIfAbsent', 'compareAndSet', 'compareAndSetMany'].some(
      (name) => typeof storage[name as keyof KeyringStoragePort] !== 'function'
    ) ||
    typeof assertOwner !== 'function'
  )
    return unavailable();
  check();
  if (!HEX_32.test(walletBindingId)) return invalid();
  let persisted = await storage.get(NATIVE_CONNECTION_STORAGE_KEY);
  check();
  const initial: ConnectionRecord =
    persisted === undefined
      ? { version: 1, walletBindingId, sessions: [], transport: [] }
      : readRecord(persisted, walletBindingId);
  // Only a cold load filters uncommitted candidates. Live marked grants remain
  // usable after their commit point when only marker cleanup failed.
  const sessions = new Map(
    initial.sessions.map(({ binding, permissions }) => [
      bindingKey(binding),
      {
        binding,
        permissions: readFrame(
          readStoredDappPermissions(permissions),
          binding.origin
        ),
      },
    ])
  );
  let transport = new Map(
    initial.transport.map(({ key, value }) => [key, value])
  );
  let tail: Promise<unknown> = Promise.resolve();
  let permissionWriter: string | undefined;
  let permissionRevision = 0;
  const queued = <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    const next = tail.then(() => {
      check();
      return operation();
    });
    tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  const transportCall = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await queued(operation);
    } catch {
      // Protocol SDKs can retain an in-memory mutation or swallow a failed read.
      // No subsequent command may treat that state as durably established.
      poisoned = true;
      return unavailable();
    }
  };
  const record = (
    nextSessions = sessions,
    nextTransport = transport
  ): ConnectionRecord => ({
    version: 1,
    walletBindingId,
    sessions: [...nextSessions.values()],
    transport: [...nextTransport].map(([key, value]) => ({ key, value })),
  });
  const persist = async (next: ConnectionRecord) => {
    // Bounds and JSON validation precede storage I/O, including initial creation.
    const detached = readRecord(next, walletBindingId);
    check();
    try {
      const saved =
        persisted === undefined
          ? await storage.createManyIfAbsent(
              { [NATIVE_CONNECTION_STORAGE_KEY]: detached },
              check
            )
          : await storage.compareAndSet(
              NATIVE_CONNECTION_STORAGE_KEY,
              persisted,
              detached,
              undefined,
              check
            );
      if (!saved) return unavailable();
      check();
      persisted = detached;
    } catch {
      poisoned = true;
      return unavailable();
    }
  };
  const matchBinding = (binding: NativeConnectionBinding) => {
    check();
    const present = sessions.get(bindingKey(binding));
    if (present && present.binding.origin !== binding.origin) return invalid();
    return present;
  };
  const withFrame = (
    binding: NativeConnectionBinding,
    frame: DappPermissionFrame
  ) => {
    const next = new Map(sessions);
    if (Object.keys(frame.dapps).length || frame.pendingOrigins.length)
      next.set(bindingKey(binding), { binding, permissions: frame });
    else next.delete(bindingKey(binding));
    if (next.size > MAX_SESSIONS) return invalid();
    return next;
  };
  return Object.freeze({
    assertHealthy: check,
    permissions(input: NativeConnectionBinding): DappPermissionPort {
      const binding = readBinding(input),
        id = bindingKey(binding);
      matchBinding(binding);
      return Object.freeze({
        assertWritable: check,
        exclusive: <T>(operation: () => Promise<T>) =>
          queued(async () => {
            matchBinding(binding);
            permissionWriter = id;
            try {
              return await operation();
            } finally {
              permissionWriter = undefined;
            }
          }),
        read: () => matchBinding(binding)?.permissions ?? EMPTY_FRAME,
        publish: (frame: DappPermissionFrame) => {
          matchBinding(binding);
          const next = withFrame(binding, readFrame(frame, binding.origin));
          sessions.clear();
          for (const [key, value] of next) sessions.set(key, value);
          permissionRevision++;
        },
        write: async (frame: DappPermissionFrame) => {
          matchBinding(binding);
          if (permissionWriter !== id) return unavailable();
          await persist(
            record(withFrame(binding, readFrame(frame, binding.origin)))
          );
        },
      });
    },
    bindings: () => {
      check();
      return Object.freeze(
        [...sessions.values()].map(({ binding }) => binding)
      );
    },
    retireAccount(account, operation, assertCurrent) {
      if (
        !Number.isSafeInteger(account.accountId) ||
        account.accountId < 0 ||
        !ACCOUNT_TYPES.has(account.accountType) ||
        !Number.isSafeInteger(account.slip44) ||
        account.slip44 < 0 ||
        typeof operation !== 'function' ||
        typeof assertCurrent !== 'function'
      )
        return Promise.reject(
          new NativeConnectionStorageError('INVALID_CONNECTION_STATE')
        );
      return queued(async () => {
        const revision = permissionRevision;
        const guard = () => {
          check();
          if (permissionRevision !== revision) return unavailable();
          if (assertCurrent() !== undefined) return unavailable();
        };
        guard();
        const nextSessions = new Map(sessions);
        for (const [key, session] of sessions) {
          const grant = session.permissions.dapps[session.binding.origin];
          if (
            !grant ||
            !matchesDappAccountIdentity(
              grant,
              account.accountId,
              account.accountType
            )
          )
            continue;
          if (
            grant.chain === 'ethereum'
              ? account.slip44 !== 60
              : grant.utxoAccount?.slip44 !== account.slip44
          )
            continue;
          nextSessions.delete(key);
        }
        // An absent domain stays absent, but its absence is checked atomically.
        const next =
          persisted === undefined
            ? undefined
            : readRecord(record(nextSessions), walletBindingId);
        let attempted = false;
        let committed = false;
        let operationPending = true;
        const result = await Promise.resolve()
          .then(() =>
            operation(async (key, expected, value, assertCatalogueCurrent) => {
              if (
                !operationPending ||
                key !== ACCOUNT_RECORD_KEY ||
                attempted ||
                typeof assertCatalogueCurrent !== 'function'
              )
                return invalid();
              const commitGuard = () => {
                guard();
                if (assertCatalogueCurrent() !== undefined)
                  return unavailable();
              };
              commitGuard();
              attempted = true;
              try {
                const saved = await storage.compareAndSetMany(
                  [
                    { key, expected, value },
                    {
                      key: NATIVE_CONNECTION_STORAGE_KEY,
                      expected: persisted,
                      value: next,
                    },
                  ],
                  commitGuard
                );
                if (!saved) {
                  poisoned = true;
                  return false;
                }
                commitGuard();
                committed = true;
                persisted = next;
                sessions.clear();
                for (const [id, session] of nextSessions)
                  sessions.set(id, session);
                permissionRevision++;
                return true;
              } catch {
                poisoned = true;
                return unavailable();
              }
            })
          )
          .catch((error: unknown) => {
            if (attempted) poisoned = true;
            throw error;
          })
          .finally(() => {
            operationPending = false;
          });
        if (!committed) return unavailable();
        check();
        return result;
      });
    },
    transport: Object.freeze({
      getKeys: () => transportCall(async () => [...transport.keys()]),
      getEntries: <T>() =>
        transportCall(async () =>
          [...transport].map(
            ([key, value]) => [key, cloneValue(value) as T] as [string, T]
          )
        ),
      getItem: <T>(key: string) =>
        transportCall(async () => {
          validateStorageKey(key);
          return transport.has(key)
            ? (cloneValue(transport.get(key)) as T)
            : undefined;
        }),
      setItem: <T>(key: string, value: T) =>
        transportCall(async () => {
          validateStorageKey(key);
          const next = new Map(transport);
          next.set(key, normalizeTransportValue(value));
          await persist(record(sessions, next));
          transport = next;
        }),
      removeItem: (key: string) =>
        transportCall(async () => {
          validateStorageKey(key);
          if (!transport.has(key)) return;
          const next = new Map(transport);
          next.delete(key);
          await persist(record(sessions, next));
          transport = next;
        }),
    }),
    async dispose() {
      closed = true;
      await tail;
      sessions.clear();
      transport.clear();
      persisted = undefined;
    },
  });
}
