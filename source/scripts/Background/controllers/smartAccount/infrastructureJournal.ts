import {
  createInfrastructureJournal,
  parseInfrastructureJournalEntry,
  type InfrastructureNetworkContext,
} from '../../../../wallet/infrastructureJournal.ts';
import { chromeStorage } from 'utils/storageAPI';

export {
  infrastructurePendingIdentity,
  type InfrastructureJournalEntry,
  type InfrastructureNetworkContext,
} from '../../../../wallet/infrastructureJournal.ts';

export const infrastructureJournalStorageKey = (
  context: InfrastructureNetworkContext
) => `pali.infrastructure.pending.v2.${context.chainId}`;
const legacyStorageKey = (chainId: number) =>
  `pali.infrastructure.pending.v1.${chainId}`;

const readEntry = async (key: string) =>
  parseInfrastructureJournalEntry(await chromeStorage.getItem(key), false);

const journal = createInfrastructureJournal({
  async read(context, assertCurrent) {
    if (assertCurrent !== null) assertCurrent();
    const legacy = await readEntry(legacyStorageKey(context.chainId));
    if (assertCurrent !== null) assertCurrent();
    // A chain ID cannot identify which fork accepted an older attempt. Keep it
    // pending on every endpoint; never migrate or clear it using unrelated RPCs.
    if (legacy) return { ...legacy, rpcUrl: undefined };
    const current = await readEntry(infrastructureJournalStorageKey(context));
    if (assertCurrent !== null) assertCurrent();
    return parseInfrastructureJournalEntry(current, true);
  },
  write: (context, entry) =>
    chromeStorage.setItem(infrastructureJournalStorageKey(context), entry),
});

export const readInfrastructureJournal = journal.read;
export const writeInfrastructureJournal = journal.write;
export const clearInfrastructureJournal = journal.clear;
