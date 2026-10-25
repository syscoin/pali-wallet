import { getAddress } from 'ethers/address';

import { validateSnapshot } from './client';
import { hashPair, TREE_DEPTH, ZERO_VALUE } from './merkle';
import { identifyClassicNote } from './note';
import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
  IPrivacyProofResult,
} from './proverTypes';
import { getPrivacyPool } from './registry';
import type { PrivacySnapshot } from './types';

export interface IPrivacyWithdrawalRequest {
  fee: string;
  note: string;
  recipient: string;
  refund: string;
  relayer: string;
  snapshot: PrivacySnapshot;
}
export interface IPrivacyWithdrawalOptions extends IPrivacyProofOptions {
  /** Must check the ORIGINAL object against the live, anchored tree and freshness. Local only. */
  assertSnapshotCurrent: (snapshot: PrivacySnapshot) => void;
  /** Public cached path, independently checked against the anchored root before use. */
  cachedPath?: { pathElements: string[]; pathIndices: number[] };
  /** Local verifier-owned path lookup; the returned path is still rehashed here. */
  getPath?: (
    leafIndex: number
  ) => Promise<{ pathElements: string[]; pathIndices: number[] }>;
  onPathProgress?: (completed: number, total: number) => void;
  runProof?: (
    input: IPrivacyProofInput,
    options: IPrivacyProofOptions
  ) => Promise<IPrivacyProofResult>;
  yieldControl?: () => Promise<void>;
}
const knownErrors = new Set([
  'privacy_note_invalid',
  'privacy_note_not_found',
  'privacy_note_spent',
  'privacy_verification_pending',
  'privacy_vault_session_changed',
  'privacy_proof_cancelled',
  'privacy_proof_failed',
  'privacy_proof_busy',
  'privacy_proof_unavailable',
  'privacy_proof_artifact_invalid',
  'privacy_proof_verification_failed',
  'privacy_proof_invalid_input',
  'privacy_withdrawal_invalid',
  'privacy_withdrawal_snapshot_invalid',
]);
const invalid = () => new Error('privacy_withdrawal_invalid');
const snapshotInvalid = () => new Error('privacy_withdrawal_snapshot_invalid');
const sanitize = (error: unknown) =>
  new Error(
    error instanceof Error && knownErrors.has(error.message)
      ? error.message
      : 'privacy_withdrawal_invalid'
  );

function guard(snapshot: PrivacySnapshot, options: IPrivacyWithdrawalOptions) {
  if (options.signal?.aborted) throw new Error('privacy_proof_cancelled');
  try {
    const result: unknown = options.assertCurrent();
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => undefined);
      throw new Error();
    }
  } catch {
    throw new Error('privacy_vault_session_changed');
  }
  try {
    const result: unknown = options.assertSnapshotCurrent(snapshot);
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => undefined);
      throw new Error();
    }
  } catch {
    throw new Error('privacy_verification_pending');
  }
}
function littleEndian(bytes: Uint8Array) {
  let value = BigInt(0);
  for (let i = bytes.length - 1; i >= 0; i--)
    value = (value << BigInt(8)) + BigInt(bytes[i]);
  return value.toString();
}
function noteSecrets(note: string): { nullifier: string; secret: string } {
  // identifyClassicNote already validates network, amount, length and hex syntax.
  const hex = note.trim().split('-0x')[1];
  const bytes = new Uint8Array(62);
  try {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return {
      nullifier: littleEndian(bytes.subarray(0, 31)),
      secret: littleEndian(bytes.subarray(31)),
    };
  } finally {
    bytes.fill(0);
  }
}
function withdrawalFields(request: IPrivacyWithdrawalRequest, amount: string) {
  let recipient: string, relayer: string;
  try {
    recipient = getAddress(request.recipient);
    relayer = getAddress(request.relayer);
  } catch {
    throw invalid();
  }
  if (
    BigInt(recipient) === BigInt(0) ||
    request.refund !== '0' ||
    typeof request.fee !== 'string' ||
    !/^(0|[1-9][0-9]{0,76})$/.test(request.fee)
  )
    throw invalid();
  const denomination =
    BigInt(amount.replace('.', '')) *
    BigInt(amount.includes('.') ? '100000000000000000' : '1000000000000000000');
  if (
    BigInt(request.fee) >= denomination ||
    (BigInt(relayer) === BigInt(0) && request.fee !== '0')
  )
    throw invalid();
  return { recipient, relayer, fee: request.fee, refund: '0' };
}

/** Background-only preparation. All pool data is supplied locally; this never fetches. */
export async function preparePrivacyWithdrawal(
  request: IPrivacyWithdrawalRequest,
  options: IPrivacyWithdrawalOptions
): Promise<IPrivacyProofInput> {
  const original = request.snapshot;
  try {
    guard(original, options);
    const rawNote = request.note;
    const identity = identifyClassicNote(rawNote);
    const fields = withdrawalFields(
      request,
      getPrivacyPool(identity.poolId).amount
    );
    let validated: PrivacySnapshot;
    try {
      const current = validateSnapshot(identity.poolId, request.snapshot);
      validated = validateSnapshot(identity.poolId, {
        ...current,
        leaves: Array.from(current.leaves),
        withdrawnNullifiers: Array.from(current.withdrawnNullifiers),
      });
    } catch {
      throw snapshotInvalid();
    }
    const anchor = {
      root: request.snapshot.root,
      hash: request.snapshot.asOfBlockHash,
      block: request.snapshot.asOfBlockNumber,
      count: request.snapshot.leafCount,
    };
    const check = () => {
      guard(original, options);
      if (
        request.snapshot !== original ||
        original.root !== anchor.root ||
        request.snapshot.asOfBlockHash !== anchor.hash ||
        request.snapshot.asOfBlockNumber !== anchor.block ||
        request.snapshot.leafCount !== anchor.count
      )
        throw snapshotInvalid();
    };
    if (validated.withdrawnNullifiers.includes(identity.nullifierHash))
      throw new Error('privacy_note_spent');
    const leafIndex = validated.leaves.indexOf(identity.commitment);
    if (leafIndex < 0) throw new Error('privacy_note_not_found');
    if (leafIndex !== validated.leaves.lastIndexOf(identity.commitment))
      throw snapshotInvalid();
    const pathIndices = Array.from(
      { length: TREE_DEPTH },
      (_, level) => Math.floor(leafIndex / 2 ** level) % 2
    );
    let pathElements: string[];
    let cachedPath = options.cachedPath;
    if (options.getPath !== undefined) {
      if (typeof options.getPath !== 'function' || cachedPath !== undefined)
        throw snapshotInvalid();
      check();
      cachedPath = await options.getPath(leafIndex);
      check();
      if (!cachedPath) throw snapshotInvalid();
    }
    if (cachedPath !== undefined) {
      if (
        !cachedPath ||
        !Array.isArray(cachedPath.pathElements) ||
        !Array.isArray(cachedPath.pathIndices)
      )
        throw snapshotInvalid();
      pathElements = Array.from(cachedPath.pathElements);
      const suppliedIndices = Array.from(cachedPath.pathIndices);
      if (
        pathElements.length !== TREE_DEPTH ||
        pathElements.some(
          (value) =>
            typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)
        ) ||
        suppliedIndices.length !== TREE_DEPTH ||
        pathIndices.some((bit, i) => suppliedIndices[i] !== bit)
      )
        throw snapshotInvalid();
      let root = identity.commitment;
      try {
        for (let level = 0; level < TREE_DEPTH; level++)
          root = pathIndices[level]
            ? hashPair(pathElements[level], root)
            : hashPair(root, pathElements[level]);
      } catch {
        throw snapshotInvalid();
      }
      if (root !== validated.root) throw snapshotInvalid();
    } else {
      let nodes = validated.leaves,
        index = leafIndex,
        zero = ZERO_VALUE as string;
      pathElements = [];
      let completed = 0,
        count = nodes.length,
        total = TREE_DEPTH - 1;
      for (let level = 0; level < TREE_DEPTH; level++) {
        count = Math.ceil(count / 2);
        total += count;
      }
      const yieldControl =
        options.yieldControl ||
        (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      const checkpoint = async () => {
        if (completed % 128 !== 0 && completed !== total) return;
        check();
        options.onPathProgress?.(completed, total);
        await yieldControl();
        check();
      };
      for (let level = 0; level < TREE_DEPTH; level++) {
        pathElements.push(nodes[index ^ 1] ?? zero);
        const next: string[] = [];
        for (let i = 0; i < nodes.length; i += 2) {
          next.push(hashPair(nodes[i], nodes[i + 1] ?? zero));
          completed++;
          if (completed % 128 === 0 || completed === total) await checkpoint();
        }
        nodes = next;
        index = Math.floor(index / 2);
        if (level < TREE_DEPTH - 1) {
          zero = hashPair(zero, zero);
          completed++;
          if (completed % 128 === 0 || completed === total) await checkpoint();
        }
      }
      if (nodes.length !== 1 || nodes[0] !== validated.root)
        throw snapshotInvalid();
    }
    check();
    return {
      ...fields,
      ...noteSecrets(rawNote),
      root: validated.root,
      nullifierHash: identity.nullifierHash,
      pathElements,
      pathIndices,
    };
  } catch (error) {
    throw sanitize(error);
  }
}

/** The only asynchronous dependency is a guarded local prover, loaded on demand. */
export async function provePrivacyWithdrawal(
  request: IPrivacyWithdrawalRequest,
  options: IPrivacyWithdrawalOptions
): Promise<IPrivacyProofResult> {
  const original = request.snapshot;
  const input = await preparePrivacyWithdrawal(request, options);
  const block = original.asOfBlockNumber,
    blockHash = original.asOfBlockHash;
  const check = () => {
    guard(original, options);
    if (
      request.snapshot !== original ||
      original.root !== input.root ||
      original.asOfBlockNumber !== block ||
      original.asOfBlockHash !== blockHash
    )
      throw snapshotInvalid();
    if (original.withdrawnNullifiers.includes(input.nullifierHash))
      throw new Error('privacy_note_spent');
  };
  try {
    check();
    const prove =
      options.runProof ||
      (await import(/* webpackChunkName: "privacy-prover" */ './prover'))
        .runPrivacyProof;
    check();
    const result = await prove(input, {
      assertCurrent: check,
      onProgress: options.onProgress,
      signal: options.signal,
    });
    check();
    const expected = [
      input.root,
      input.nullifierHash,
      input.recipient,
      input.relayer,
      input.fee,
      input.refund,
    ].map((value) => BigInt(value).toString());
    if (
      !result ||
      typeof result.proof !== 'string' ||
      !/^0x[0-9a-f]{512}$/.test(result.proof) ||
      !Array.isArray(result.publicSignals) ||
      result.publicSignals.length !== 6 ||
      Array.from(result.publicSignals).some((value, i) => value !== expected[i])
    )
      throw new Error('privacy_proof_failed');
    return { proof: result.proof, publicSignals: [...result.publicSignals] };
  } catch (error) {
    throw sanitize(error);
  } finally {
    input.nullifier = '';
    input.secret = '';
  }
}
