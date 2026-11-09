import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  checkAborted,
} from './boundedHttp.ts';
import {
  normalizeSentryServiceUrl,
  SENTRY_NETWORKS,
} from './sentryNetworks.ts';
import type { SentryNetwork } from './sentryNetworks.ts';

// Syscoin Core assigns the registration's transaction ID to proTxHash.
export const SENTRY_REGISTRATION_TX_VERSION = 80;
const RESPONSE_BYTES = 65_536;
const TIMEOUT_MS = 15_000;

export type SentryLinkedNode = Readonly<{
  collateralOutpoint: Readonly<{ txid: string; vout: number }>;
  nevmAddress: string;
  proTxHash: string;
  service: string;
}>;

export type SentryNodeObservation = Readonly<{
  network: SentryNetwork;
  node: SentryLinkedNode;
  origin: string;
}>;

/** The public node identity retained by both wallet hosts. */
export function isSentryLinkedNode(value: unknown): value is SentryLinkedNode {
  const node = value as SentryLinkedNode | null;
  const outpoint = node?.collateralOutpoint;
  return (
    !!node &&
    typeof node.proTxHash === 'string' &&
    /^[0-9a-f]{64}$/.test(node.proTxHash) &&
    typeof outpoint?.txid === 'string' &&
    /^[0-9a-f]{64}$/.test(outpoint.txid) &&
    Number.isSafeInteger(outpoint.vout) &&
    outpoint.vout >= 0 &&
    outpoint.vout <= 0xffffffff &&
    typeof node.service === 'string' &&
    /^[\x21-\x7e]{0,128}$/.test(node.service) &&
    typeof node.nevmAddress === 'string' &&
    (node.nevmAddress === '' || /^0x[0-9a-fA-F]{40}$/.test(node.nevmAddress))
  );
}

type SentryNodeReader = Readonly<{
  assertCurrent(): void;
  fetch(url: string, init: RequestInit): Promise<Response>;
  signal: AbortSignal;
}>;

/** Read only the selected service's public observation for one registration. */
export async function readSentryNode(
  scope: Readonly<{
    network: SentryNetwork;
    origin: string;
    proTxHash: string;
  }>,
  owner: SentryNodeReader
): Promise<SentryNodeObservation> {
  const { network, proTxHash } = scope;
  if (
    !Object.hasOwn(SENTRY_NETWORKS, network) ||
    !/^[0-9a-f]{64}$/.test(proTxHash)
  )
    throw new Error('Invalid registered Sentry node');
  const origin = normalizeSentryServiceUrl(scope.origin);
  const query = new URLSearchParams({ network, proTxHash });
  const url = `${origin}/api/sentry/v1/context?${query}`;
  const request = new AbortController();
  const { signal } = request;
  const abort = () => request.abort();
  const check = () => {
    checkAborted(signal);
    owner.assertCurrent();
  };
  owner.signal.addEventListener('abort', abort, { once: true });
  if (owner.signal.aborted) abort();
  const timeout = setTimeout(abort, TIMEOUT_MS);
  try {
    check();
    const pending = owner
      .fetch(url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
        headers: { Accept: 'application/json' },
      })
      .then((response) => {
        try {
          check();
          return response;
        } catch (error) {
          cancelResponseBody(response);
          throw error;
        }
      });
    const response = await abortable(pending, signal);
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== url) ||
      !response.body?.getReader ||
      typeof TextDecoder === 'undefined'
    )
      throw new Error('Sentry data service is unavailable');
    const observation = JSON.parse(
      await boundedResponseText(response, signal, RESPONSE_BYTES)
    );
    check();
    const node = observation?.node;
    const outpoint = node?.collateralOutpoint;
    if (
      observation?.chain?.genesisHash !==
        SENTRY_NETWORKS[network].genesisHash ||
      node?.proTxHash !== proTxHash ||
      !isSentryLinkedNode(node)
    )
      throw new Error(
        'Unable to verify the registered Sentry node on this network'
      );
    return Object.freeze({
      network,
      origin,
      node: Object.freeze({
        proTxHash,
        service: node.service,
        nevmAddress: node.nevmAddress,
        collateralOutpoint: Object.freeze({
          txid: outpoint.txid,
          vout: outpoint.vout,
        }),
      }),
    });
  } finally {
    clearTimeout(timeout);
    owner.signal.removeEventListener('abort', abort);
    // A rejected response stream alone may leave a native request open.
    abort();
  }
}
