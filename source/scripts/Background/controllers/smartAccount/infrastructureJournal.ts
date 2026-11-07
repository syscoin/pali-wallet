import { AsyncMutex } from 'utils/asyncMutex';
import type { PaliInfrastructureContractId } from 'utils/smartAccount';
import { chromeStorage } from 'utils/storageAPI';

export type InfrastructureNetworkContext = {
  chainId: number;
  url: string;
};

export type InfrastructureJournalEntry = {
  attemptId?: string;
  contractId: PaliInfrastructureContractId;
  nonce?: number;
  payerAddress?: string;
  // Missing only for legacy records whose original RPC cannot be established.
  rpcUrl?: string;
  transactionHash?: string;
};

const mutexes = new Map<number, AsyncMutex>();
export const infrastructureJournalStorageKey = (
  context: InfrastructureNetworkContext
) => `pali.infrastructure.pending.v2.${context.chainId}`;
const legacyStorageKey = (chainId: number) =>
  `pali.infrastructure.pending.v1.${chainId}`;
const mutexForNetwork = (context: InfrastructureNetworkContext) => {
  const key = context.chainId;
  let mutex = mutexes.get(key);
  if (!mutex) {
    mutex = new AsyncMutex();
    mutexes.set(key, mutex);
  }
  return mutex;
};

const readEntry = async (
  key: string
): Promise<InfrastructureJournalEntry | undefined> => {
  const value = await chromeStorage.getItem(key);
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.contractId !== 'string' ||
    (value.transactionHash !== undefined &&
      (typeof value.transactionHash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash))) ||
    (value.attemptId !== undefined &&
      (typeof value.attemptId !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.attemptId))) ||
    (!value.transactionHash && !value.attemptId) ||
    (value.nonce !== undefined &&
      (!Number.isSafeInteger(value.nonce) || value.nonce < 0)) ||
    (value.payerAddress !== undefined &&
      (typeof value.payerAddress !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(value.payerAddress))) ||
    (value.rpcUrl !== undefined &&
      (typeof value.rpcUrl !== 'string' || !value.rpcUrl))
  )
    throw new Error(
      'Deployment journal is unreadable. Refresh status before retrying.'
    );
  return value;
};

const readNetworkEntry = async (
  context: InfrastructureNetworkContext,
  assertCurrent: (() => void) | null
) => {
  if (assertCurrent !== null) assertCurrent();
  const legacy = await readEntry(legacyStorageKey(context.chainId));
  if (assertCurrent !== null) assertCurrent();
  // A chain ID cannot identify which fork accepted an older attempt. Keep it
  // pending on every endpoint; never migrate or clear it using unrelated RPCs.
  if (legacy) return { ...legacy, rpcUrl: undefined };
  const current = await readEntry(infrastructureJournalStorageKey(context));
  if (assertCurrent !== null) assertCurrent();
  if (current && current.rpcUrl === undefined)
    throw new Error(
      'Deployment journal is unreadable. Refresh status before retrying.'
    );
  return current;
};

export const infrastructurePendingIdentity = (
  entry?: InfrastructureJournalEntry
) => entry?.attemptId || entry?.transactionHash;

// One unresolved deployment owns a chain ID across RPC aliases. Only its exact
// RPC may reconcile it; failed reads and stale receipts never authorize a send.
export const readInfrastructureJournal = (
  context: InfrastructureNetworkContext,
  assertCurrent: () => void
) =>
  mutexForNetwork(context).runExclusive(() =>
    readNetworkEntry(context, () => assertCurrent())
  );

export const writeInfrastructureJournal = (
  context: InfrastructureNetworkContext,
  entry: InfrastructureJournalEntry
) =>
  mutexForNetwork(context).runExclusive(async () => {
    const current = await readNetworkEntry(context, null);
    if (
      entry.rpcUrl !== context.url ||
      (current &&
        (current.rpcUrl !== context.url ||
          infrastructurePendingIdentity(current) !==
            infrastructurePendingIdentity(entry)))
    ) {
      throw new Error(
        'Another infrastructure deployment is pending on this network.'
      );
    }
    await chromeStorage.setItem(
      infrastructureJournalStorageKey(context),
      entry
    );
  });

export const clearInfrastructureJournal = (
  context: InfrastructureNetworkContext,
  expected: InfrastructureJournalEntry,
  // An admitted deployment can reconcile its exact attempt after retirement.
  assertCurrent: (() => void) | null
) =>
  mutexForNetwork(context).runExclusive(async () => {
    const current = await readNetworkEntry(context, assertCurrent);
    if (
      current &&
      current.rpcUrl === context.url &&
      expected.rpcUrl === context.url &&
      infrastructurePendingIdentity(current) ===
        infrastructurePendingIdentity(expected) &&
      current.contractId === expected.contractId
    ) {
      if (assertCurrent !== null) assertCurrent();
      await chromeStorage.setItem(
        infrastructureJournalStorageKey(context),
        null
      );
    }
  });
