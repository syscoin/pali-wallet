import { assertPsbtWorkBudget } from '../utils/psbtWorkBudget.ts';

export type PsbtEnvelope = Readonly<{ assets: string; psbt: string }>;

/** Capture the public two-string protocol without loading custody or SDK code. */
export function capturePsbtEnvelope(value: unknown): PsbtEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid PSBT envelope');
  const { psbt, assets } = value as Partial<PsbtEnvelope>;
  if (typeof psbt !== 'string' || typeof assets !== 'string')
    throw new Error('Invalid PSBT envelope');
  const snapshot = Object.freeze({ psbt, assets });
  assertPsbtWorkBudget(snapshot);
  return snapshot;
}
