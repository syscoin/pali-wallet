import {
  findUtxoCoinByRegistration,
  getNetworkConfigFromCoin,
} from '@sidhujag/sysweb3-network';
import bs58check from 'bs58check';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  normalizeUtxoActivityParticipants,
  UTXO_ACTIVITY_PARTICIPANTS_MAX,
  type UtxoActivityParticipants,
} from '../../../../shared/utxoActivityParticipants';
import { isUtxoNullDataOutput } from '../../../../shared/utxoTokenAmounts';

import type { ISysTransaction } from './types';

export function createUtxoActivityParticipantProjection(
  registration: Readonly<{ chainId: number; slip44: number }>
) {
  const coin = findUtxoCoinByRegistration(registration);
  const network = coin?.bech32Prefix
    ? getNetworkConfigFromCoin(coin).networks.mainnet
    : null;
  const normalize = (values: readonly unknown[]) =>
    coin
      ? normalizeUtxoActivityParticipants(values, (value) => {
          if (network) {
            const { address } = syscoinUtils.bitcoinjs;
            return address.fromOutputScript(
              address.toOutputScript(value, network),
              network
            );
          }
          // The SDK's SegWit config requires a Bech32 prefix. Legacy-only
          // registrations still have exact Base58Check address versions.
          const decoded = bs58check.decode(value);
          const version =
            decoded.length === 21
              ? decoded[0]
              : decoded.length === 22 && decoded[0] !== 0
              ? decoded[0] * 256 + decoded[1]
              : -1;
          if (version !== coin.addressType && version !== coin.addressTypeP2sh)
            throw new Error('Invalid legacy participant address');
          return value;
        })
      : [];
  return {
    compact(value: UtxoActivityParticipants | null) {
      return value
        ? { from: normalize(value.from), to: normalize(value.to) }
        : null;
    },
    full(transaction: ISysTransaction) {
      let remaining = UTXO_ACTIVITY_PARTICIPANTS_MAX;
      const strip = <T extends { addresses?: string[]; hex?: string }>(
        entries: T[],
        outputs: boolean
      ) =>
        Array.isArray(entries)
          ? entries.map((entry) => {
              if (outputs && isUtxoNullDataOutput(entry))
                // Preserve label-only amount evidence without provider text.
                return {
                  ...entry,
                  addresses: entry.hex === undefined ? ['OP_RETURN'] : [],
                };
              if (!entry || !Array.isArray(entry.addresses)) return entry;
              const candidates = entry.addresses.slice(0, remaining);
              remaining -= candidates.length;
              return { ...entry, addresses: normalize(candidates) };
            })
          : [];
      return {
        ...transaction,
        vin: strip(transaction.vin, false),
        vout: strip(transaction.vout, true),
      };
    },
  };
}
