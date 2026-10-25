import { Interface, parseEther, toQuantity } from 'ethers';

import {
  getPrivacyPool,
  PRIVACY_CHAIN_ID,
  PRIVACY_MAX_LEAVES,
  PRIVACY_TREE_LEVELS,
} from './registry';
import { PrivacyIndexProgress, PrivacyPoolId, PrivacySnapshot } from './types';

export const PRIVACY_SERVICE_URL = 'https://sysnode.info/api/privacy/v1';
const MAX_SNAPSHOT_BYTES = 160 * 1024 * 1024;
const WORD = /^0x[0-9a-f]{64}$/;
const FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);
const isWord = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 66 && WORD.test(value);
const isFieldWord = (value: unknown): value is string =>
  isWord(value) && BigInt(value) < FIELD;
const ABI = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
]);

async function readJson(response: Response, limit: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > limit)
    throw new Error('privacy_data_invalid');
  if (!response.body) throw new Error('privacy_data_invalid');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('privacy_data_invalid');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

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

export async function fetchPrivacySnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal
): Promise<PrivacySnapshot | PrivacyIndexProgress> {
  const pool = getPrivacyPool(poolId);
  const response = await fetch(
    `${PRIVACY_SERVICE_URL}/pools/${pool.id}/snapshot`,
    { cache: 'no-store', credentials: 'omit', redirect: 'error', signal }
  );
  if (response.status !== 200 && response.status !== 202)
    throw new Error('privacy_service_unavailable');
  const data: any = await readJson(
    response,
    response.status === 202 ? 4096 : MAX_SNAPSHOT_BYTES
  );
  if (response.status === 200) return validateSnapshot(poolId, data);
  if (
    data?.phase !== 'syncing' ||
    !Number.isSafeInteger(data.startBlock) ||
    data.startBlock !== pool.deploymentBlock ||
    !Number.isSafeInteger(data.scannedBlock) ||
    data.scannedBlock < pool.deploymentBlock - 1 ||
    !Number.isSafeInteger(data.targetBlock) ||
    data.targetBlock < data.scannedBlock
  )
    throw new Error('privacy_data_invalid');
  return data;
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

let requestId = 0;
async function rpc(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
) {
  const id = ++requestId;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal,
  });
  if (!response.ok) throw new Error('privacy_rpc_unavailable');
  const body: any = await readJson(response, 64 * 1024);
  if (
    !body ||
    body.jsonrpc !== '2.0' ||
    body.id !== id ||
    body.error ||
    !('result' in body)
  )
    throw new Error('privacy_rpc_unavailable');
  return body.result;
}

// Read the selected Ethereum RPC independently of Sysnode, never its RPC URL.
// Number-pinned eth_call is guarded by matching block hashes before and after.
export async function verifySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  rpcUrl: string,
  signal: AbortSignal
): Promise<{ blockTimestamp: number }> {
  const pool = getPrivacyPool(poolId);
  const url = validatePrivacyRpcUrl(rpcUrl);
  if ((await rpc(url, 'eth_chainId', [], signal)) !== '0x1')
    throw new Error('privacy_wrong_chain');
  const tag = toQuantity(snapshot.asOfBlockNumber);
  const block = () => rpc(url, 'eth_getBlockByNumber', [tag, false], signal);
  const before = await block();
  if (
    before?.hash?.toLowerCase() !== snapshot.asOfBlockHash ||
    before?.number !== tag
  )
    throw new Error('privacy_anchor_changed');
  // Timestamp comes from the independently checked block, never Sysnode or
  // the download clock. The note reader uses it to bound as-of freshness.
  const timestamp = before.timestamp;
  if (
    typeof timestamp !== 'string' ||
    timestamp.length > 16 ||
    timestamp.trim() !== timestamp ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(timestamp)
  )
    throw new Error('privacy_rpc_unavailable');
  const blockTimestamp = Number(BigInt(timestamp)) * 1000;
  if (!Number.isSafeInteger(blockTimestamp) || blockTimestamp <= 0)
    throw new Error('privacy_rpc_unavailable');
  const read = async (fn: string) => {
    const result = await rpc(
      url,
      'eth_call',
      [{ to: pool.address, data: ABI.encodeFunctionData(fn) }, tag],
      signal
    );
    return ABI.decodeFunctionResult(fn, result)[0];
  };
  const [count, root, levels, denomination] = await Promise.all([
    read('nextIndex'),
    read('getLastRoot'),
    read('levels'),
    read('denomination'),
  ]);
  const after = await block();
  if (
    after?.hash !== before.hash ||
    after?.number !== before.number ||
    after?.timestamp !== timestamp
  )
    throw new Error('privacy_anchor_changed');
  if (
    count !== BigInt(snapshot.leafCount) ||
    root.toLowerCase() !== snapshot.root ||
    levels !== BigInt(PRIVACY_TREE_LEVELS) ||
    denomination !== parseEther(pool.amount)
  )
    throw new Error('privacy_verification_failed');
  const known = ABI.decodeFunctionResult(
    'isKnownRoot',
    await rpc(
      url,
      'eth_call',
      [
        {
          to: pool.address,
          data: ABI.encodeFunctionData('isKnownRoot', [snapshot.root]),
        },
        'latest',
      ],
      signal
    )
  )[0];
  if (known !== true) throw new Error('privacy_snapshot_stale');
  return { blockTimestamp };
}
