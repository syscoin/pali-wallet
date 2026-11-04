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
}

/** Existing one-address observation: metadata + genesis + summary, one deadline. */
export function createUtxoBalanceReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoBalanceReader {
  const checked = utxoFetchOptions(options);
  return Object.freeze({
    async readBalance(networkId: UtxoNetworkId, address: string, signal: AbortSignal): Promise<UtxoBalance> {
      if (signal.aborted) return utxoFailure('CANCELLED');
      let canonical: string;
      try { getUtxoNetwork(networkId); canonical = normalizeUtxoAddress(address, networkId); } catch { return utxoFailure('INVALID_INPUT'); }
      let session: UtxoReadSession | undefined;
      try {
        session = await openUtxoReadSession(networkId, checked, signal);
        // Basic omits pending amounts. Ignore asset data; bound the whole body.
        const summary = utxoObject(await session.read(`/api/v2/address/${encodeURIComponent(canonical)}?details=tokens`));
        if (summary.address !== canonical) return utxoFailure('INVALID_RESPONSE');
        return Object.freeze({ networkId, kind: 'utxo', chainId: session.network.chainId, genesisHash: session.network.genesisHash,
          confirmedUnits: utxoUnits(summary.balance, false), pendingDeltaUnits: utxoUnits(summary.unconfirmedBalance, true),
          unconfirmedTransactions: utxoCount(summary.unconfirmedTxs), observedHeight: session.observedHeight });
      } catch (cause) { throw cause instanceof UtxoBalanceError ? cause : new UtxoBalanceError('UNAVAILABLE'); }
      finally { session?.close(); }
    },
  });
}
