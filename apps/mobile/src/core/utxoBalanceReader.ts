import { utils as syscoinUtils } from 'syscoinjs-lib';
import { parseSptInventory, projectSptBalance, supportsSptUtxoChain, type SptBalance } from '../../../../source/shared/sptInventory.ts';
import { assertBaseUnits } from './amounts.ts';
import { parseUtxoPublicIdentifier } from './utxoIdentifier.ts';
import { normalizeUtxoAddress } from './utxoAddresses.ts';
import { resolveUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from './utxoNetworks.ts';
import { openUtxoReadSession, utxoCount, utxoFailure, utxoFetchOptions, utxoObject, utxoUnits, UtxoBalanceError, type UtxoFetch, type UtxoReadSession } from './utxoReadSession.ts';
export { UtxoBalanceError, type UtxoBalanceErrorCode } from './utxoReadSession.ts';

export type UtxoSptBalance = SptBalance;
export type UtxoBalance = Readonly<{
  networkId: UtxoNetworkId; kind: 'utxo'; chainId: number; genesisHash: string;
  confirmedUnits: string; pendingDeltaUnits: string; unconfirmedTransactions: number; observedHeight: number;
  assets?: readonly SptBalance[];
}>;
export interface UtxoBalanceReader {
  readBalance(scope: UtxoNetworkId | UtxoNetwork, address: string, signal: AbortSignal, assertCurrent?: () => void): Promise<UtxoBalance>;
  readAccount(scope: UtxoNetworkId | UtxoNetwork, identifier: string, signal: AbortSignal, assertCurrent?: () => void): Promise<UtxoBalance>;
}

function readSptBalances(summary: Record<string, unknown>, identifier: string): readonly SptBalance[] | undefined {
  try {
    return Object.freeze([...parseSptInventory(summary, identifier).holdings.values()].map(holding => {
      const value = projectSptBalance(holding);
      assertBaseUnits(value.confirmedUnits);
      assertBaseUnits(value.pendingDeltaUnits.replace(/^-/, ''));
      return value;
    }));
  } catch { return undefined; }
}

/** The same SJS account query used by the extension, with the native bounded transport. */
export function createUtxoBalanceReader(options: Readonly<{ fetch: UtxoFetch; timeoutMs?: number }>): UtxoBalanceReader {
  const checked = utxoFetchOptions(options);
  async function read(scope: UtxoNetworkId | UtxoNetwork, identifier: string, isAccount: boolean, signal: AbortSignal, assertCurrent?: () => void): Promise<UtxoBalance> {
    if (signal.aborted) return utxoFailure('CANCELLED');
    let canonical: string, network: UtxoNetwork;
    try {
      network = resolveUtxoNetwork(scope);
      if (isAccount) {
        const source = parseUtxoPublicIdentifier(identifier, network);
        if (source.kind !== 'account') return utxoFailure('INVALID_INPUT');
        canonical = source.identifier;
      } else canonical = normalizeUtxoAddress(identifier, network);
    } catch { return utxoFailure('INVALID_INPUT'); }
    let session: UtxoReadSession | undefined;
    try {
      session = await openUtxoReadSession(network, checked, signal, false, undefined, undefined, assertCurrent);
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
      const assets = supportsSptUtxoChain(active.network.chainId) ? readSptBalances(summary, canonical) : undefined;
      return Object.freeze({ networkId: network.id, kind: 'utxo', chainId: active.network.chainId, genesisHash: active.network.genesisHash,
        confirmedUnits: utxoUnits(summary.balance, false), pendingDeltaUnits: utxoUnits(summary.unconfirmedBalance, true),
        unconfirmedTransactions: utxoCount(summary.unconfirmedTxs), observedHeight: active.observedHeight,
        ...(assets ? { assets } : {}) });
    } catch (cause) { throw cause instanceof UtxoBalanceError ? cause : new UtxoBalanceError(signal.aborted ? 'CANCELLED' : 'UNAVAILABLE'); }
    finally { session?.close(); }
  }
  return Object.freeze({
    readBalance: (scope: UtxoNetworkId | UtxoNetwork, address: string, signal: AbortSignal, assertCurrent?: () => void) => read(scope, address, false, signal, assertCurrent),
    readAccount: (scope: UtxoNetworkId | UtxoNetwork, identifier: string, signal: AbortSignal, assertCurrent?: () => void) => read(scope, identifier, true, signal, assertCurrent),
  });
}
