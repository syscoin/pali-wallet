import {
  buildEvmMinedNonceIndex,
  getEvmSettlementStatus,
} from '../../../../source/utils/evmReplacement.ts';
import type { ActivityRow } from './nativeActivity.ts';
import type { EvmActivityReadScope, LocalActivityRecord } from './types.ts';

const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const includedIndex = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const blockNumber = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value) &&
  Number.isSafeInteger(Number(value));

function admittedLocal(row: ActivityRow, scope: EvmActivityReadScope) {
  const local = row.local;
  if (!local || local.smartAccount || ![0, 2].includes(local.transactionType ?? -1) ||
      !hash(row.hash) || row.hash !== local.hash ||
      local.registrationHash !== scope.network.registrationHash ||
      local.networkId !== scope.network.id || local.chainId !== scope.network.chainId ||
      local.address.toLowerCase() !== scope.address.toLowerCase() ||
      !Number.isSafeInteger(local.nonce) || local.nonce < 0)
    return undefined;
  return local;
}

function mined(row: ActivityRow, local: LocalActivityRecord) {
  if (row.checking || row.unavailable) return undefined;
  const current = row.observation;
  // A fresh pending/unknown observation retires an older retained mined result.
  if (current) {
    if ((current.status !== 'confirmed' && current.status !== 'reverted') || !current.block ||
        current.hash !== local.hash || current.from.toLowerCase() !== local.address.toLowerCase() ||
        current.nonce !== String(local.nonce) ||
        (current.to?.toLowerCase() ?? null) !==
          ((local.token?.contractAddress ?? local.collectibleTransfer?.contractAddress ?? local.recipient)?.toLowerCase() ?? null))
      return undefined;
    return { block: current.block, outcome: current.status, transactionIndex: current.transactionIndex };
  }
  const retained = row.retainedObservation;
  return retained?.status === 'mined' &&
    (retained.outcome === 'confirmed' || retained.outcome === 'reverted') ? retained : undefined;
}
type Entry = { row: ActivityRow; local: LocalActivityRecord; observation: ReturnType<typeof mined> };
const groupKey = (local: LocalActivityRecord) => JSON.stringify([
  local.walletFingerprint, local.accountId, local.registrationHash,
  local.chainId, local.address.toLowerCase(), local.nonce,
]);

/** Refresh completed siblings only when their nonce still has an unresolved local row. */
export function nativeLocalReplacementWinnersToObserve(
  locals: readonly LocalActivityRecord[],
  savedPending: readonly LocalActivityRecord[],
  scope: EvmActivityReadScope
): readonly LocalActivityRecord[] {
  const eligible = (local: LocalActivityRecord) => admittedLocal({
    hash: local.hash, local, checking: false, unavailable: false,
  }, scope);
  const unresolved = new Set([...locals, ...savedPending].filter(local =>
    eligible(local) && ['signed', 'attempted', 'submitted', 'nonce-consumed'].includes(local.phase)
  ).map(groupKey));
  return locals.filter(local => eligible(local) &&
    (local.phase === 'confirmed' || local.phase === 'reverted') && unresolved.has(groupKey(local)));
}

/** Transient display only: a local signed link alone never proves replacement. */
export function nativeLocalReplacementStatuses(
  rows: readonly ActivityRow[],
  scope: EvmActivityReadScope
): ReadonlyMap<string, 'replaced'> {
  const result = new Map<string, 'replaced'>();
  const chainId = Number(scope.network.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return result;
  const groups = new Map<string, Map<string, Entry>>();
  for (const row of rows) {
    const local = admittedLocal(row, scope);
    if (!local) continue;
    const key = groupKey(local);
    const group = groups.get(key) ?? new Map();
    group.set(row.hash, { row, local, observation: mined(row, local) });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const transaction = (entry: Entry) => {
      const { row, local, observation } = entry;
      const block = observation && hash(observation.block.hash) && blockNumber(observation.block.number)
        ? observation.block : undefined;
      return { hash: row.hash, from: local.address, chainId, nonce: local.nonce,
        type: local.transactionType, blockNumber: block?.number,
        txreceipt_status: observation?.outcome === 'confirmed' ? '1' : '0' };
    };
    const winners = [...group.values()].filter(entry =>
      entry.observation && includedIndex(entry.observation.transactionIndex));
    const index = buildEvmMinedNonceIndex(winners.map(transaction), chainId);
    for (const entry of group.values())
      if (getEvmSettlementStatus(transaction(entry), chainId, index) === 'replaced')
        result.set(entry.row.hash, 'replaced');
  }
  return result;
}
