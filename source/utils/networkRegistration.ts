import { INetwork, INetworkType } from 'types/network';

/** Stable across extension-message serialization, including absent optional fields. */
export const networkRegistrationFingerprint = (
  network: INetwork | null | undefined
): string | undefined =>
  network
    ? JSON.stringify([
        network.kind,
        network.chainId,
        network.slip44,
        network.url,
        network.label,
        network.currency,
        network.explorer ?? null,
        network.apiUrl ?? null,
        network.key ?? null,
        network.default ?? null,
        network.coingeckoId ?? null,
        network.coingeckoPlatformId ?? null,
        ...(network.explorerExplicitlyAbsent ? [true] : []),
        ...(network.utxoBackendChain === undefined
          ? []
          : ['utxoBackendChain', network.utxoBackendChain]),
      ])
    : undefined;

/** Resolve the endpoint pin from the verified registry, including cold-start active copies. */
export function resolvePinnedUtxoBackendChain(
  active: INetwork,
  registered: INetwork | undefined
): string | undefined {
  if (
    active.kind !== INetworkType.Syscoin ||
    registered?.kind !== active.kind ||
    registered.chainId !== active.chainId ||
    registered.slip44 !== active.slip44 ||
    registered.url !== active.url ||
    registered.currency.toLowerCase() !== active.currency.toLowerCase() ||
    (active.utxoBackendChain !== undefined &&
      active.utxoBackendChain !== registered.utxoBackendChain)
  )
    return undefined;
  return registered.utxoBackendChain;
}
