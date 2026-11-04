import { normalizePublicAddress } from './core/addresses.ts';
import { getNetwork } from './core/networks.ts';
import type { NetworkId } from './core/types.ts';
import type { BalanceReader } from './core/watchOnlyAuthority.ts';

// Copied from source/utils/constants.ts at extension source 4470e54e.
// Kept as a narrow table to avoid loading extension state and browser globals.
export const RPC_ENDPOINTS: Readonly<Partial<Record<NetworkId, string>>> =
  Object.freeze({
    'syscoin-nevm': 'https://rpc.syscoin.org',
    ethereum: 'https://ethereum-rpc.publicnode.com',
    base: 'https://mainnet.base.org',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
  });

const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function abortError(): Error {
  const error = new Error('Balance request was cancelled or timed out');
  error.name = 'AbortError';
  return error;
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}

export async function boundedResponseText(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  const lengthHeader = response.headers.get('content-length');
  if (
    lengthHeader &&
    (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error('Balance response exceeded the size limit');
  }
  // Streaming fetch implementations can stop reading immediately at the limit.
  // Native fetch may buffer the HTTP body; the parsed response is still bounded.
  if (response.body?.getReader && typeof TextDecoder !== 'undefined') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let result = '';
    try {
      while (true) {
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES)
          throw new Error('Balance response exceeded the size limit');
        result += decoder.decode(chunk.value, { stream: true });
      }
      result += decoder.decode();
      return result;
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  }
  const text = await abortable(response.text(), signal);
  if (
    text.length > MAX_RESPONSE_BYTES ||
    utf8ByteLength(text) > MAX_RESPONSE_BYTES
  ) {
    throw new Error('Balance response exceeded the size limit');
  }
  return text;
}

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
  options: { fetch?: FetchLike; timeoutMs?: number } = {}
): BalanceReader {
  const fetcher: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error('Invalid RPC timeout');
  let nextId = 0;

  return {
    async readBalance(networkId, address, externalSignal) {
      checkAborted(externalSignal);
      const network = getNetwork(networkId);
      const endpoint = RPC_ENDPOINTS[networkId];
      if (network.kind !== 'evm' || !network.chainId || !endpoint)
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
        return { chainId: network.chainId, units: units.toString() };
      } finally {
        clearTimeout(timer);
        externalSignal.removeEventListener('abort', abort);
      }
    },
  };
}
