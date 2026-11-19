export const RECOVERY_PHRASE_WORD_COUNTS = [12, 15, 18, 21, 24] as const;

export type RecoveryPhraseWordCount =
  (typeof RECOVERY_PHRASE_WORD_COUNTS)[number];

export function isRecoveryPhraseWordCount(
  count: number
): count is RecoveryPhraseWordCount {
  return RECOVERY_PHRASE_WORD_COUNTS.some((value) => value === count);
}
