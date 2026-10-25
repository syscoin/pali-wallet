import type { IPrivateNoteView } from './privateVaultTypes';
import type { PrivacyPoolId } from './types';

// Pinned Classic ETH denominations, expressed in tenths without floating point.
const TENTHS: Readonly<Record<PrivacyPoolId, bigint>> = {
  'eth-0.1': BigInt(1),
  'eth-1': BigInt(10),
  'eth-10': BigInt(100),
  'eth-100': BigInt(1000),
};
const TEN = BigInt(10);

export function verifiedNoteBalance(
  notes: readonly Pick<IPrivateNoteView, 'phase' | 'poolId'>[]
): string {
  let tenths = BigInt(0);
  for (const note of notes) {
    if (note.phase !== 'verified') continue;
    const amount = TENTHS[note.poolId];
    if (amount === undefined) throw new Error('privacy_note_response_invalid');
    tenths += amount;
  }
  const whole = tenths / TEN;
  const fraction = tenths % TEN;
  return fraction === BigInt(0) ? String(whole) : `${whole}.${fraction}`;
}
