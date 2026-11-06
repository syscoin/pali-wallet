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

const supportsSpendScript = (
  registration: Registration,
  script: Uint8Array
) => {
  const [opcode, length] = script;
  // A direct witness program uses OP_0 or OP_1..OP_16 and pushes 2–40 bytes.
  if (
    script.length < 4 ||
    script.length > 42 ||
    length !== script.length - 2 ||
    (opcode !== 0 && (opcode < 0x51 || opcode > 0x60))
  )
    return true;
  if (opcode === 0) return length === 20 || length === 32;
  return (
    opcode === 0x51 && length === 32 && supportsWitnessVersion(registration, 1)
  );
};

/** Match the chain's signing rules and the exact witness program in each script. */
export function supportsUtxoSoftwareSpend(
  registration: Registration,
  scripts: readonly Uint8Array[]
): boolean {
  return (
    hasStandardSigningRules(findUtxoCoinByRegistration(registration)) &&
    scripts.every((script) => supportsSpendScript(registration, script))
  );
}

export function assertUtxoSoftwareSpend(
  registration: Registration,
  scripts: readonly Uint8Array[]
): void {
  if (!supportsUtxoSoftwareSpend(registration, scripts)) {
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
