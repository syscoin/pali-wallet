import { AsyncMutex } from '../utils/asyncMutex.ts';

import type { PaliInfrastructureContractId } from '../utils/smartAccount/deployment.ts';

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

/** Preserve the stored object; the caller separately checks the configured contract catalogue. */
export function parseInfrastructureJournalEntry(
  value: unknown,
  requireRpc: boolean
): InfrastructureJournalEntry | undefined {
  if (typeof requireRpc !== 'boolean')
    throw new Error('Infrastructure journal RPC policy is required');
  if (value === null || value === undefined) return undefined;
  const entry = value as Record<string, unknown>;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof entry.contractId !== 'string' ||
    (entry.transactionHash !== undefined &&
      (typeof entry.transactionHash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(entry.transactionHash))) ||
    (entry.attemptId !== undefined &&
      (typeof entry.attemptId !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(entry.attemptId))) ||
    (!entry.transactionHash && !entry.attemptId) ||
    (entry.nonce !== undefined &&
      (typeof entry.nonce !== 'number' ||
        !Number.isSafeInteger(entry.nonce) ||
        entry.nonce < 0)) ||
    (entry.payerAddress !== undefined &&
      (typeof entry.payerAddress !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(entry.payerAddress))) ||
    (entry.rpcUrl !== undefined &&
      (typeof entry.rpcUrl !== 'string' || !entry.rpcUrl)) ||
    (requireRpc && entry.rpcUrl === undefined)
  )
    throw new Error(
      'Deployment journal is unreadable. Refresh status before retrying.'
    );
  return value as InfrastructureJournalEntry;
}

export const infrastructurePendingIdentity = (
  entry?: InfrastructureJournalEntry
) => entry?.attemptId || entry?.transactionHash;

export type InfrastructureJournalStorage = Readonly<{
  /** The adapter owns format selection, parsing and read-boundary owner checks. */
  read(
    context: InfrastructureNetworkContext,
    assertCurrent: (() => void) | null
  ): Promise<InfrastructureJournalEntry | undefined>;
  write(
    context: InfrastructureNetworkContext,
    entry: InfrastructureJournalEntry | null
  ): Promise<void>;
}>;

/** Keep one instance per fixed storage domain. Mutexes serialize this process only;
 * unresolved attempts still require durable host storage across restarts. */
export function createInfrastructureJournal(
  storage: InfrastructureJournalStorage
) {
  if (
    typeof storage?.read !== 'function' ||
    typeof storage.write !== 'function'
  )
    throw new Error('Infrastructure journal storage is required');
  const read = storage.read.bind(storage),
    write = storage.write.bind(storage);
  const mutexes = new Map<number, AsyncMutex>();
  const mutexForNetwork = (context: InfrastructureNetworkContext) => {
    let mutex = mutexes.get(context.chainId);
    if (!mutex) {
      mutex = new AsyncMutex();
      mutexes.set(context.chainId, mutex);
    }
    return mutex;
  };
  return Object.freeze({
    read: (context: InfrastructureNetworkContext, assertCurrent: () => void) =>
      mutexForNetwork(context).runExclusive(() =>
        read(context, () => assertCurrent())
      ),
    write: (
      context: InfrastructureNetworkContext,
      entry: InfrastructureJournalEntry
    ) =>
      mutexForNetwork(context).runExclusive(async () => {
        const current = await read(context, null);
        if (
          entry.rpcUrl !== context.url ||
          (current &&
            (current.rpcUrl !== context.url ||
              infrastructurePendingIdentity(current) !==
                infrastructurePendingIdentity(entry)))
        )
          throw new Error(
            'Another infrastructure deployment is pending on this network.'
          );
        await write(context, entry);
      }),
    clear: (
      context: InfrastructureNetworkContext,
      expected: InfrastructureJournalEntry,
      // An admitted deployment can reconcile its exact attempt after retirement.
      assertCurrent: (() => void) | null
    ) =>
      mutexForNetwork(context).runExclusive(async () => {
        const current = await read(context, assertCurrent);
        if (
          current &&
          current.rpcUrl === context.url &&
          expected.rpcUrl === context.url &&
          infrastructurePendingIdentity(current) ===
            infrastructurePendingIdentity(expected) &&
          current.contractId === expected.contractId
        ) {
          if (assertCurrent !== null) assertCurrent();
          await write(context, null);
        }
      }),
  });
}
