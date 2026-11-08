import {
  EvmAssetStateError,
  snapshotEvmTransferAsset,
} from './evmAssetState.ts';
import type { EvmAssetState, EvmTransferAsset } from './evmAssetState.ts';
import type { EvmSignedRecordSummary } from '../wallet/evmSignedRecords';

type NonceIdentity = Pick<
  EvmSignedRecordSummary,
  'chainId' | 'from' | 'hash' | 'nonce'
>;
type RetainedNonce = NonceIdentity & Pick<EvmSignedRecordSummary, 'phase'>;

export type EvmAutoNonceSnapshot = Readonly<{
  minimumNonce: number;
  owner: string;
  readAssetDebit(hash: string, asset: EvmTransferAsset): Promise<bigint>;
  readMaximumCost(hash: string): Promise<bigint>;
  retained: readonly RetainedNonce[];
}>;

/** Reserve known outgoing transfers once per nonce from an authenticated, chain-scoped snapshot. */
export async function assertEvmAssetReservations(
  state: EvmAssetState,
  candidateNonce: number,
  snapshot: EvmAutoNonceSnapshot,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent();
  const asset = snapshotEvmTransferAsset(state.asset);
  const { nonce: basisNonce, balanceUnits } = state;
  const from = state.from.toLowerCase();
  if (
    !Number.isSafeInteger(candidateNonce) ||
    candidateNonce < basisNonce ||
    !Number.isSafeInteger(basisNonce) ||
    basisNonce < 0 ||
    typeof balanceUnits !== 'bigint' ||
    balanceUnits < BigInt(0)
  )
    throw new EvmAssetStateError('INVALID_INPUT');
  const requested = BigInt(asset.amountUnits);
  // A nonce is one mutually exclusive group, even when the candidate is
  // already persisted or competes with a retained replacement.
  const reserved = new Map<number, bigint>([[candidateNonce, requested]]);
  let total = requested;
  if (total > balanceUnits) throw new EvmAssetStateError('INSUFFICIENT_ASSET');
  for (const entry of snapshot.retained) {
    if (entry.from.toLowerCase() !== from || entry.nonce < basisNonce) continue;
    assertCurrent();
    const debit = await snapshot.readAssetDebit(entry.hash, asset);
    assertCurrent();
    if (typeof debit !== 'bigint' || debit < BigInt(0))
      throw new EvmAssetStateError('INVALID_RESPONSE');
    const previous = reserved.get(entry.nonce) ?? BigInt(0);
    if (debit > previous) {
      total += debit - previous;
      reserved.set(entry.nonce, debit);
      if (total > balanceUnits)
        throw new EvmAssetStateError('INSUFFICIENT_ASSET');
    }
  }
  assertCurrent();
}

export type EvmNativeReservations = Readonly<{
  canonical: bigint;
  pending: bigint;
}>;

/** Apply canonical commitments and conservative pending reservations. */
export function availableEvmNativeBalance(
  balances: Readonly<{ canonical: bigint; pending: bigint }>,
  reservations: EvmNativeReservations,
  state: 'latest' | 'pending'
): bigint {
  for (const value of [
    balances.canonical,
    balances.pending,
    reservations.canonical,
    reservations.pending,
  ]) {
    if (typeof value !== 'bigint' || value < BigInt(0))
      throw new EvmAssetStateError('INVALID_RESPONSE');
  }
  const canonical = balances.canonical - reservations.canonical;
  const pending =
    state === 'latest' ? canonical : balances.pending - reservations.pending;
  const available = canonical < pending ? canonical : pending;
  return available > BigInt(0) ? available : BigInt(0);
}

/** Single-variant pending groups follow the node's ordinary pending view.
 * Competing retained variants have unknown overlap and reserve their full cap. */
async function nativeReservations(
  snapshot: EvmAutoNonceSnapshot,
  chainId: string,
  from: string,
  latest: number,
  pending: number,
  assertCurrent: () => void
): Promise<EvmNativeReservations> {
  assertCurrent();
  const groups = new Map<
    number,
    { competing: boolean; hash: string; maximum: bigint }
  >();
  let canonicalCost = BigInt(0);
  for (const entry of snapshot.retained) {
    if (!sameSender(entry, chainId, from) || entry.nonce < latest) continue;
    if (!validNonce(entry.nonce)) throw new Error('Invalid retained EVM nonce');
    assertCurrent();
    const cost = await snapshot.readMaximumCost(entry.hash);
    assertCurrent();
    if (typeof cost !== 'bigint' || cost < BigInt(0))
      throw new Error('Invalid retained EVM cost');
    let group = groups.get(entry.nonce);
    if (!group) {
      group = { hash: entry.hash, maximum: BigInt(0), competing: false };
      groups.set(entry.nonce, group);
    }
    group.competing ||= group.hash !== entry.hash;
    if (cost > group.maximum) {
      canonicalCost += cost - group.maximum;
      group.maximum = cost;
    }
  }
  let pendingCost = BigInt(0);
  for (const [nonce, group] of groups) {
    if (nonce >= Math.max(latest, pending) || group.competing)
      pendingCost += group.maximum;
  }
  assertCurrent();
  return Object.freeze({ canonical: canonicalCost, pending: pendingCost });
}

/** The host supplies fresh evidence from the same captured RPC endpoint. A
 * persisted `submitted` phase alone does not prove acknowledgement or sighting. */
type AcceptedNonce = NonceIdentity &
  Readonly<{ endpoint: string; source: 'acknowledged' | 'observed-pending' }>;

type Selection =
  | Readonly<{ kind: 'ready'; nonce: number }>
  | Readonly<{ kind: 'unresolved'; nonce: number }>;

export type EvmAutoNoncePlan =
  | Readonly<{
      balanceState: 'latest' | 'pending';
      kind: 'ready';
      nativeReservations: EvmNativeReservations;
      nonce: number;
    }>
  | Readonly<{ kind: 'unresolved'; nonce: number; reason?: 'asset-state' }>;

const canStillBePending = ({ phase }: RetainedNonce) =>
  phase === 'signed' || phase === 'attempted' || phase === 'submitted';

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
}>): Selection {
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
      canStillBePending(entry) &&
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

const MAX_ACKNOWLEDGEMENTS = 128;
const ACKNOWLEDGEMENT_MS = 30_000;
const MAX_ADDITIONAL_READS = 16;
const MAX_AHEAD_OF_RPC = 16;
const RPC_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i;

function matchesPending(value: unknown, entry: NonceIdentity): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tx = value as Record<string, unknown>;
  return (
    typeof tx.hash === 'string' &&
    tx.hash.toLowerCase() === entry.hash &&
    typeof tx.from === 'string' &&
    tx.from.toLowerCase() === entry.from.toLowerCase() &&
    typeof tx.nonce === 'string' &&
    RPC_QUANTITY.test(tx.nonce) &&
    BigInt(tx.nonce) === BigInt(entry.nonce) &&
    (tx.chainId === undefined ||
      (typeof tx.chainId === 'string' &&
        RPC_QUANTITY.test(tx.chainId) &&
        BigInt(tx.chainId) === BigInt(entry.chainId))) &&
    tx.blockHash === null &&
    tx.blockNumber === null &&
    tx.transactionIndex === null
  );
}

type Acknowledgement = {
  endpoint: string;
  expires?: number;
  identity: NonceIdentity;
  owner: string;
};

function sameSender(entry: NonceIdentity, chainId: string, from: string) {
  return entry.chainId === chainId && entry.from.toLowerCase() === from;
}

function acknowledgementKey(
  owner: string,
  endpoint: string,
  identity: NonceIdentity
) {
  return JSON.stringify([owner, endpoint, identity.hash]);
}

/** Short-lived exact acknowledgements bridge RPC propagation delays. The
 * protected journal remains the source of identity and recoverability. */
export class EvmAutoNonceAcceptance {
  private readonly acknowledgements = new Map<string, Acknowledgement>();

  private readonly now: () => number;

  constructor(now = () => performance.now()) {
    this.now = now;
  }

  track(
    owner: string,
    endpoint: string,
    { chainId, from, hash, nonce }: NonceIdentity
  ) {
    const identity = { chainId, from, hash, nonce };
    const key = acknowledgementKey(owner, endpoint, identity);
    const ticket: Acknowledgement = { owner, endpoint, identity };
    this.acknowledgements.delete(key);
    this.acknowledgements.set(key, ticket);
    if (this.acknowledgements.size > MAX_ACKNOWLEDGEMENTS)
      this.acknowledgements.delete(this.acknowledgements.keys().next().value!);

    return (acknowledgedHash: unknown) => {
      if (this.acknowledgements.get(key) !== ticket) return;
      if (
        typeof acknowledgedHash === 'string' &&
        acknowledgedHash.toLowerCase() === identity.hash
      )
        ticket.expires = this.now() + ACKNOWLEDGEMENT_MS;
      else this.acknowledgements.delete(key);
    };
  }

  retireNonce(owner: string, entry: NonceIdentity) {
    for (const [key, hint] of this.acknowledgements) {
      if (
        hint.owner === owner &&
        sameSender(hint.identity, entry.chainId, entry.from.toLowerCase()) &&
        hint.identity.nonce === entry.nonce
      )
        this.acknowledgements.delete(key);
    }
  }

  async plan({
    chainId,
    from,
    endpoint,
    latest,
    pending,
    assetState,
    nonceOverride,
    snapshot,
    readPending,
    assertCurrent,
  }: Readonly<{
    assertCurrent(): void;
    assetState?: EvmAssetState;
    chainId: string;
    endpoint: string;
    from: string;
    latest: number;
    nonceOverride?: number;
    pending: number;
    readPending(hash: string): Promise<unknown>;
    snapshot: EvmAutoNonceSnapshot;
  }>): Promise<EvmAutoNoncePlan> {
    assertCurrent();
    if (
      !validNonce(latest) ||
      !validNonce(pending) ||
      !validNonce(snapshot.minimumNonce)
    )
      throw new Error('Invalid EVM nonce counts');
    if (latest < snapshot.minimumNonce)
      throw new EvmAssetStateError('REVIEW_REQUIRED');
    if (
      assetState &&
      (assetState.nonce !== latest ||
        assetState.from.toLowerCase() !== from.toLowerCase())
    )
      return { kind: 'unresolved', nonce: latest, reason: 'asset-state' };
    const sender = from.toLowerCase();
    const floor = Math.max(latest, pending);
    const { owner, retained } = snapshot;
    for (const [key, hint] of this.acknowledgements) {
      if (
        hint.owner === owner &&
        sameSender(hint.identity, chainId, sender) &&
        hint.identity.nonce < latest
      )
        this.acknowledgements.delete(key);
    }
    // An explicit nonce retains the same collision rules as ordinary admission.
    if (nonceOverride !== undefined) {
      if (!validNonce(nonceOverride) || nonceOverride < latest)
        throw new EvmAssetStateError('INVALID_INPUT');
      if (
        retained.some(
          (entry) =>
            sameSender(entry, chainId, sender) && entry.nonce === nonceOverride
        )
      )
        return { kind: 'unresolved', nonce: nonceOverride };
      if (assetState)
        await assertEvmAssetReservations(
          assetState,
          nonceOverride,
          {
            ...snapshot,
            retained: retained.filter((entry) =>
              sameSender(entry, chainId, sender)
            ),
          },
          assertCurrent
        );
      const costs = await nativeReservations(
        snapshot,
        chainId,
        sender,
        latest,
        pending,
        assertCurrent
      );
      assertCurrent();
      return {
        kind: 'ready',
        nonce: nonceOverride,
        nativeReservations: costs,
        balanceState: pending < latest ? 'latest' : 'pending',
      };
    }
    const variants = new Map<number, RetainedNonce[]>();
    for (const entry of retained) {
      if (!sameSender(entry, chainId, sender)) continue;
      if (!validNonce(entry.nonce))
        throw new Error('Invalid retained EVM nonce');
      if (entry.nonce < floor) continue;
      const siblings = variants.get(entry.nonce);
      if (siblings) siblings.push(entry);
      else variants.set(entry.nonce, [entry]);
    }

    const accepted: AcceptedNonce[] = [];
    const usedAcknowledgements: Array<{
      key: string;
      nonce: number;
      ticket: Acknowledgement;
    }> = [];
    let reads = 0;
    for (let nonce = floor; variants.has(nonce); nonce++) {
      if (nonce - floor >= MAX_AHEAD_OF_RPC)
        return { kind: 'unresolved', nonce };
      const siblings = variants.get(nonce)!;
      let proof: AcceptedNonce | undefined;
      for (const entry of siblings) {
        if (!canStillBePending(entry)) continue;
        const key = acknowledgementKey(owner, endpoint, entry);
        const hint = this.acknowledgements.get(key);
        if (hint?.expires !== undefined && hint.expires > this.now()) {
          proof = { ...entry, endpoint, source: 'acknowledged' };
          usedAcknowledgements.push({ key, nonce, ticket: hint });
          break;
        }
      }
      if (!proof) {
        for (const entry of siblings) {
          if (!canStillBePending(entry) || reads >= MAX_ADDITIONAL_READS)
            continue;
          reads++;
          assertCurrent();
          const result = await readPending(entry.hash);
          assertCurrent();
          if (matchesPending(result, entry)) {
            proof = { ...entry, endpoint, source: 'observed-pending' };
            break;
          }
        }
      }
      if (!proof) break;
      if (nonce === Number.MAX_SAFE_INTEGER)
        throw new Error('EVM nonce exceeds safe range');
      accepted.push(proof);
    }

    assertCurrent();
    const selection = planEvmAutoNonce({
      chainId,
      from,
      endpoint,
      latest,
      pending,
      retained,
      accepted,
    });
    if (selection.kind === 'ready' && assetState)
      await assertEvmAssetReservations(
        assetState,
        selection.nonce,
        {
          ...snapshot,
          retained: retained.filter((entry) =>
            sameSender(entry, chainId, sender)
          ),
        },
        assertCurrent
      );
    const costs =
      selection.kind === 'ready'
        ? await nativeReservations(
            snapshot,
            chainId,
            sender,
            latest,
            pending,
            assertCurrent
          )
        : undefined;
    for (const { key, nonce, ticket } of usedAcknowledgements) {
      if (
        this.acknowledgements.get(key) !== ticket ||
        ticket.expires === undefined ||
        ticket.expires <= this.now()
      )
        return { kind: 'unresolved', nonce };
    }
    assertCurrent();
    return selection.kind === 'ready'
      ? {
          ...selection,
          nativeReservations: costs!,
          balanceState: pending < latest ? 'latest' : 'pending',
        }
      : selection;
  }
}
