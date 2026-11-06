import { abortable, boundedResponseText, checkAborted, MAX_RESPONSE_BYTES, utf8ByteLength } from '../../../source/shared/boundedHttp.ts';
import { EVM_NETWORK_DEFINITIONS } from '../../../source/shared/evmNetworks.ts';
import { normalizePublicAddress } from './core/addresses.ts';
import { getNativeNetwork, type NativeNetworkRegistration } from './custody/networkContext.ts';
import type { NetworkId } from './core/types.ts';
import type { BalanceReader } from './core/watchOnlyAuthority.ts';

// Pure shared registrations; this import cannot load extension state/browser APIs.
export const RPC_ENDPOINTS: Readonly<Partial<Record<NetworkId, string>>> = Object.freeze(
  Object.fromEntries(EVM_NETWORK_DEFINITIONS.map(({ id, network }) => [id, network.url]))
);

export { abortable, boundedCatalogueResponseText, boundedResponseText, cancelResponseBody, ResponseSizeLimitError, utf8ByteLength } from '../../../source/shared/boundedHttp.ts';
const REQUEST_TIMEOUT_MS = 12_000;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function parseRpcQuantity(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)
  ) {
    throw new Error('Balance endpoint returned an invalid quantity');
  }
  return BigInt(value);
}

export function parseRpcResult(text: string, expectedId: number): bigint {
  if (
    typeof text !== 'string' ||
    text.length > MAX_RESPONSE_BYTES ||
    utf8ByteLength(text) > MAX_RESPONSE_BYTES
  ) {
    throw new Error('Balance response exceeded the size limit');
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Balance endpoint did not return JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid JSON-RPC response');
  const record = body as Record<string, unknown>;
  if (
    record.jsonrpc !== '2.0' ||
    record.id !== expectedId ||
    Object.prototype.hasOwnProperty.call(record, 'error') ||
    !Object.prototype.hasOwnProperty.call(record, 'result')
  ) {
    throw new Error('Invalid JSON-RPC response');
  }
  return parseRpcQuantity(record.result);
}

export function createBalanceReader(
  options: { fetch?: FetchLike; timeoutMs?: number; registrations?: () => readonly NativeNetworkRegistration[] | undefined } = {}
): BalanceReader {
  const fetcher: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Invalid RPC timeout');
  let nextId = 0;

  return {
    async readBalance(networkId, address, externalSignal) {
      checkAborted(externalSignal);
      const network = getNativeNetwork(networkId, options.registrations?.());
      const endpoint = network.rpcUrl;
      if (!endpoint)
        throw new Error('This network is not available for balance lookup');
      const canonicalAddress = normalizePublicAddress(address, networkId);
      const controller = new AbortController();
      const abort = () => controller.abort();
      externalSignal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);

      async function call(
        method: 'eth_chainId' | 'eth_getBalance',
        params: readonly string[]
      ): Promise<bigint> {
        checkAborted(controller.signal);
        const id = ++nextId;
        const response = await abortable(
          fetcher(endpoint!, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: controller.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          }),
          controller.signal
        );
        if (!response.ok) throw new Error('Balance endpoint is unavailable');
        const contentType = response.headers.get('content-type');
        if (
          contentType &&
          !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
            contentType
          )
        ) {
          throw new Error('Balance endpoint did not return JSON');
        }
        const text = await boundedResponseText(response, controller.signal);
        checkAborted(controller.signal);
        return parseRpcResult(text, id);
      }

      try {
        // Do not send even a public account address before checking the endpoint's chain.
        const chainId = await call('eth_chainId', []);
        if (chainId !== BigInt(network.chainId))
          throw new Error('Balance endpoint is on a different network');
        const units = await call('eth_getBalance', [
          canonicalAddress,
          'latest',
        ]);
        return { chainId: Number(network.chainId), units: units.toString() };
      } finally {
        controller.abort();
        clearTimeout(timer);
        externalSignal.removeEventListener('abort', abort);
      }
    },
  };
}
