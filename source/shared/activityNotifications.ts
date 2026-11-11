import { getPaliModuleAddress } from '../utils/smartAccount/contracts.ts';

import { getTransactionBlockInfo } from './transactionBlockStatus.ts';
import type {
  GuardianOperationObservation,
  GuardianRecoveryObservation,
} from '../utils/smartAccount/guardianStatus.ts';

export type ActivityNotificationScope = Readonly<{
  accountAddress: string;
  accountId: string;
  accountType: string;
  chainId: string;
  networkKey: string;
  networkType: 'evm' | 'utxo';
}>;
export type ActivityNotificationKind =
  | 'transaction-pending'
  | 'transaction-confirmed'
  | 'transaction-failed'
  | 'transaction-status-unknown'
  | 'recovery-started'
  | 'recovery-cancelled'
  | 'recovery-completed'
  | 'recovery-expired'
  | 'guardian-policy-changed';
export type ActivityNotificationDirection =
  | 'incoming'
  | 'outgoing'
  | 'self'
  | 'unknown';
export type ActivityNotificationFact = Readonly<{
  blockHash?: string;
  blockNumber?: number;
  direction: ActivityNotificationDirection;
  evidence: 'pending-intent' | 'confirmed-event' | 'observed-state';
  key: string;
  kind: ActivityNotificationKind;
  operationId?: string;
  scope: ActivityNotificationScope;
  transactionHash?: string;
}>;
type TransactionSnapshot = Readonly<{
  blockHash?: string;
  blockNumber?: number;
  direction: ActivityNotificationDirection;
  hash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'status-unknown';
  timestamp?: number;
}>;
export type GuardianActivitySnapshot = Readonly<{
  blockHash: string;
  blockNumber: number;
  operations: readonly GuardianOperationObservation[];
  policy: string;
  trackedOperationId?: string;
}>;
export type ActivityNotificationBaseline = Readonly<{
  deliveredKeys: readonly string[];
  guardian: GuardianActivitySnapshot | null;
  historyInitialBlock: number;
  historyInitialized: boolean;
  historyStartedAt: number;
  scopeKey: string;
  transactions: readonly TransactionSnapshot[];
}>;

const MAX_HISTORY = 2048;
const MAX_KEYS = 4096;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const hash = (value: unknown): string | undefined =>
  typeof value === 'string' && HASH.test(value)
    ? value.toLowerCase()
    : undefined;
const integer = (value: unknown): number | undefined => {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && /^\d{1,16}$/.test(value))
  )
    return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};
const binary = (value: unknown): 0 | 1 | undefined => {
  if (value === false || value === 0 || value === '0') return 0;
  if (value === true || value === 1 || value === '1') return 1;
  if (typeof value === 'string' && /^0x0+$/i.test(value)) return 0;
  if (typeof value === 'string' && /^0x0*1$/i.test(value)) return 1;
  return undefined;
};
const amount = (value: unknown): bigint | undefined =>
  typeof value === 'string' && /^-?\d{1,78}$/.test(value)
    ? BigInt(value)
    : undefined;

/** Include the endpoint identity: equal chain IDs do not imply equal networks. */
export function activityNotificationScopeKey(
  scope: ActivityNotificationScope
): string {
  if (
    !scope ||
    !boundedText(scope.accountId, 128) ||
    !boundedText(scope.accountType, 64) ||
    !boundedText(scope.accountAddress, 128) ||
    !boundedText(scope.networkKey, 8192) ||
    !/^(?:0|[1-9]\d{0,77})$/.test(scope.chainId) ||
    !['evm', 'utxo'].includes(scope.networkType) ||
    (scope.networkType === 'evm' && !EVM_ADDRESS.test(scope.accountAddress))
  )
    throw new Error('Invalid activity notification scope');
  return JSON.stringify([
    scope.accountType,
    scope.accountId,
    scope.networkType,
    scope.chainId,
    scope.networkKey,
    scope.networkType === 'evm'
      ? scope.accountAddress.toLowerCase()
      : scope.accountAddress,
  ]);
}

function transactionDirection(
  row: Record<string, any>,
  scope: ActivityNotificationScope
): ActivityNotificationDirection {
  if (scope.networkType === 'evm') {
    const own = scope.accountAddress.toLowerCase();
    const matches = (value: unknown) =>
      typeof value === 'string' &&
      EVM_ADDRESS.test(value) &&
      value.toLowerCase() === own;
    const outgoing =
      matches(row.from) || matches(row.smartAccountExecutionFrom);
    const incoming = matches(row.tokenRecipient) || matches(row.to);
    return outgoing && incoming
      ? 'self'
      : outgoing
      ? 'outgoing'
      : incoming
      ? 'incoming'
      : 'unknown';
  }
  // Blockbook ownership and amounts are account-relative, including xpub
  // change addresses. Native rows retain these facts as net/received/spent.
  const net = amount(row.netUnits);
  const spent = amount(row.spentUnits ?? row.addressValueIn);
  const received = amount(row.receivedUnits ?? row.addressValueOut);
  if (net !== undefined && net !== BigInt(0))
    return net > BigInt(0) ? 'incoming' : 'outgoing';
  if (spent !== undefined && received !== undefined) {
    if (spent === BigInt(0) && received > BigInt(0)) return 'incoming';
    if (spent > BigInt(0)) return 'outgoing';
  }
  if (
    Array.isArray(row.vin) &&
    Array.isArray(row.vout) &&
    row.vin.length + row.vout.length <= MAX_HISTORY
  ) {
    const sends = row.vin.some(
      (entry: unknown) => record(entry)?.isOwn === true
    );
    const receives = row.vout.some(
      (entry: unknown) => record(entry)?.isOwn === true
    );
    if (sends)
      return row.vout.length &&
        row.vout.every((entry: unknown) => record(entry)?.isOwn === true)
        ? 'self'
        : 'outgoing';
    if (receives) return 'incoming';
  }
  return 'unknown';
}

function transactionSnapshot(
  value: unknown,
  scope: ActivityNotificationScope
): TransactionSnapshot | null {
  const row = record(value);
  if (!row) return null;
  const rawHash = hash(row.hash ?? row.txid);
  const transactionHash =
    rawHash &&
    (scope.networkType === 'evm'
      ? rawHash.startsWith('0x')
        ? rawHash
        : undefined
      : rawHash.replace(/^0x/, ''));
  if (!transactionHash) return null;
  if (row.chainId !== undefined && String(row.chainId) !== scope.chainId)
    return null;
  const direction = transactionDirection(row, scope);
  if (direction === 'unknown' && scope.networkType === 'evm') return null;
  const block = record(row.block);
  const height = getTransactionBlockInfo(row) ?? integer(block?.height);
  const blockNumber = height && height > 0 ? height : undefined;
  const blockHash = hash(row.blockHash ?? block?.hash);
  const timestamp = integer(
    row.timestamp ?? row.timeStamp ?? row.blockTime ?? block?.timestamp
  );
  const receipt = binary(row.txreceipt_status) ?? binary(row.status);
  const error = binary(row.isError);
  const status =
    blockNumber === undefined
      ? 'pending'
      : scope.networkType === 'utxo'
      ? 'confirmed'
      : receipt === 0 || error === 1
      ? 'failed'
      : receipt === 1 || error === 0
      ? 'confirmed'
      : 'status-unknown';
  return {
    hash: transactionHash,
    direction,
    status,
    blockNumber,
    blockHash,
    timestamp,
  };
}

function guardianSnapshot(
  observation: GuardianRecoveryObservation,
  scope: ActivityNotificationScope,
  previous: GuardianActivitySnapshot | null
): GuardianActivitySnapshot | null {
  if (
    !record(observation) ||
    scope.networkType !== 'evm' ||
    !EVM_ADDRESS.test(observation.account) ||
    observation.account.toLowerCase() !== scope.accountAddress.toLowerCase() ||
    String(observation.chainId) !== scope.chainId ||
    !EVM_ADDRESS.test(observation.moduleAddress) ||
    observation.moduleAddress.toLowerCase() !==
      getPaliModuleAddress(
        observation.chainId,
        'guardian-recovery'
      ).toLowerCase() ||
    !/^\d{1,78}$/.test(observation.policyEpoch) ||
    !Array.isArray(observation.guardians) ||
    observation.guardians.length > 256 ||
    !observation.guardians.every((address) => EVM_ADDRESS.test(address)) ||
    ![
      observation.threshold,
      observation.delaySeconds,
      observation.expirationSeconds,
    ].every((value) => integer(value) !== undefined) ||
    !hash(observation.observedBlock?.hash) ||
    integer(observation.observedBlock?.number) === undefined
  )
    return null;
  const blockNumber = observation.observedBlock.number;
  const blockHash = observation.observedBlock.hash.toLowerCase();
  // Never interpret a rolled-back or conflicting snapshot as lifecycle success.
  if (
    previous &&
    (blockNumber < previous.blockNumber ||
      (blockNumber === previous.blockNumber &&
        blockHash !== previous.blockHash))
  )
    return null;
  const operations: GuardianOperationObservation[] = [];
  for (const operation of [observation.active, observation.knownOperation]) {
    if (!operation) continue;
    if (
      !/^0x[0-9a-f]{64}$/i.test(operation.operationId) ||
      operation.operationId.toLowerCase() === ZERO_WORD ||
      ![
        'pending',
        'ready',
        'expired',
        'executed',
        'canceled',
        'inactive',
        'unknown',
      ].includes(operation.status) ||
      ![
        operation.scheduledAt,
        operation.executableAt,
        operation.expiresAt,
      ].every((value) => integer(value) !== undefined)
    )
      return null;
    if (
      !operations.some(
        (item) => item.operationId === operation.operationId.toLowerCase()
      )
    )
      operations.push({
        ...operation,
        operationId: operation.operationId.toLowerCase(),
      });
  }
  return {
    blockHash,
    blockNumber,
    operations,
    policy: JSON.stringify([
      observation.exists,
      observation.policyEpoch,
      observation.threshold,
      observation.delaySeconds,
      observation.expirationSeconds,
      observation.guardians.map((address) => address.toLowerCase()).sort(),
    ]),
    trackedOperationId:
      observation.active?.operationId.toLowerCase() ??
      observation.knownOperation?.operationId.toLowerCase() ??
      previous?.trackedOperationId,
  };
}

/** Decode the small public baseline before using persisted host data. Corrupt
 * or cross-scope state rebases quietly instead of fabricating new activity.
 */
export function decodeActivityNotificationBaseline(
  value: unknown,
  scope: ActivityNotificationScope
): ActivityNotificationBaseline | null {
  const input = record(value);
  const scopeKey = activityNotificationScopeKey(scope);
  if (
    !input ||
    input.scopeKey !== scopeKey ||
    typeof input.historyInitialized !== 'boolean' ||
    integer(input.historyStartedAt) === undefined ||
    integer(input.historyInitialBlock) === undefined ||
    !Array.isArray(input.deliveredKeys) ||
    input.deliveredKeys.length > MAX_KEYS ||
    !input.deliveredKeys.every((key: unknown) => boundedText(key, 256)) ||
    !Array.isArray(input.transactions) ||
    input.transactions.length > MAX_HISTORY
  )
    return null;
  const transactions: TransactionSnapshot[] = [];
  for (const transactionValue of input.transactions) {
    const row = record(transactionValue);
    if (
      !row ||
      !hash(row.hash) ||
      !['incoming', 'outgoing', 'self', 'unknown'].includes(row.direction) ||
      !['pending', 'confirmed', 'failed', 'status-unknown'].includes(
        row.status
      ) ||
      (row.blockHash !== undefined && !hash(row.blockHash)) ||
      (row.blockNumber !== undefined &&
        (!integer(row.blockNumber) || row.blockNumber <= 0)) ||
      (row.timestamp !== undefined && integer(row.timestamp) === undefined)
    )
      return null;
    transactions.push({
      hash: row.hash,
      direction: row.direction,
      status: row.status,
      ...(row.blockHash === undefined ? {} : { blockHash: row.blockHash }),
      ...(row.blockNumber === undefined
        ? {}
        : { blockNumber: row.blockNumber }),
      ...(row.timestamp === undefined ? {} : { timestamp: row.timestamp }),
    });
  }
  let guardian: GuardianActivitySnapshot | null = null;
  if (input.guardian !== null) {
    const candidate = record(input.guardian);
    if (
      !candidate ||
      !hash(candidate.blockHash) ||
      integer(candidate.blockNumber) === undefined ||
      !boundedText(candidate.policy, 16384) ||
      (candidate.trackedOperationId !== undefined &&
        !hash(candidate.trackedOperationId)) ||
      !Array.isArray(candidate.operations) ||
      candidate.operations.length > 2
    )
      return null;
    const operations: GuardianOperationObservation[] = [];
    for (const operationValue of candidate.operations) {
      const operation = record(operationValue);
      if (
        !operation ||
        !hash(operation.operationId) ||
        ![
          'pending',
          'ready',
          'expired',
          'executed',
          'canceled',
          'inactive',
          'unknown',
        ].includes(operation.status) ||
        ![
          operation.scheduledAt,
          operation.executableAt,
          operation.expiresAt,
        ].every((time) => integer(time) !== undefined)
      )
        return null;
      operations.push({
        operationId: operation.operationId,
        status: operation.status,
        scheduledAt: operation.scheduledAt,
        executableAt: operation.executableAt,
        expiresAt: operation.expiresAt,
      });
    }
    guardian = {
      blockHash: candidate.blockHash,
      blockNumber: candidate.blockNumber,
      policy: candidate.policy,
      operations,
      ...(candidate.trackedOperationId === undefined
        ? {}
        : { trackedOperationId: candidate.trackedOperationId }),
    };
  }
  return {
    scopeKey,
    historyInitialized: input.historyInitialized,
    historyStartedAt: input.historyStartedAt,
    historyInitialBlock: input.historyInitialBlock,
    transactions,
    guardian,
    deliveredKeys: [...input.deliveredKeys],
  };
}

/** Public observations only. Hosts own reads, storage, registration and delivery.
 * A null or different-scope baseline silently establishes the first snapshot;
 * an initialized empty history still detects its first incoming transaction.
 */
export function detectActivityNotifications({
  scope,
  previous,
  transactions,
  guardianObservation,
  historyReadSucceeded = true,
  observedAt = Date.now(),
}: {
  guardianObservation?: GuardianRecoveryObservation;
  historyReadSucceeded?: boolean;
  observedAt?: number;
  previous: ActivityNotificationBaseline | null;
  scope: ActivityNotificationScope;
  transactions: readonly unknown[];
}): {
  baseline: ActivityNotificationBaseline;
  facts: readonly ActivityNotificationFact[];
} {
  const scopeKey = activityNotificationScopeKey(scope);
  const old = decodeActivityNotificationBaseline(previous, scope);
  const priorTransactions =
    Array.isArray(old?.transactions) && old.transactions.length <= MAX_HISTORY
      ? old.transactions
      : [];
  const keys = new Set(
    Array.isArray(old?.deliveredKeys) && old.deliveredKeys.length <= MAX_KEYS
      ? old.deliveredKeys
      : []
  );
  const facts: ActivityNotificationFact[] = [];
  const emit = (
    fact: Omit<ActivityNotificationFact, 'key' | 'scope'>,
    identity: string
  ) => {
    // The enclosing baseline supplies the exact scope; avoid repeating the
    // endpoint in every persisted deduplication entry.
    const key = `${identity}:${fact.kind}`;
    if (keys.has(key)) return;
    keys.add(key);
    facts.push({ ...fact, key: `${scopeKey}:${key}`, scope });
  };
  let historyInitialized = old?.historyInitialized === true;
  let historyStartedAt = old?.historyStartedAt ?? 0;
  let historyInitialBlock = old?.historyInitialBlock ?? 0;
  let snapshots = priorTransactions;
  if (
    historyReadSucceeded &&
    Array.isArray(transactions) &&
    transactions.length <= MAX_HISTORY
  ) {
    const current = new Map<string, TransactionSnapshot>();
    for (const row of transactions) {
      const next = transactionSnapshot(row, scope);
      if (!next) continue;
      const duplicate = current.get(next.hash);
      const priority = {
        pending: 0,
        'status-unknown': 1,
        confirmed: 2,
        failed: 3,
      };
      const selected =
        !duplicate || priority[next.status] > priority[duplicate.status]
          ? next
          : duplicate;
      const direction =
        duplicate && duplicate.direction !== next.direction
          ? 'self'
          : next.direction;
      current.set(next.hash, { ...selected, direction });
    }
    const prior = new Map(priorTransactions.map((row) => [row.hash, row]));
    if (historyInitialized) {
      for (const next of current.values()) {
        const before = prior.get(next.hash);
        // Losing a receipt during a reorg is never a fresh pending intent.
        if (before && before.status !== 'pending' && next.status === 'pending')
          continue;
        if (before?.status === next.status) continue;
        // A later-discovered older page is baseline history, not new activity.
        if (
          !before &&
          next.status !== 'pending' &&
          ((historyStartedAt > 0 &&
            next.timestamp !== undefined &&
            next.timestamp * 1000 <= historyStartedAt) ||
            (next.timestamp === undefined &&
              (next.blockNumber ?? 0) <= historyInitialBlock))
        )
          continue;
        emit(
          {
            kind: `transaction-${next.status}`,
            evidence:
              next.status === 'pending' ? 'pending-intent' : 'observed-state',
            direction: next.direction,
            transactionHash: next.hash,
            ...(next.blockNumber === undefined
              ? {}
              : { blockNumber: next.blockNumber }),
            ...(next.blockHash === undefined
              ? {}
              : { blockHash: next.blockHash }),
          },
          next.hash
        );
      }
    } else {
      historyInitialized = true;
      // An initialized empty account must notify its first observed transfer,
      // even when the block clock predates our local polling clock.
      historyStartedAt = current.size ? integer(observedAt) ?? 0 : 0;
      historyInitialBlock = Math.max(
        0,
        ...Array.from(current.values()).map((row) => row.blockNumber ?? 0)
      );
    }
    // Retain recently observed identities even when a short page moves past them.
    snapshots = [
      ...Array.from(current.values()).map((row) => {
        const before = prior.get(row.hash);
        return before &&
          before.status !== 'pending' &&
          (row.status === 'pending' ||
            (row.status === 'status-unknown' &&
              before.status !== 'status-unknown'))
          ? before
          : row;
      }),
      ...priorTransactions.filter((row) => !current.has(row.hash)),
    ].slice(0, MAX_HISTORY);
  }
  let guardian = old?.guardian ?? null;
  if (guardianObservation) {
    const next = guardianSnapshot(guardianObservation, scope, guardian);
    if (next && guardian) {
      if (next.policy !== guardian.policy)
        emit(
          {
            kind: 'guardian-policy-changed',
            direction: 'unknown',
            evidence: 'observed-state',
            blockNumber: next.blockNumber,
            blockHash: next.blockHash,
          },
          `policy:${next.blockHash}`
        );
      for (const operation of next.operations) {
        const before = guardian.operations.find(
          (item) => item.operationId === operation.operationId
        );
        if (before?.status === operation.status) continue;
        const kind =
          operation.status === 'executed'
            ? 'recovery-completed'
            : operation.status === 'canceled'
            ? 'recovery-cancelled'
            : operation.status === 'expired'
            ? 'recovery-expired'
            : ['pending', 'ready'].includes(operation.status) && !before
            ? 'recovery-started'
            : null;
        if (kind)
          emit(
            {
              kind,
              direction: 'unknown',
              evidence: 'observed-state',
              operationId: operation.operationId,
              blockNumber: next.blockNumber,
              blockHash: next.blockHash,
            },
            operation.operationId
          );
      }
    }
    if (next) guardian = next;
  }
  return {
    baseline: {
      scopeKey,
      historyInitialized,
      historyStartedAt,
      historyInitialBlock,
      transactions: snapshots,
      guardian,
      deliveredKeys: [...keys].slice(-MAX_KEYS),
    },
    facts,
  };
}
