import { parseEvmInteger } from 'utils/evmNonce';
import {
  buildEvmMinedNonceIndex,
  EvmMinedNonceIndex,
  getEvmSettlementStatus,
  isEvmNonceReplacement,
} from 'utils/evmReplacement';

/** Ephemeral outer-transaction proof; only its hash is saved in navigation. */
export type ReplacementWinner = {
  blockHeight?: unknown;
  blockNumber?: unknown;
  chainId: number;
  from: string;
  hash: string;
  height?: unknown;
  historySource?: unknown;
  nonce?: unknown;
  r?: unknown;
  s?: unknown;
  type?: unknown;
  v?: unknown;
};

export const replacementHash = (value: unknown): string | undefined =>
  typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;

export const isReplacementWinner = (
  original: any,
  candidate: any,
  chainId: number
): boolean => {
  const proof = compactReplacementWinner(candidate, chainId);
  return Boolean(
    proof &&
      isEvmNonceReplacement(original, proof, chainId) &&
      getEvmSettlementStatus(
        original,
        chainId,
        buildEvmMinedNonceIndex([proof], chainId)
      ) === 'replaced'
  );
};

export const getReplacementWinner = (
  original: any,
  transactions: readonly any[],
  chainId: number,
  minedIndex = buildEvmMinedNonceIndex(
    transactions
      .map((row) => compactReplacementWinner(row, chainId))
      .filter(Boolean),
    chainId
  )
): ReplacementWinner | undefined => {
  if (getEvmSettlementStatus(original, chainId, minedIndex) !== 'replaced')
    return undefined;
  const candidate = transactions.find((row) =>
    isReplacementWinner(original, row, chainId)
  );
  return compactReplacementWinner(candidate, chainId);
};

export const compactReplacementWinner = (
  candidate: any,
  chainId: number
): ReplacementWinner | undefined => {
  const hash = replacementHash(candidate?.hash);
  if (
    !hash ||
    typeof candidate?.from !== 'string' ||
    !/^0x[0-9a-f]{40}$/i.test(candidate.from) ||
    (candidate.chainId !== undefined &&
      ((typeof candidate.chainId !== 'number' &&
        typeof candidate.chainId !== 'string') ||
        parseEvmInteger(candidate.chainId) !== chainId))
  )
    return undefined;
  const proof: ReplacementWinner = {
    hash,
    from: candidate.from,
    chainId,
  };
  for (const field of [
    'nonce',
    'blockNumber',
    'blockHeight',
    'height',
    'type',
    'historySource',
    'r',
    's',
    'v',
  ] as const) {
    const value = candidate[field];
    if (value === undefined || value === null) continue;
    if (
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 130)
    )
      proof[field] = value;
    else return undefined;
  }
  return buildEvmMinedNonceIndex([proof], chainId).size ? proof : undefined;
};

/** Live rows supersede a route snapshot; conflicting mined hashes stay ambiguous. */
export const mergeReplacementWinnerIndex = (
  history: readonly any[],
  original: any,
  candidate: any,
  chainId: number,
  minedIndex: EvmMinedNonceIndex = buildEvmMinedNonceIndex(history, chainId)
): EvmMinedNonceIndex => {
  const proof = compactReplacementWinner(candidate, chainId);
  const hash = proof?.hash;
  if (
    !hash ||
    history.some((row) => replacementHash(row?.hash) === hash) ||
    !isReplacementWinner(original, proof, chainId)
  )
    return minedIndex;
  const merged = new Map(minedIndex);
  for (const [key, hashes] of buildEvmMinedNonceIndex([proof], chainId)) {
    merged.set(key, new Set([...(minedIndex.get(key) || []), ...hashes]));
  }
  return merged;
};
