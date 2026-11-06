import { Interface } from 'ethers/abi';
import { parseEther, toQuantity } from 'ethers/utils';

import { getPrivacyPool, PRIVACY_TREE_LEVELS } from './registry.ts';
import {
  validatePrivacyRpcUrl,
  validateSnapshot,
} from './snapshotValidation.ts';
import type {
  PrivacyIndexProgress,
  PrivacyPoolId,
  PrivacySnapshot,
} from './types.ts';

/** The host owns dispatch, bounded JSON reads and response cleanup. */
export type PrivacyJsonTransport = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
  responseLimit: (response: Pick<Response, 'ok' | 'status'>) => number
) => Promise<{ data: unknown; status: number }>;

export const PRIVACY_SERVICE_URL = 'https://sysnode.info/api/privacy/v1';
const MAX_SNAPSHOT_BYTES = 160 * 1024 * 1024;
const MAX_SCALAR_RPC_BYTES = 64 * 1024;
// Block replies include every transaction hash even when full objects are off.
const MAX_BLOCK_RPC_BYTES = 4 * 1024 * 1024;
export const PRIVACY_POOL_ABI = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
  'function isSpent(bytes32 nullifierHash) view returns (bool)',
]);

export async function readPrivacyPoolSnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal,
  requestJson: PrivacyJsonTransport,
  serviceOrigin = 'https://sysnode.info'
): Promise<PrivacySnapshot | PrivacyIndexProgress> {
  const pool = getPrivacyPool(poolId);
  const response = await requestJson(
    `${serviceOrigin}/api/privacy/v1/pools/${pool.id}/snapshot`,
    { cache: 'no-store', credentials: 'omit', redirect: 'error', signal },
    ({ status }) => {
      if (status !== 200 && status !== 202)
        throw new Error('privacy_service_unavailable');
      return status === 200 ? MAX_SNAPSHOT_BYTES : 4096;
    }
  );
  const data: any = response.data;
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

export function createPrivacyRpc(requestJson: PrivacyJsonTransport) {
  let requestId = 0;
  return async function rpc(
    url: string,
    method: string,
    params: unknown[],
    signal: AbortSignal
  ) {
    const id = ++requestId;
    const { data } = await requestJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal,
      },
      ({ ok }) => {
        if (!ok) throw new Error('privacy_rpc_unavailable');
        return method === 'eth_getBlockByNumber' ||
          method === 'eth_getTransactionReceipt'
          ? MAX_BLOCK_RPC_BYTES
          : MAX_SCALAR_RPC_BYTES;
      }
    );
    const body: any = data;
    if (
      !body ||
      body.jsonrpc !== '2.0' ||
      body.id !== id ||
      body.error ||
      !('result' in body)
    )
      throw new Error('privacy_rpc_unavailable');
    return body.result;
  };
}

// Read the selected Ethereum RPC independently of Sysnode, never its RPC URL.
// Number-pinned eth_call is guarded by matching block hashes before and after.
export async function verifyPrivacySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  rpcUrl: string,
  signal: AbortSignal,
  rpc: ReturnType<typeof createPrivacyRpc>
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
      [
        { to: pool.address, data: PRIVACY_POOL_ABI.encodeFunctionData(fn) },
        tag,
      ],
      signal
    );
    return PRIVACY_POOL_ABI.decodeFunctionResult(fn, result)[0];
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
  const known = PRIVACY_POOL_ABI.decodeFunctionResult(
    'isKnownRoot',
    await rpc(
      url,
      'eth_call',
      [
        {
          to: pool.address,
          data: PRIVACY_POOL_ABI.encodeFunctionData('isKnownRoot', [
            snapshot.root,
          ]),
        },
        'latest',
      ],
      signal
    )
  )[0];
  if (known !== true) throw new Error('privacy_snapshot_stale');
  return { blockTimestamp };
}
