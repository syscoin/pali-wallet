import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { openUtxoReadSession, utxoCount, utxoFailure, utxoFetchOptions, utxoObject, utxoUnits, type UtxoFetch } from './utxoReadSession.ts';
import type { UtxoNetworkId } from './utxoNetworks.ts';

export type UtxoAddressUsage = Readonly<{ address: string; confirmedUnits: string; pendingDeltaUnits: string; historicalTransactions: number; unconfirmedTransactions: number; used: boolean }>;
export interface UtxoAddressUsageSession {
  readonly observedHeight: number;
  readonly anchorHash: string;
  readAddress(address: string): Promise<UtxoAddressUsage>;
  verifyAnchor(): Promise<number>;
  consumedBytes(): number;
  close(): void;
}
export interface UtxoAddressUsageReader {
  open(network: UtxoNetworkId, signal: AbortSignal): Promise<UtxoAddressUsageSession>;
}
/** Address-only disclosure; no xpub, tx construction or spending eligibility. */
export function createUtxoAddressUsageReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoAddressUsageReader {
  const checked = utxoFetchOptions(options, 30000);
  return Object.freeze({ async open(network: UtxoNetworkId, signal: AbortSignal) {
    const session = await openUtxoReadSession(network, checked, signal, true, 512 * 1024);
    return Object.freeze({ observedHeight: session.observedHeight, anchorHash: session.anchorHash!,
      verifyAnchor: () => session.verifyAnchor(), consumedBytes: () => session.consumedBytes(), close: () => session.close(),
      async readAddress(address: string): Promise<UtxoAddressUsage> {
        try {
          const canonical = normalizeUtxoAddress(address, network);
          const raw = utxoObject(await session.read(`/api/v2/address/${encodeURIComponent(canonical)}?details=tokens`));
          if (raw.address !== canonical) return utxoFailure('INVALID_RESPONSE');
          const confirmedUnits = utxoUnits(raw.balance, false), pendingDeltaUnits = utxoUnits(raw.unconfirmedBalance, true);
          const historicalTransactions = utxoCount(raw.txs), unconfirmedTransactions = utxoCount(raw.unconfirmedTxs);
          return Object.freeze({ address: canonical, confirmedUnits, pendingDeltaUnits, historicalTransactions, unconfirmedTransactions,
            used: historicalTransactions > 0 || unconfirmedTransactions > 0 || BigInt(confirmedUnits) !== 0n || BigInt(pendingDeltaUnits) !== 0n });
        } catch (cause) { session.close(); throw cause; }
      },
    });
  } });
}
