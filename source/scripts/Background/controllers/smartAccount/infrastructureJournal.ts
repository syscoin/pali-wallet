import { AsyncMutex } from 'utils/asyncMutex';
import type { PaliInfrastructureContractId } from 'utils/smartAccount';
import { chromeStorage } from 'utils/storageAPI';

export type InfrastructureJournalEntry = {
  attemptId?: string;
  contractId: PaliInfrastructureContractId;
  nonce?: number;
  payerAddress?: string;
  transactionHash?: string;
};

const mutexes = new Map<number, AsyncMutex>();
const storageKey = (chainId: number) =>
  `pali.infrastructure.pending.v1.${chainId}`;
const mutexForChain = (chainId: number) => {
  let mutex = mutexes.get(chainId);
  if (!mutex) {
    mutex = new AsyncMutex();
    mutexes.set(chainId, mutex);
  }
  return mutex;
};

const readEntry = async (
  chainId: number
): Promise<InfrastructureJournalEntry | undefined> => {
  const value = await chromeStorage.getItem(storageKey(chainId));
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
        !/^0x[0-9a-fA-F]{40}$/.test(value.payerAddress)))
  )
    throw new Error(
      'Deployment journal is unreadable. Refresh status before retrying.'
    );
  return value;
};

export const infrastructurePendingIdentity = (
  entry?: InfrastructureJournalEntry
) => entry?.attemptId || entry?.transactionHash;

// Public on-chain identifiers survive worker/wallet changes. Never treat failed
// storage reads as absence, or let a stale receipt clear a newer submission.
export const readInfrastructureJournal = (chainId: number) =>
  mutexForChain(chainId).runExclusive(() => readEntry(chainId));

export const writeInfrastructureJournal = (
  chainId: number,
  entry: InfrastructureJournalEntry
) =>
  mutexForChain(chainId).runExclusive(async () => {
    const current = await readEntry(chainId);
    if (
      current &&
      infrastructurePendingIdentity(current) !==
        infrastructurePendingIdentity(entry)
    ) {
      throw new Error(
        'Another infrastructure deployment is pending on this network.'
      );
    }
    await chromeStorage.setItem(storageKey(chainId), entry);
  });

export const clearInfrastructureJournal = (
  chainId: number,
  expected: InfrastructureJournalEntry
) =>
  mutexForChain(chainId).runExclusive(async () => {
    const current = await readEntry(chainId);
    if (
      current &&
      infrastructurePendingIdentity(current) ===
        infrastructurePendingIdentity(expected) &&
      current.contractId === expected.contractId
    ) {
      await chromeStorage.setItem(storageKey(chainId), null);
    }
  });
