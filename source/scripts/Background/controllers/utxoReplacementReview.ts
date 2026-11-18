import type {
  prepareUtxoReplacement,
  UtxoReplacementKind,
} from '../../../wallet/utxoReplacement';

export type ExtensionUtxoReplacementActions = Readonly<{
  cancel: boolean;
  speedUp: boolean;
}>;

export type PreparedUtxoReplacement = Awaited<
  ReturnType<typeof prepareUtxoReplacement>
>;
export type ExtensionUtxoReplacementReview = Pick<
  PreparedUtxoReplacement['review'],
  'feeSatoshis' | 'outputs' | 'previousFeeSatoshis'
> &
  Readonly<{ id: string; kind: UtxoReplacementKind; validForMs: number }>;

export const isOwnedUtxoReplacementCall = (methods: unknown): boolean =>
  Array.isArray(methods) &&
  methods.length === 2 &&
  methods[0] === 'wallet' &&
  methods[1] === 'confirmUtxoReplacement';
