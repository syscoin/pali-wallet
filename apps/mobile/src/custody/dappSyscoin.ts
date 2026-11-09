import { UTXO_ACTIVITY_LIMITS } from '../core/utxoActivity.ts';
import type { DappSyscoinReadRequest } from '../../../../source/shared/dappSyscoinReads.ts';
import { projectDappSyscoinTransactions } from '../../../../source/shared/dappSyscoinReads.ts';
import { sentryDappCapabilities } from '../../../../source/shared/sentryDappCapabilities.ts';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks.ts';
import { createBlockbookAccountHistory, readHistoryCount } from '../../../../source/shared/blockbookAccountHistory.ts';
import { assertJsonWorkBudget } from '../../../../source/utils/requestPayloadBudget.ts';
import type { NativeConnectionAccount } from '../connections/host.ts';
import { findUtxoNetwork, getUtxoSdkNetwork, resolveUtxoNetwork, type UtxoNetwork } from '../core/utxoNetworks.ts';
import { parseUtxoPublicIdentifier } from '../core/utxoIdentifier.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { openUtxoReadSession } from '../core/utxoReadSession.ts';
import type { NativeCustodyAuthority } from './authority.ts';

export type NativeConnectionUtxoHost = Readonly<{
  registration(): UtxoNetwork;
  anchor(xpub: string): string;
  read(request: DappSyscoinReadRequest, owner: NativeConnectionAccount, signal: AbortSignal, assertCurrent: () => void): Promise<unknown>;
}>;
export type NativeConnectionUtxoPublicMethod = 'getChangeAddress' | 'getCurrentAddressPubkey' | 'getBip32Path';
export type NativeConnectionUtxoPublicRead = (method: NativeConnectionUtxoPublicMethod, owner: Readonly<{ accountId: string; xpub: string }>, isChangeAddress: boolean, signal: AbortSignal, assertCurrent: () => void) => Promise<string>;

/** Public reads retain the saved full-genesis registration and the granted stable account key. */
export function createNativeDappSyscoinHost(ports: Readonly<{
  source: Pick<NativeCustodyAuthority, 'getSnapshot' | 'getCatalogue'>;
  readPublic: NativeConnectionUtxoPublicRead;
  fetch(url: string, init: RequestInit): Promise<Response>;
}>): NativeConnectionUtxoHost {
  const registration = () => {
    const state = ports.source.getSnapshot(), catalogue = ports.source.getCatalogue();
    const network = catalogue && findUtxoNetwork(catalogue.active.networkId, catalogue.utxoNetworks);
    if (state.phase !== 'ready' || !network || state.account?.network !== network.id) throw new Error('CONTEXT_CHANGED');
    return resolveUtxoNetwork(network);
  };
  const history = createBlockbookAccountHistory(async () => { throw new Error('An owned history read is required'); });
  return Object.freeze({ registration, anchor: xpub => parseUtxoPublicIdentifier(xpub, registration()).address,
    async read(request, owner, signal, assertCurrent) {
      const network = registration(), captured = JSON.stringify(network);
      const check = () => { assertCurrent(); if (signal.aborted || JSON.stringify(registration()) !== captured) throw new Error('CONTEXT_CHANGED'); };
      check();
      const account = parseUtxoPublicIdentifier(owner.xpub, network);
      if (account.identifier !== owner.xpub) throw new Error('CONTEXT_CHANGED');
      switch (request.method) {
        case 'sys_requestAccounts': return [owner.address];
        case 'sys_getAccount': return { id: owner.index, label: owner.label, address: owner.address, xpub: owner.xpub };
        case 'sys_isConnected': return true;
        case 'sys_getNetwork': return getUtxoSdkNetwork(network);
        case 'sys_getPublicKey': return owner.xpub;
        case 'sys_isValidSYSAddress': try { normalizeUtxoAddress(request.params[0] as string, network); return true; } catch { return false; }
        case 'sys_getSentryCapabilities':
          if (!Object.values(SENTRY_NETWORKS).some(value => value.chainId === network.chainId && value.genesisHash === network.genesisHash)) throw new Error('Sentry is unavailable on this network');
          return sentryDappCapabilities();
        case 'sys_getChangeAddress': case 'sys_getCurrentAddressPubkey': case 'sys_getBip32Path': {
          const method = request.method.slice(4) as NativeConnectionUtxoPublicMethod;
          const result = await ports.readPublic(method, { accountId: owner.id, xpub: owner.xpub }, !!(request.params[0] as { isChangeAddress?: boolean } | undefined)?.isChangeAddress, signal, check);
          check(); return result;
        }
        case 'sys_getTransactions': case 'sys_transaction': {
          const session = await openUtxoReadSession(network, { fetch: ports.fetch, timeoutMs: UTXO_ACTIVITY_LIMITS.timeoutMs }, signal, true, UTXO_ACTIVITY_LIMITS.bytes * (UTXO_ACTIVITY_LIMITS.windowPages + 2), UTXO_ACTIVITY_LIMITS.bytes, check);
          try {
            const rows = new Map<string, Record<string, unknown>>();
            // Same public activity window as native Activity: five pages of twenty rows.
            for (let page = 1; page <= UTXO_ACTIVITY_LIMITS.windowPages; page++) {
              const data = await history.fetchAccountHistory(network.endpoint, owner.xpub, history.getHistoryRequestOptions(network.endpoint, owner.xpub, page, UTXO_ACTIVITY_LIMITS.pageSize), page > 1, {
                assertCurrent: check,
                fetch: async (url, identifier, query) => {
                  check(); if (url !== network.endpoint || identifier !== owner.xpub) throw new Error('CONTEXT_CHANGED');
                  const result = await session.read(`/api/v2/${account.kind === 'account' ? 'xpub' : 'address'}/${encodeURIComponent(identifier)}?${query}`, true);
                  check(); assertJsonWorkBudget(result);
                  const transactions = (result as { transactions?: unknown }).transactions;
                  if (transactions !== undefined && (!Array.isArray(transactions) || transactions.length > UTXO_ACTIVITY_LIMITS.pageSize)) throw new Error('Invalid history page');
                  return result;
                },
              });
              check();
              for (const row of data.transactions) rows.set(row.txid, row);
              const totalPages = readHistoryCount(data.totalPages);
              if (!data.transactions.length || totalPages !== null && page >= totalPages) break;
            }
            await session.verifyAnchor(); check();
            const result = projectDappSyscoinTransactions([...rows.values()]); assertJsonWorkBudget(result);
            return request.method === 'sys_transaction' ? result.find(row => row.txid === request.params[0]) ?? null : result;
          } finally { session.close(); }
        }
      }
    },
  });
}
