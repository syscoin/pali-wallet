import type { EvmSignedRecordSummary } from '../wallet/evmSignedRecords';

type NonceIdentity = Pick<
  EvmSignedRecordSummary,
  'chainId' | 'from' | 'hash' | 'nonce'
>;
type RetainedNonce = NonceIdentity & Pick<EvmSignedRecordSummary, 'phase'>;

/** The host supplies fresh evidence from the same captured RPC endpoint. A
 * persisted `submitted` phase alone does not prove acknowledgement or sighting. */
type AcceptedNonce = NonceIdentity &
  Readonly<{ endpoint: string; source: 'acknowledged' | 'observed-pending' }>;

export type EvmAutoNoncePlan =
  | Readonly<{ kind: 'ready'; nonce: number }>
  | Readonly<{ kind: 'unresolved'; nonce: number }>;

const validNonce = (nonce: number): boolean =>
  Number.isSafeInteger(nonce) && nonce >= 0;

/** Extend an RPC's contiguous pending count using exact accepted predecessors.
 * An unresolved retained nonce is reserved for explicit recovery. A higher
 * retained nonce cannot fill a lower gap. This plan never authorizes a send. */
export function planEvmAutoNonce({
  chainId,
  from,
  endpoint,
  latest,
  pending,
  retained,
  accepted,
}: Readonly<{
  accepted: readonly AcceptedNonce[];
  chainId: string;
  endpoint: string;
  from: string;
  latest: number;
  pending: number;
  retained: readonly RetainedNonce[];
}>): EvmAutoNoncePlan {
  if (!validNonce(latest) || !validNonce(pending))
    throw new Error('Invalid EVM nonce counts');

  const sender = from.toLowerCase();
  const floor = Math.max(latest, pending);
  const inScope = (entry: NonceIdentity): boolean =>
    entry.chainId === chainId && entry.from.toLowerCase() === sender;
  const acceptedNonces = new Map<string, number>();
  for (const evidence of accepted) {
    if (
      evidence.endpoint === endpoint &&
      inScope(evidence) &&
      (evidence.source === 'acknowledged' ||
        evidence.source === 'observed-pending')
    )
      acceptedNonces.set(evidence.hash, evidence.nonce);
  }

  const occupied = new Map<number, boolean>();
  for (const entry of retained) {
    if (!inScope(entry)) continue;
    if (!validNonce(entry.nonce)) throw new Error('Invalid retained EVM nonce');
    if (entry.nonce < floor) continue;
    const hasAcceptance =
      (entry.phase === 'signed' ||
        entry.phase === 'attempted' ||
        entry.phase === 'submitted') &&
      acceptedNonces.get(entry.hash) === entry.nonce;
    occupied.set(
      entry.nonce,
      hasAcceptance || occupied.get(entry.nonce) === true
    );
  }

  let nonce = floor;
  while (occupied.has(nonce)) {
    if (!occupied.get(nonce)) return { kind: 'unresolved', nonce };
    if (nonce === Number.MAX_SAFE_INTEGER)
      throw new Error('EVM nonce exceeds safe range');
    nonce++;
  }
  return { kind: 'ready', nonce };
}
