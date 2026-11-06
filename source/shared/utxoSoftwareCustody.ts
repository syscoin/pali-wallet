import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';

import { getDefaultUTXONetworks } from '../utils/defaultNetworks.ts';

type Registration = Readonly<{ chainId: number; slip44: number }>;
type Coin = NonNullable<ReturnType<typeof findUtxoCoinByRegistration>>;

const defaults = getDefaultUTXONetworks();

const hasStandardSigningRules = (coin: Coin | undefined) =>
  coin?.forkId === null && coin.forceBip143 === false;

const supportsWitnessVersion = (
  { chainId, slip44 }: Registration,
  version: number
) => version === 0 || (version === 1 && defaults[chainId]?.slip44 === slip44);

/** Native software custody uses the shared BIP84 account flow. */
export function supportsUtxoSoftwareCustody(
  registration: Registration,
  witnessVersion = 0
): boolean {
  const coin = findUtxoCoinByRegistration(registration);
  return (
    coin?.segwit === true &&
    coin.decimals === 8 &&
    registration.slip44 !== 60 &&
    hasStandardSigningRules(coin) &&
    supportsWitnessVersion(registration, witnessVersion)
  );
}

const scriptWitnessVersion = (script: Uint8Array) => {
  const version = script[0] - 0x50;
  return version >= 1 &&
    version <= 16 &&
    script.length >= 4 &&
    script.length <= 42 &&
    script[1] === script.length - 2
    ? version
    : 0;
};

/** Legacy and v0 scripts use the ordinary signer. Other rules require qualification. */
export function assertUtxoSoftwareSpend(
  registration: Registration,
  scripts: readonly Uint8Array[]
): void {
  const coin = findUtxoCoinByRegistration(registration);
  if (
    !hasStandardSigningRules(coin) ||
    scripts.some(
      (script) =>
        !supportsWitnessVersion(registration, scriptWitnessVersion(script))
    )
  ) {
    throw Object.assign(
      new Error(
        'This network or address type is unsupported for software sends.'
      ),
      {
        code: 'UTXO_SOFTWARE_SPEND_UNSUPPORTED',
        transactionNotBroadcast: true,
      }
    );
  }
}
