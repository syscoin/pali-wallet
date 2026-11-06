import { DEFAULT_PRIVACY_SERVICE_ORIGIN } from '../../shared/privacyServiceOrigin.ts';

import {
  createPrivacyRpc,
  PRIVACY_POOL_ABI,
  readPrivacyPoolSnapshot,
  verifyPrivacySnapshotAnchor,
} from './publicSyncProtocol';
import type { PrivacyJsonTransport } from './publicSyncProtocol';
import { PRIVACY_POOLS } from './registry';
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
// requesting withdrawal and related deposit hashes can link them to the RPC.
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

/** Explicit failed-withdrawal recovery only; no arbitrary contract calls. */
export async function readWithdrawalRecoveryRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  signal: AbortSignal
): Promise<unknown> {
  if (method !== 'eth_call')
    return readCompletionRpc(rpcUrl, method, params, signal);
  const call: any =
    Array.isArray(params) && params.length === 2 ? params[0] : undefined;
  if (
    !call ||
    typeof call !== 'object' ||
    Array.isArray(call) ||
    Object.keys(call).sort().join(',') !== 'data,to' ||
    !PRIVACY_POOLS.some((pool) => pool.address === call.to) ||
    typeof params[1] !== 'string' ||
    params[1].length > 66 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(params[1]) ||
    typeof call.data !== 'string' ||
    !/^0x[0-9a-f]{72}$/.test(call.data) ||
    !['isKnownRoot', 'isSpent'].some(
      (name) =>
        call.data.slice(0, 10) === PRIVACY_POOL_ABI.getFunction(name)!.selector
    )
  )
    throw new Error('privacy_rpc_unavailable');
  return rpc(validatePrivacyRpcUrl(rpcUrl), method, params, signal);
}
