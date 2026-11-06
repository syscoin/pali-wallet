import { assertJsonWorkBudget } from '../utils/requestPayloadBudget.ts';

export type UtxoActivityParticipants = Readonly<{
  from: readonly string[];
  to: readonly string[];
}>;

export const UTXO_ACTIVITY_PARTICIPANTS_MAX = 2048;

const isAddressCandidate = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 128 &&
  /^[\x21-\x7e]+$/.test(value);

export function boundUtxoActivityParticipants(
  value: UtxoActivityParticipants
): UtxoActivityParticipants | null {
  try {
    if (
      !Array.isArray(value.from) ||
      !Array.isArray(value.to) ||
      value.from.length + value.to.length > UTXO_ACTIVITY_PARTICIPANTS_MAX
    )
      return null;
    const candidates = {
      from: value.from.filter(isAddressCandidate),
      to: value.to.filter(isAddressCandidate),
    };
    assertJsonWorkBudget(
      candidates,
      32 * 1024,
      4,
      UTXO_ACTIVITY_PARTICIPANTS_MAX
    );
    return candidates;
  } catch {
    return null;
  }
}

/** Retain only complete addresses accepted by the selected network's codec. */
export function normalizeUtxoActivityParticipants(
  values: readonly unknown[],
  normalize: (address: string) => string
): string[] {
  const canonical = new Set<string>();
  for (const value of values) {
    if (!isAddressCandidate(value)) continue;
    try {
      canonical.add(normalize(value));
    } catch {
      // Provider labels are not addresses.
    }
  }
  return [...canonical];
}
