import { DEFAULT_PRIVACY_SERVICE_ORIGIN } from '../../shared/privacyServiceOrigin.ts';

import {
  createPrivacyRpc,
  createPrivacyProofCheckpointReader,
  createPrivacySnapshotAnchorVerifier,
  readPrivacyPoolSnapshot,
  readPrivacyProofCheckpoint,
  verifyPrivacyProofCheckpoint,
  verifyPrivacySnapshotAnchor,
} from './publicSyncProtocol';
import type {
  PrivacyJsonTransport,
  PrivacyProofCheckpoint,
} from './publicSyncProtocol';
import { validatePrivacyRpcUrl } from './snapshotValidation';
import type { PrivacyPoolId, PrivacySnapshot } from './types';

export { validatePrivacyRpcUrl, validateSnapshot } from './snapshotValidation';
export { PRIVACY_SERVICE_URL } from './publicSyncProtocol';

const requestJson: PrivacyJsonTransport = async (
  url,
  init,
  responseLimit,
  readResponse
) => {
  const response = await fetch(url, init);
  try {
    return {
      data: await readResponse(response, responseLimit(response)),
      status: response.status,
    };
  } finally {
    // Status or Content-Length can reject before the reader takes the body.
    if (response.body && !response.body.locked)
      await response.body.cancel().catch(() => undefined);
  }
};
const rpc = createPrivacyRpc(requestJson);
export const createSnapshotAnchorVerifier = () =>
  createPrivacySnapshotAnchorVerifier(rpc);

export function selectSnapshotProofCheckpoint(
  poolId: PrivacyPoolId,
  rpcUrl: string,
  signal: AbortSignal
) {
  return readPrivacyProofCheckpoint(
    poolId,
    createPrivacyProofCheckpointReader(poolId, rpcUrl, signal, rpc)
  );
}

export function verifySnapshotProofCheckpoint(
  poolId: PrivacyPoolId,
  checkpoint: PrivacyProofCheckpoint,
  rpcUrl: string,
  signal: AbortSignal
) {
  return verifyPrivacyProofCheckpoint(
    checkpoint,
    createPrivacyProofCheckpointReader(poolId, rpcUrl, signal, rpc)
  );
}

export function fetchPrivacySnapshot(
  poolId: PrivacyPoolId,
  signal: AbortSignal,
  serviceOrigin = DEFAULT_PRIVACY_SERVICE_ORIGIN
) {
  return readPrivacyPoolSnapshot(poolId, signal, requestJson, serviceOrigin);
}

export function verifySnapshotAnchor(
  poolId: PrivacyPoolId,
  snapshot: PrivacySnapshot,
  rpcUrl: string,
  signal: AbortSignal
) {
  return verifyPrivacySnapshotAnchor(poolId, snapshot, rpcUrl, signal, rpc);
}

// Explicit user-requested completion checks only. The caller must disclose that
// requesting withdrawal hashes discloses those public transactions to the RPC.
// The shared streaming reader caps raw response bytes before JSON parsing.
export async function readCompletionRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
): Promise<unknown> {
  const quantity = (value: unknown) =>
    typeof value === 'string' &&
    value.length <= 66 &&
    /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value);
  const hash = (value: unknown) =>
    typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
  const allowed =
    Array.isArray(params) &&
    ((method === 'eth_chainId' && params.length === 0) ||
      (method === 'eth_getBlockByNumber' &&
        params.length === 2 &&
        (params[0] === 'finalized' || quantity(params[0])) &&
        params[1] === false) ||
      ((method === 'eth_getTransactionReceipt' ||
        method === 'eth_getTransactionByHash') &&
        params.length === 1 &&
        hash(params[0])));
  if (!allowed) throw new Error('privacy_rpc_unavailable');
  return rpc(validatePrivacyRpcUrl(rpcUrl), method, params, signal);
}
