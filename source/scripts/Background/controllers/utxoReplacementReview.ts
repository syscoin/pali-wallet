import type { UtxoDappSigningAuthority } from 'utils/utxoSigningContext';

import type {
  prepareUtxoReplacement,
  UtxoReplacementKind,
} from '../../../wallet/utxoReplacement';

export const HARDWARE_UTXO_REPLACEMENT_TIMEOUT_MS = 300_000;
export type ExtensionUtxoReplacementAuthority = UtxoDappSigningAuthority &
  Readonly<{ attachedTab?: true }>;

export type ExtensionUtxoReplacementActions = Readonly<{
  cancel: boolean;
  hardware?: true;
  speedUp: boolean;
}>;

export type PreparedUtxoReplacement = Awaited<
  ReturnType<typeof prepareUtxoReplacement>
>;
export type ExtensionUtxoReplacementReview = Pick<
  PreparedUtxoReplacement['review'],
  'feeSatoshis' | 'outputs' | 'previousFeeSatoshis'
> &
  Readonly<{
    hardware?: true;
    id: string;
    kind: UtxoReplacementKind;
    validForMs: number;
  }>;

export const isOwnedUtxoReplacementCall = (methods: unknown): boolean =>
  Array.isArray(methods) &&
  methods.length === 2 &&
  methods[0] === 'wallet' &&
  methods[1] === 'confirmUtxoReplacement';
