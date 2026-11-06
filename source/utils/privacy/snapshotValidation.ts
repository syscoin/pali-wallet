import {
  getPrivacyPool,
  PRIVACY_CHAIN_ID,
  PRIVACY_MAX_LEAVES,
} from './registry.ts';
import type { PrivacyPoolId, PrivacySnapshot } from './types.ts';

const WORD = /^0x[0-9a-f]{64}$/;
const FIELD =
  '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001';
const isWord = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 66 && WORD.test(value);
const isFieldWord = (value: unknown): value is string =>
  // Canonical, equal-width lowercase hex has the same string and integer order.
  isWord(value) && value < FIELD;

export function validateSnapshot(
  poolId: PrivacyPoolId,
  value: unknown
): PrivacySnapshot {
  const pool = getPrivacyPool(poolId);
  const data = value as PrivacySnapshot;
  if (
    !data ||
    data.version !== 1 ||
    data.chainId !== PRIVACY_CHAIN_ID ||
    data.poolAddress !== pool.address ||
    !Number.isSafeInteger(data.asOfBlockNumber) ||
    data.asOfBlockNumber < pool.deploymentBlock ||
    !isWord(data.asOfBlockHash) ||
    !isFieldWord(data.root) ||
    !Number.isSafeInteger(data.leafCount) ||
    data.leafCount < 0 ||
    data.leafCount > PRIVACY_MAX_LEAVES ||
    !Array.isArray(data.leaves) ||
    data.leaves.length !== data.leafCount ||
    data.leaves.some((leaf) => !isFieldWord(leaf)) ||
    !Array.isArray(data.withdrawnNullifiers) ||
    data.withdrawnNullifiers.length > data.leafCount ||
    data.withdrawnNullifiers.some((hash) => !isFieldWord(hash)) ||
    new Set(data.withdrawnNullifiers).size !== data.withdrawnNullifiers.length
  )
    throw new Error('privacy_data_invalid');
  // Project only the protocol fields. In particular, a server-supplied `phase`
  // must not reclassify a validated snapshot as a progress response.
  return {
    version: 1,
    chainId: data.chainId,
    poolAddress: data.poolAddress,
    asOfBlockNumber: data.asOfBlockNumber,
    asOfBlockHash: data.asOfBlockHash,
    leafCount: data.leafCount,
    root: data.root,
    leaves: data.leaves,
    withdrawnNullifiers: data.withdrawnNullifiers,
  };
}

export function validatePrivacyRpcUrl(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      ))
  )
    throw new Error('privacy_rpc_unavailable');
  return parsed.href;
}
