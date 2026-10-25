import { ensNormalize, namehash, parseEther } from 'ethers';

import { getPrivacyPool, PRIVACY_POOLS } from './registry';
import type { PrivacyPoolId } from './types';

export const PRIVACY_RELAYER_DIRECTORY_URL =
  'https://sysnode.info/api/privacy/v1/relayers';
export const PRIVACY_RELAYER_MAX_AGE_MS = 5 * 60 * 1000;
export const PRIVACY_RELAYER_TIMEOUT_MS = 5000;
const MAX_DIRECTORY_BYTES = 512 * 1024;
const MAX_STATUS_BYTES = 64 * 1024;
const MAX_CHAIN_AGE_MS = 30 * 60 * 1000;
const FUTURE_MS = 30000;
const MAX_UINT = (BigInt(1) << BigInt(256)) - BigInt(1);
// Sysnode's reviewed registry source, not a client-side Ethereum proof.
export const PRIVACY_RELAYER_SOURCE = Object.freeze({
  chainId: 1,
  registry: '0x58e8dcc13be9780fc42e8723d8ead4cf46943df2',
  implementation: '0x84b0c75c1f6211450fec7289c32d717adadd702a',
  implementationCodeHash:
    '0x8c83915c9dca7f9306b1930e43f3a05d7d2424bd0f9edbb324b06d2cfb03ca68',
  ensRegistry: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e',
  deploymentBlock: 14173129,
  urlRecord: 'mainnet-tornado.<registered ENS name>:url',
});

export interface IPrivacyRelayerIdentity {
  ensHash: string;
  ensName: string;
  owner: string;
  registryBalance: string;
}
export interface IPrivacyRelayer extends IPrivacyRelayerIdentity {
  advertisedQueueLength?: number;
  advertisedServiceFeePercent?: string;
  endpoint?: string;
  health: 'unavailable' | 'reported-healthy' | 'reported-unhealthy';
  rewardAccount?: string;
  statusObservedAt?: number;
  supportedPools?: readonly PrivacyPoolId[];
  version?: string;
}
export interface IPrivacyRelayerDirectory {
  asOfBlockHash: string;
  asOfBlockNumber: number;
  asOfBlockTimestamp: number;
  candidateCount: number;
  chainId: 1;
  observedAt: number;
  relayers: readonly Readonly<IPrivacyRelayer>[];
  source: typeof PRIVACY_RELAYER_SOURCE;
  state: 'ready' | 'refreshing';
  unavailableEntries: number;
  version: 1;
}
export interface IPrivacyRelayerSelection {
  advertisedQueueLength: number;
  advertisedServiceFeePercent: string;
  directory: Readonly<IPrivacyRelayerDirectory>;
  endpoint: string;
  ensHash: string;
  observedAt: number;
  poolId: PrivacyPoolId;
  rewardAccount: string;
  version: string;
}
export interface IPrivacyRelayerFee {
  feeWei: string;
  networkFeeWei: string;
  receiveWei: string;
  serviceFeeWei: string;
}
export interface IPrivacyRelayerClient {
  assertSelectionCurrent: (
    selection: Readonly<IPrivacyRelayerSelection>
  ) => void;
  checkRelayer: (
    directory: Readonly<IPrivacyRelayerDirectory>,
    ensHash: string,
    poolId: PrivacyPoolId,
    signal?: AbortSignal
  ) => Promise<Readonly<IPrivacyRelayerSelection>>;
  getDirectory: (
    signal?: AbortSignal
  ) => Promise<Readonly<IPrivacyRelayerDirectory>>;
}

const invalid = () => new Error('privacy_relayer_data_invalid');
const object = (value: unknown): any => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  return value;
};
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  )
    throw invalid();
  return value as number;
};
const uint = (value: unknown): bigint => {
  if (
    typeof value !== 'string' ||
    value.length > 78 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  )
    throw invalid();
  const parsed = BigInt(value);
  if (parsed > MAX_UINT) throw invalid();
  return parsed;
};
const address = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(value) ||
    /^0x0{40}$/.test(value)
  )
    throw invalid();
  return value.toLowerCase();
};
const word = (value: unknown): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value))
    throw invalid();
  return value;
};
const version = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9.+_-]{1,64}$/.test(value))
    throw invalid();
  return value;
};
const percent = (value: unknown): string => {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^(?:(?:0|[1-9][0-9]?)(?:\.[0-9]{1,18})?|100(?:\.0{1,18})?)$/.test(
      String(value)
    )
  )
    throw invalid();
  return String(value)
    .replace(/(\.[0-9]*?)0+$/, '$1')
    .replace(/\.$/, '');
};
const fresh = (observed: number, now: number, age: number) => {
  if (
    !Number.isFinite(now) ||
    now - observed < -FUTURE_MS ||
    now - observed >= age
  )
    throw new Error('privacy_relayer_stale');
};
const poolFor = (poolId: PrivacyPoolId) => {
  try {
    return getPrivacyPool(poolId);
  } catch {
    throw invalid();
  }
};

/** Browser DNS is not pinned. Only a user-selected directory origin is contacted. */
export function validatePrivacyRelayerEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value))
    throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.hostname.length > 253 ||
    !url.hostname.includes('.') ||
    /^[0-9.]+$/.test(url.hostname) ||
    url.hostname
      .split('.')
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /\.(?:localhost|local|internal|home|test|invalid)$/.test(url.hostname)
  )
    throw invalid();
  return url.origin;
}

function pools(value: unknown): readonly PrivacyPoolId[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > PRIVACY_POOLS.length
  )
    throw invalid();
  const accepted = new Set(value);
  if (
    accepted.size !== value.length ||
    value.some((id) => !PRIVACY_POOLS.some((pool) => pool.id === id))
  )
    throw invalid();
  return Object.freeze(
    PRIVACY_POOLS.filter((pool) => accepted.has(pool.id)).map((pool) => pool.id)
  );
}
function readDirectory(
  value: unknown,
  state: string | null,
  now: number
): Readonly<IPrivacyRelayerDirectory> {
  const raw = object(value),
    source = object(raw.source);
  if (
    raw.version !== 1 ||
    raw.chainId !== 1 ||
    Object.entries(PRIVACY_RELAYER_SOURCE).some(
      ([key, expected]) => source[key] !== expected
    ) ||
    (state !== 'ready' && state !== 'refreshing') ||
    !Array.isArray(raw.relayers) ||
    raw.relayers.length > 256
  )
    throw invalid();
  const asOfBlockNumber = integer(raw.asOfBlockNumber);
  const asOfBlockTimestamp = integer(raw.asOfBlockTimestamp);
  const observedAt = integer(raw.observedAt);
  if (
    asOfBlockNumber < PRIVACY_RELAYER_SOURCE.deploymentBlock ||
    asOfBlockTimestamp <= 0
  )
    throw invalid();
  fresh(observedAt, now, PRIVACY_RELAYER_MAX_AGE_MS);
  fresh(asOfBlockTimestamp * 1000, now, MAX_CHAIN_AGE_MS);
  const candidateCount = integer(raw.candidateCount, 256);
  const unavailableEntries = integer(raw.unavailableEntries, candidateCount);
  if (raw.relayers.length > candidateCount) throw invalid();
  const seen = new Set<string>();
  const relayers = raw.relayers.map((item: unknown) => {
    const entry = object(item);
    if (
      typeof entry.ensName !== 'string' ||
      new TextEncoder().encode(entry.ensName).length > 255 ||
      !entry.ensName ||
      ensNormalize(entry.ensName) !== entry.ensName ||
      namehash(entry.ensName) !== word(entry.ensHash) ||
      seen.has(entry.ensHash)
    )
      throw invalid();
    seen.add(entry.ensHash);
    const identity: IPrivacyRelayerIdentity = {
      ensName: entry.ensName,
      ensHash: entry.ensHash,
      owner: address(entry.owner),
      registryBalance: uint(entry.registryBalance).toString(),
    };
    if (entry.health === 'unavailable')
      return Object.freeze({ ...identity, health: 'unavailable' as const });
    if (!['reported-healthy', 'reported-unhealthy'].includes(entry.health))
      throw invalid();
    const statusObservedAt = integer(entry.statusObservedAt);
    if (statusObservedAt > observedAt) throw invalid();
    fresh(statusObservedAt, now, PRIVACY_RELAYER_MAX_AGE_MS);
    return Object.freeze({
      ...identity,
      health: entry.health,
      endpoint: validatePrivacyRelayerEndpoint(entry.endpoint),
      rewardAccount: address(entry.rewardAccount),
      supportedPools: pools(entry.supportedPools),
      advertisedServiceFeePercent: percent(entry.advertisedServiceFeePercent),
      advertisedQueueLength: integer(entry.advertisedQueueLength, 1000000),
      version: version(entry.version),
      statusObservedAt,
    });
  });
  return Object.freeze({
    version: 1,
    chainId: 1,
    source: PRIVACY_RELAYER_SOURCE,
    asOfBlockNumber,
    asOfBlockHash: word(raw.asOfBlockHash),
    asOfBlockTimestamp,
    observedAt,
    candidateCount,
    unavailableEntries,
    relayers: Object.freeze(relayers),
    state,
  }) as Readonly<IPrivacyRelayerDirectory>;
}
function readStatus(value: unknown) {
  const raw = object(value),
    instances = object(raw.instances),
    eth = object(instances.eth);
  if (
    raw.netId !== 1 ||
    Object.keys(instances).length > 32 ||
    eth.decimals !== 18
  )
    throw invalid();
  const addresses = object(eth.instanceAddress);
  if (Object.keys(addresses).length > 32) throw invalid();
  const supportedPools: PrivacyPoolId[] = [];
  for (const pool of PRIVACY_POOLS) {
    if (Object.prototype.hasOwnProperty.call(addresses, pool.amount)) {
      if (address(addresses[pool.amount]) !== pool.address) throw invalid();
      supportedPools.push(pool.id);
    }
  }
  if (
    !supportedPools.length ||
    ![true, false, 'true', 'false'].includes(raw.health?.status)
  )
    throw invalid();
  return {
    supportedPools,
    rewardAccount: address(raw.rewardAccount),
    fee: percent(raw.tornadoServiceFee),
    healthy: raw.health.status === true || raw.health.status === 'true',
    queue: integer(raw.currentQueue, 1000000),
    version: version(raw.version),
  };
}

async function readJson(response: Response, maximum: number): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (
    !response.body ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get('content-type') || ''
    ) ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw invalid();
  }
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw invalid();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createPrivacyRelayerClient(
  options: {
    fetcher?: typeof fetch;
    now?: () => number;
  } = {}
): IPrivacyRelayerClient {
  const fetcher = options.fetcher || fetch,
    now = options.now || Date.now;
  const directories = new WeakSet<object>(),
    selections = new WeakSet<object>();
  const assertDirectory = (directory: Readonly<IPrivacyRelayerDirectory>) => {
    if (!directories.has(directory)) throw invalid();
    fresh(directory.observedAt, now(), PRIVACY_RELAYER_MAX_AGE_MS);
    fresh(directory.asOfBlockTimestamp * 1000, now(), MAX_CHAIN_AGE_MS);
    for (const entry of directory.relayers)
      if (entry.statusObservedAt !== undefined)
        fresh(entry.statusObservedAt, now(), PRIVACY_RELAYER_MAX_AGE_MS);
  };
  const request = async <T>(
    url: string,
    maximum: number,
    parse: (response: Response) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    if (signal?.aborted) throw new Error('privacy_relayer_cancelled');
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let remove = () => undefined;
    const cancelled = new Promise<never>((_, reject) => {
      const cancel = () => {
        abort.abort();
        reject(new Error('privacy_relayer_cancelled'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      remove = () => signal?.removeEventListener('abort', cancel);
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('privacy_relayer_timeout'));
      }, PRIVACY_RELAYER_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        cancelled,
        (async () => {
          const response = await fetcher(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: abort.signal,
          });
          if (abort.signal.aborted)
            throw new Error('privacy_relayer_cancelled');
          if (
            response.redirected ||
            response.type === 'opaque' ||
            response.type === 'opaqueredirect' ||
            (response.url && response.url !== url)
          )
            throw invalid();
          if (response.status === 202)
            throw new Error('privacy_relayer_directory_pending');
          if (response.status !== 200)
            throw new Error('privacy_relayer_unavailable');
          const declared = response.headers.get('content-length');
          if (declared && Number(declared) > maximum) {
            await response.body?.cancel();
            throw invalid();
          }
          return parse(response);
        })(),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /^privacy_relayer_[a-z_]+$/.test(error.message)
      )
        throw error;
      throw new Error('privacy_relayer_unavailable');
    } finally {
      clearTimeout(timer!);
      remove();
    }
  };
  return {
    getDirectory: async (signal) =>
      request(
        PRIVACY_RELAYER_DIRECTORY_URL,
        MAX_DIRECTORY_BYTES,
        async (response) => {
          if (response.headers.get('x-privacy-index-state') === 'stale')
            throw new Error('privacy_relayer_stale');
          const directory = readDirectory(
            await readJson(response, MAX_DIRECTORY_BYTES),
            response.headers.get('x-privacy-index-state'),
            now()
          );
          directories.add(directory);
          return directory;
        },
        signal
      ),
    checkRelayer: async (directory, ensHash, poolId, signal) => {
      assertDirectory(directory);
      poolFor(poolId);
      const entry = directory.relayers.find((item) => item.ensHash === ensHash);
      if (
        !entry ||
        entry.health !== 'reported-healthy' ||
        !entry.endpoint ||
        !entry.supportedPools?.includes(poolId)
      )
        throw new Error('privacy_relayer_unavailable');
      return request(
        `${entry.endpoint}/status`,
        MAX_STATUS_BYTES,
        async (response) => {
          const status = readStatus(await readJson(response, MAX_STATUS_BYTES));
          assertDirectory(directory);
          if (
            !status.healthy ||
            status.rewardAccount !== entry.rewardAccount ||
            status.fee !== entry.advertisedServiceFeePercent ||
            status.version !== entry.version ||
            status.supportedPools.join(',') !== entry.supportedPools!.join(',')
          )
            throw new Error('privacy_relayer_changed');
          const selection = Object.freeze({
            directory,
            endpoint: entry.endpoint!,
            ensHash: entry.ensHash,
            poolId,
            rewardAccount: status.rewardAccount,
            advertisedServiceFeePercent: status.fee,
            advertisedQueueLength: status.queue,
            version: status.version,
            observedAt: now(),
          });
          selections.add(selection);
          return selection;
        },
        signal
      );
    },
    assertSelectionCurrent: (selection) => {
      if (!selections.has(selection)) throw invalid();
      assertDirectory(selection.directory);
      fresh(selection.observedAt, now(), PRIVACY_RELAYER_MAX_AGE_MS);
    },
  };
}

/** Exact conservative estimate, not a promise that the relayer accepts this fee. */
export function quotePrivacyRelayerFee(
  poolId: PrivacyPoolId,
  serviceFeePercent: string,
  gasLimit: string,
  gasPriceWei: string
): Readonly<IPrivacyRelayerFee> {
  const amount = parseEther(poolFor(poolId).amount);
  const rate = percent(serviceFeePercent),
    [whole, fraction = ''] = rate.split('.');
  const scale = BigInt('1' + '0'.repeat(fraction.length));
  const numerator = BigInt(whole) * scale + BigInt(fraction || '0');
  const divisor = BigInt(100) * scale;
  const serviceFee = (amount * numerator + divisor - BigInt(1)) / divisor;
  const gas = uint(gasLimit),
    price = uint(gasPriceWei);
  if (!gas || !price) throw invalid();
  const networkFee = gas * price,
    fee = serviceFee + networkFee;
  if (fee >= amount) throw new Error('privacy_relayer_fee_too_high');
  return Object.freeze({
    serviceFeeWei: serviceFee.toString(),
    networkFeeWei: networkFee.toString(),
    feeWei: fee.toString(),
    receiveWei: (amount - fee).toString(),
  });
}
