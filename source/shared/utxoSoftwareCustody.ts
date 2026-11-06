import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';

import { getDefaultUTXONetworks } from '../utils/defaultNetworks.ts';

const defaults = getDefaultUTXONetworks();

/** Address parameters alone cannot establish support for a chain's signing rules. */
export function supportsUtxoSoftwareCustody(
  registration: Readonly<{ chainId: number; slip44: number }>,
  witnessVersion = 0
): boolean {
  const coin = findUtxoCoinByRegistration(registration);
  if (
    coin?.segwit !== true ||
    coin.decimals !== 8 ||
    registration.slip44 === 60 ||
    coin.forkId !== null ||
    coin.forceBip143 !== false
  )
    return false;

  // The catalogue describes encodings and hardware capabilities. The existing
  // default wallet paths retain v1 support. Custom v1+ needs its own
  // consensus qualification before the wallet presents it as a spending path.
  return (
    witnessVersion === 0 ||
    (witnessVersion === 1 &&
      defaults[registration.chainId]?.slip44 === registration.slip44)
  );
}
