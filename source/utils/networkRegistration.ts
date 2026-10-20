import { INetwork } from 'types/network';

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
      ])
    : undefined;
