import { utils as syscoinUtils } from 'syscoinjs-lib';
import { parseUtxoPublicIdentifier } from './utxoIdentifier.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { getUtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { openUtxoReadSession, utxoCount, utxoFailure, utxoFetchOptions, utxoObject, utxoUnits, UtxoBalanceError, type UtxoFetch, type UtxoReadSession } from './utxoReadSession.ts';
export { UtxoBalanceError, type UtxoBalanceErrorCode } from './utxoReadSession.ts';

export type UtxoBalance = Readonly<{
  networkId: UtxoNetworkId; kind: 'utxo'; chainId: 0 | 57; genesisHash: string;
  confirmedUnits: string; pendingDeltaUnits: string; unconfirmedTransactions: number; observedHeight: number;
}>;
export interface UtxoBalanceReader {
  readBalance(networkId: UtxoNetworkId, address: string, signal: AbortSignal): Promise<UtxoBalance>;
  readAccount(networkId: UtxoNetworkId, identifier: string, signal: AbortSignal): Promise<UtxoBalance>;
}

/** The same SJS account query used by the extension, with the native bounded transport. */
export function createUtxoBalanceReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoBalanceReader {
  const checked = utxoFetchOptions(options);
  async function read(networkId: UtxoNetworkId, identifier: string, isAccount: boolean, signal: AbortSignal): Promise<UtxoBalance> {
    if (signal.aborted) return utxoFailure('CANCELLED');
    let canonical: string;
    try {
      getUtxoNetwork(networkId);
      if (isAccount) {
        const source = parseUtxoPublicIdentifier(identifier, networkId);
        if (source.kind !== 'account') return utxoFailure('INVALID_INPUT');
        canonical = source.identifier;
      } else canonical = normalizeUtxoAddress(identifier, networkId);
    } catch { return utxoFailure('INVALID_INPUT'); }
    let session: UtxoReadSession | undefined;
    try {
      session = await openUtxoReadSession(networkId, checked, signal);
      const active = session, prefix = active.network.endpoint.replace(/\/$/, '');
      const summary = utxoObject(await syscoinUtils.fetchBackendAccount(prefix, canonical, 'details=tokenBalances&tokens=nonzero', isAccount, undefined, {
        signal,
        // SJS owns account routing. The native session owns cancellation, identity and size bounds.
        fetch: async (url: string, init: RequestInit) => {
          if (init.method !== 'GET' || init.signal !== signal || !url.startsWith(prefix + '/api/v2/')) return utxoFailure('INVALID_INPUT');
          const body = await active.read(url.slice(prefix.length));
          return { ok: true, json: async () => body };
        },
      }));
      if (summary.address !== canonical) return utxoFailure('INVALID_RESPONSE');
      return Object.freeze({ networkId, kind: 'utxo', chainId: active.network.chainId, genesisHash: active.network.genesisHash,
        confirmedUnits: utxoUnits(summary.balance, false), pendingDeltaUnits: utxoUnits(summary.unconfirmedBalance, true),
        unconfirmedTransactions: utxoCount(summary.unconfirmedTxs), observedHeight: active.observedHeight });
    } catch (cause) { throw cause instanceof UtxoBalanceError ? cause : new UtxoBalanceError(signal.aborted ? 'CANCELLED' : 'UNAVAILABLE'); }
    finally { session?.close(); }
  }
  return Object.freeze({
    readBalance: (networkId: UtxoNetworkId, address: string, signal: AbortSignal) => read(networkId, address, false, signal),
    readAccount: (networkId: UtxoNetworkId, identifier: string, signal: AbortSignal) => read(networkId, identifier, true, signal),
  });
}
