import { JsonRpcReadClient, RpcReadCapabilities } from '@sidhujag/sysweb3-keyring/cjs/rpc-read-client.js';
import { getAddress } from 'ethers/address';
import { observeEvmTransaction, readEvmReceiptFeeUnits, type EvmObservationRequest, type EvmTransactionObservation } from '../../../../source/shared/evmTransactionObservation.ts';
import { boundedResponseText, cancelResponseBody, parseRpcQuantity, utf8ByteLength } from '../platformRpc.ts';
import { createBoundedRpcFetch } from '../custody/boundedRpcFetch.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from '../custody/networkContext.ts';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_TRANSACTION_BYTES = 256 * 1024;
const MAX_BLOCK_BYTES = 512 * 1024;
const MAX_LOGS = 512;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;

export type ActivityTransferEvent = Readonly<{
  /** Network/account scope is supplied by the owning Activity controller. */
  id: string;
  logIndex: string;
  contractAddress: string;
  from: string;
  to: string;
  amountUnits: string;
}>;
export type ActivityTransactionObservation = Readonly<{
  hash: string;
  from: string;
  to: string | null;
  valueUnits: string;
  nonce: string;
  timestamp: number | null;
  block: Readonly<{ hash: string; number: string }> | null;
  status:
    | 'pending'
    | 'confirmed'
    | 'reverted'
    | 'unknown';
  events: readonly ActivityTransferEvent[];
  feeUnits: string | null;
  /** Present only when the canonical block lists this exact transaction hash. */
  transactionIndex?: number;
}>;
export class ActivityReceiptError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'CANCELLED'
    | 'CONTEXT_CHANGED'
    | 'IRRELEVANT';
  constructor(code: ActivityReceiptError['code']) {
    super(code);
    this.name = 'ActivityReceiptError';
    this.code = code;
  }
}

type Method =
  | 'eth_chainId'
  | 'eth_getTransactionCount'
  | 'eth_getTransactionByHash'
  | 'eth_getTransactionReceipt'
  | 'eth_getBlockByNumber';
type Read = (method: Method, params: readonly unknown[], signal?: AbortSignal) => Promise<unknown>;
type Block = Readonly<{
  hash: string;
  number: string;
  timestamp: number | null;
}>;
type Transaction = Readonly<{
  hash: string;
  from: string;
  to: string | null;
  valueUnits: string;
  nonce: string;
  block: Readonly<{
    hash: string;
    number: string;
    transactionIndex: string;
  }> | null;
}>;
type Receipt = Readonly<{
  from: string;
  to: string | null;
  block: Readonly<{ hash: string; number: string; transactionIndex: string }>;
  succeeded: boolean | null;
  events: readonly ActivityTransferEvent[];
  feeUnits: string | null;
  identity: string;
}>;
const fail = (code: ActivityReceiptError['code']): never => {
  throw new ActivityReceiptError(code);
};
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value))
    return fail('INVALID_RESPONSE');
  return value.toLowerCase();
}
function address(value: unknown): string {
  if (typeof value !== 'string') return fail('INVALID_RESPONSE');
  try {
    return getAddress(value);
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
function quantity(value: unknown): bigint {
  try {
    return parseRpcQuantity(value);
  } catch {
    return fail('INVALID_RESPONSE');
  }
}
const tag = (value: string) => `0x${BigInt(value).toString(16)}`;
const sameAddress = (left: string | null, right: string | null) =>
  left === right;
function guardCurrent(guard: () => void): void {
  let result: unknown;
  try {
    result = guard();
  } catch {
    return fail('CANCELLED');
  }
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    fail('CANCELLED');
  }
}
async function cancellable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return fail('CANCELLED');
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ActivityReceiptError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
function readBlock(value: unknown): Block {
  const raw = object(value);
  const number = quantity(raw.number).toString();
  let timestamp: number | null = null;
  if (raw.timestamp !== undefined && raw.timestamp !== null) {
    const seconds = quantity(raw.timestamp);
    if (seconds <= BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)))
      timestamp = Number(seconds) * 1000;
  }
  return Object.freeze({ number, hash: hash(raw.hash), timestamp });
}
function readTransaction(value: unknown, expectedHash: string): Transaction {
  const raw = object(value);
  if (hash(raw.hash) !== expectedHash) return fail('INVALID_RESPONSE');
  const noBlock =
    raw.blockHash === null &&
    raw.blockNumber === null &&
    raw.transactionIndex === null;
  const block = noBlock
    ? null
    : Object.freeze({
        hash: hash(raw.blockHash),
        number: quantity(raw.blockNumber).toString(),
        transactionIndex: quantity(raw.transactionIndex).toString(),
      });
  return Object.freeze({
    hash: expectedHash,
    from: address(raw.from),
    to: raw.to === null ? null : address(raw.to),
    valueUnits: quantity(raw.value).toString(),
    nonce: quantity(raw.nonce).toString(),
    block,
  });
}
function topicAddress(value: string): string {
  if (!/^0x0{24}[0-9a-f]{40}$/.test(value)) return fail('INVALID_RESPONSE');
  return address(`0x${value.slice(26)}`);
}
function readReceipt(
  value: unknown,
  expectedHash: string,
  owner: string,
  chainId: string
): Receipt {
  const raw = object(value);
  if (hash(raw.transactionHash) !== expectedHash)
    return fail('INVALID_RESPONSE');
  const block = Object.freeze({
    hash: hash(raw.blockHash),
    number: quantity(raw.blockNumber).toString(),
    transactionIndex: quantity(raw.transactionIndex).toString(),
  });
  const status = raw.status === undefined || raw.status === null ? null : quantity(raw.status);
  // Pre-EIP-658 receipts expose a post-state root, not an execution outcome.
  const stateRoot = status === null ? hash(raw.root) : undefined;
  if (status === null && raw.type !== undefined && quantity(raw.type) !== 0n)
    return fail('INVALID_RESPONSE');
  if (status !== null && status !== 0n && status !== 1n) return fail('INVALID_RESPONSE');
  if (!Array.isArray(raw.logs) || raw.logs.length > MAX_LOGS)
    return fail('INVALID_RESPONSE');
  const events: ActivityTransferEvent[] = [];
  const indices = new Map<string, string>();
  for (const value of raw.logs) {
    const log = object(value);
    if (log.removed !== undefined && log.removed !== false)
      return fail('CONTEXT_CHANGED');
    if (
      hash(log.transactionHash) !== expectedHash ||
      hash(log.blockHash) !== block.hash ||
      quantity(log.blockNumber).toString() !== block.number ||
      quantity(log.transactionIndex).toString() !== block.transactionIndex
    )
      return fail('INVALID_RESPONSE');
    const logIndex = quantity(log.logIndex).toString();
    const contractAddress = address(log.address);
    if (
      !Array.isArray(log.topics) ||
      log.topics.length > 4 ||
      typeof log.data !== 'string' ||
      !BYTES.test(log.data)
    )
      return fail('INVALID_RESPONSE');
    const topics = log.topics.map(hash);
    const data = log.data.toLowerCase();
    const identity = JSON.stringify([contractAddress, topics, data]);
    const previous = indices.get(logIndex);
    if (previous !== undefined) {
      if (previous !== identity) return fail('INVALID_RESPONSE');
      continue;
    }
    indices.set(logIndex, identity);
    // ERC721's Transfer uses four topics. It is not an ERC20 amount event.
    if (topics[0] !== TRANSFER_TOPIC || topics.length !== 3) continue;
    if (data.length !== 66) return fail('INVALID_RESPONSE');
    const from = topicAddress(topics[1]!);
    const to = topicAddress(topics[2]!);
    if (from !== owner && to !== owner) continue;
    events.push(
      Object.freeze({
        id: `${expectedHash}:${logIndex}`,
        logIndex,
        contractAddress,
        from,
        to,
        amountUnits: BigInt(data).toString(),
      })
    );
  }
  if (status === 0n && raw.logs.length !== 0) return fail('INVALID_RESPONSE');
  events.sort((left, right) =>
    BigInt(left.logIndex) < BigInt(right.logIndex) ? -1 : 1
  );
  let feeUnits: string | null = null;
  try { feeUnits = readEvmReceiptFeeUnits(raw, chainId); }
  catch { return fail('INVALID_RESPONSE'); }
  const from = address(raw.from),
    to = raw.to === null ? null : address(raw.to);
  return Object.freeze({
    from,
    to,
    block,
    succeeded: status === null ? null : status === 1n,
    events: Object.freeze(events),
    feeUnits,
    identity: JSON.stringify([
      from,
      to,
      block,
      status === null ? stateRoot : status.toString(),
      feeUnits,
      [...indices].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)),
    ]),
  });
}
function assertPair(transaction: Transaction, receipt: Receipt) {
  if (
    transaction.from !== receipt.from ||
    !sameAddress(transaction.to, receipt.to) ||
    !transaction.block ||
    transaction.block.hash !== receipt.block.hash ||
    transaction.block.number !== receipt.block.number ||
    transaction.block.transactionIndex !== receipt.block.transactionIndex
  )
    fail('CONTEXT_CHANGED');
}

type SharedReceipt = {
  expected: EvmObservationRequest;
  controller: AbortController;
  subscribers: Set<() => void>;
  observation: Promise<EvmTransactionObservation>;
  promise: Promise<{
    observation: EvmTransactionObservation;
    detail: PromiseSettledResult<ActivityTransactionObservation | null>;
  }>;
  details(): boolean;
  cancelDetails(): void;
  detailSubscribers: number;
  closing: boolean;
};

/** Indexed rows are hints; this adapter returns bounded observations from the selected registration’s EVM RPC. */
export class ActivityReceiptReader {
  private readonly fetcher: (
    url: string,
    init: RequestInit
  ) => Promise<Response>;
  private readonly timeoutMs: number;
  private sequence = 0;
  private readonly pending = new Map<string, SharedReceipt>();
  private readonly capabilities = new Map<string, RpcReadCapabilities>();
  constructor(
    options: {
      fetch?: (url: string, init: RequestInit) => Promise<Response>;
      timeoutMs?: number;
    } = {}
  ) {
    this.fetcher = createBoundedRpcFetch(options.fetch ?? ((url, init) => fetch(url, init)));
    this.timeoutMs = options.timeoutMs ?? 12000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000
    )
      throw new Error('Invalid Activity timeout');
  }
  private sharedKey(
    scope: string,
    registration: NativeNetworkRegistration,
    value: string
  ) {
    return JSON.stringify([
      scope,
      registration.registrationHash,
      registration.rpcUrl,
      registration.chainId,
      value.toLowerCase(),
    ]);
  }

  private subscribe<T>(
    entry: SharedReceipt,
    external: AbortSignal,
    guard: () => void,
    promise: Promise<T>,
    details = false
  ): Promise<T> {
    guardCurrent(guard);
    if (external.aborted)
      return Promise.reject(new ActivityReceiptError('CANCELLED'));
    return new Promise((resolve, reject) => {
      let finished = false;
      const check = () => {
        guardCurrent(guard);
        if (external.aborted) fail('CANCELLED');
      };
      const finish = (work: () => void) => {
        if (finished) return;
        finished = true;
        external.removeEventListener('abort', abort);
        entry.subscribers.delete(check);
        if (details && --entry.detailSubscribers === 0) entry.cancelDetails();
        if (!entry.subscribers.size) entry.controller.abort();
        work();
      };
      const abort = () =>
        finish(() => reject(new ActivityReceiptError('CANCELLED')));
      entry.subscribers.add(check);
      if (details) entry.detailSubscribers++;
      external.addEventListener('abort', abort, { once: true });
      promise.then(
        (value) =>
          finish(() => {
            try {
              check();
              resolve(JSON.parse(JSON.stringify(value)));
            } catch (error) {
              reject(error);
            }
          }),
        (error) => finish(() => reject(error))
      );
      if (external.aborted) abort();
    });
  }

  retainedWave(registration: NativeNetworkRegistration, scope: string, lifetime: AbortSignal, guard: () => void) {
    registration = snapshotNativeNetwork(registration);
    const endpoint = registration.rpcUrl;
    const capabilityKey = JSON.stringify([registration.registrationHash, endpoint]);
    let capabilities = this.capabilities.get(capabilityKey);
    if (!capabilities) {
      capabilities = new RpcReadCapabilities(endpoint);
      this.capabilities.set(capabilityKey, capabilities);
      if (this.capabilities.size > 16) this.capabilities.delete(this.capabilities.keys().next().value!);
    }
    const client = new JsonRpcReadClient(endpoint, {
      capabilities,
      timeoutMs: this.timeoutMs,
      maxBatchItems: 2,
      maxResponseBytes: 2 * MAX_BLOCK_BYTES,
      requestInit: { credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' },
      fetch: async (url, init) => {
        guardCurrent(guard);
        if (lifetime.aborted || url !== endpoint) return fail('CANCELLED');
        const response = await this.fetcher(url, init);
        const contentType = response.headers.get('content-type');
        if (lifetime.aborted || response.redirected || (response.url && response.url !== endpoint) ||
            (contentType && !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(contentType))) {
          cancelResponseBody(response);
          return fail('INVALID_RESPONSE');
        }
        return response;
      },
    });
    type Job = {
      method: Method;
      params: readonly unknown[];
      promise: Promise<unknown>;
      resolve(value: unknown): void;
      reject(reason: unknown): void;
    };
    const queue = new Map<string, Job>();
    const recurring = new Map<string, Promise<unknown>>();
    const limit = (method: Method) => method === 'eth_getBlockByNumber' ? MAX_BLOCK_BYTES
      : method === 'eth_getTransactionReceipt' ? MAX_RECEIPT_BYTES : 16 * 1024;
    const flush = async () => {
      const jobs = [...queue.values()];
      queue.clear();
      try {
        guardCurrent(guard);
        const results = await client.readMany(jobs.map(({ method, params }) => ({ method, params })), {
          signal: lifetime,
          maxResponseBytes: jobs.reduce((bytes, job) => bytes + limit(job.method), 0),
        });
        for (const [index, job] of jobs.entries()) {
          const result = results[index]!;
          if (result.status === 'rejected') job.reject(result.reason);
          else {
            if (utf8ByteLength(JSON.stringify(result.value)) > limit(job.method))
              job.reject(new ActivityReceiptError('INVALID_RESPONSE'));
            else job.resolve(result.value);
          }
        }
      } catch (error) {
        for (const job of jobs) job.reject(error);
      }
    };
    const read = (method: Method, params: readonly unknown[], final: boolean) => {
      const key = JSON.stringify([final, method, params]);
      const reusable = !final && method !== 'eth_getTransactionReceipt';
      const prior = recurring.get(key) ?? queue.get(key)?.promise;
      if (prior) return prior;
      let resolve!: Job['resolve'], reject!: Job['reject'];
      const promise = new Promise<unknown>((accept, decline) => { resolve = accept; reject = decline; });
      if (!queue.size) queueMicrotask(() => void flush());
      // A final identity check can only join work that has yet to dispatch.
      queue.set(key, { method, params, promise, resolve, reject });
      if (reusable) recurring.set(key, promise);
      return promise;
    };
    return {
      observe: (request: EvmObservationRequest) => this.observe(request, lifetime, guard, registration, scope, read),
      close: () => client.destroy(),
    };
  }

  observe(
    input: EvmObservationRequest,
    external: AbortSignal,
    guard: () => void,
    registration: NativeNetworkRegistration,
    scope: string,
    wave?: (method: Method, params: readonly unknown[], final: boolean) => Promise<unknown>
  ): Promise<EvmTransactionObservation> {
    registration = snapshotNativeNetwork(registration);
    guardCurrent(guard);
    if (external.aborted)
      return Promise.reject(new ActivityReceiptError('CANCELLED'));
    const fields = ['chainId', 'from', 'to', 'hash', 'nonce'] as const;
    if (
      !input ||
      typeof input !== 'object' ||
      Reflect.ownKeys(input).length !== fields.length ||
      fields.some((field) => {
        const property = Object.getOwnPropertyDescriptor(input, field);
        return !property?.enumerable || !('value' in property);
      })
    )
      return Promise.reject(new ActivityReceiptError('INVALID_INPUT'));
    let expected: EvmObservationRequest;
    try {
      if (
        !/^[1-9][0-9]{0,77}$/.test(input.chainId) ||
        !/^(0|[1-9][0-9]{0,77})$/.test(input.nonce) ||
        BigInt(input.chainId) >= 1n << 256n ||
        BigInt(input.nonce) >= 1n << 256n
      )
        fail('INVALID_INPUT');
      expected = Object.freeze({
        chainId: input.chainId,
        from: address(input.from),
        to: input.to === null ? null : address(input.to),
        hash: hash(input.hash),
        nonce: input.nonce,
      });
    } catch {
      return Promise.reject(new ActivityReceiptError('INVALID_INPUT'));
    }
    if (expected.chainId !== registration.chainId)
      return Promise.reject(new ActivityReceiptError('CONTEXT_CHANGED'));
    const key = this.sharedKey(scope, registration, expected.hash);
    let entry = this.pending.get(key);
    if (
      entry &&
      (entry.expected.from !== expected.from ||
        entry.expected.to !== expected.to ||
        entry.expected.nonce !== expected.nonce)
    )
      return Promise.reject(new ActivityReceiptError('CONTEXT_CHANGED'));
    if (!entry || entry.controller.signal.aborted || entry.closing) {
      const controller = new AbortController();
      const subscribers = new Set<() => void>();
      let detailsRequested = false;
      const detailController = new AbortController();
      let requestDetails = () => {
        detailsRequested = true;
        return true;
      };
      let resolveObservation!: (value: EvmTransactionObservation) => void;
      let rejectObservation!: (error: unknown) => void;
      const observation = new Promise<EvmTransactionObservation>((resolve, reject) => {
        resolveObservation = resolve;
        rejectObservation = reject;
      });
      entry = {
        expected,
        controller,
        subscribers,
        observation,
        detailSubscribers: 0,
        cancelDetails: () => {
          detailsRequested = false;
          detailController.abort();
          current.closing = true;
        },
        closing: false,
        details: () => requestDetails(),
        promise: Promise.resolve(null as never),
      };
      const current = entry;
      const check = () => {
        if (controller.signal.aborted) fail('CANCELLED');
        let active = false;
        for (const subscriber of subscribers) {
          try {
            subscriber();
            active = true;
          } catch {
            /* Another subscriber may still own this read. */
          }
        }
        if (!active) fail('CANCELLED');
      };
      this.pending.set(key, current);
      current.promise = Promise.resolve()
        .then(() =>
          this.operation(
            registration,
            controller.signal,
            check,
            async (read, assertCurrent) => {
              let rawReceipt: unknown, rawBlock: unknown;
              let identityAccepted = false;
              let transaction:
                | Promise<PromiseSettledResult<unknown>>
                | undefined;
              let transactionResult: PromiseSettledResult<unknown> | undefined;
              let detailsCovered = false;
              requestDetails = () => {
                if (current.closing) return false;
                detailsRequested = true;
                if (!identityAccepted) return true;
                transaction ??= read(
                  'eth_getTransactionByHash',
                  [expected.hash],
                  detailController.signal
                ).then(
                  (value) => transactionResult = { status: 'fulfilled' as const, value },
                  (reason) => transactionResult = { status: 'rejected' as const, reason }
                );
                return true;
              };
              let chainReads = 0;
              const observation = await observeEvmTransaction(
                expected,
                async (method, params) => {
                  // The shared observer requests account data only after accepting its first chain result.
                  if (method !== 'eth_chainId' && !identityAccepted) {
                    identityAccepted = true;
                    if (detailsRequested) requestDetails();
                  }
                  if (method === 'eth_chainId' && ++chainReads > 1) {
                    current.closing = true;
                    detailsCovered = transactionResult !== undefined;
                  }
                  assertCurrent();
                  const value = wave
                    ? await cancellable(wave(method, params, method === 'eth_chainId' && chainReads > 1), controller.signal)
                    : await read(method, params);
                  assertCurrent();
                  if (method === 'eth_getTransactionReceipt')
                    rawReceipt = value;
                  if (method === 'eth_getBlockByNumber') rawBlock = value;
                  return value;
                },
                assertCurrent
              );
              resolveObservation(observation);
              let detail: PromiseSettledResult<ActivityTransactionObservation | null> =
                { status: 'fulfilled', value: null };
              try {
                if (transaction) {
                  let result = await transaction;
                  if (result.status === 'rejected') throw result.reason;
                  if (observation.status === 'mined' &&
                    (result.value === null || !readTransaction(result.value, expected.hash).block)) {
                    detailsCovered = false;
                    result = await read('eth_getTransactionByHash', [expected.hash], detailController.signal).then(
                      value => ({ status: 'fulfilled' as const, value }),
                      reason => ({ status: 'rejected' as const, reason }));
                    if (result.status === 'rejected') throw result.reason;
                  }
                  const body = result.value;
                  if (body !== null) {
                    const tx = readTransaction(body, expected.hash);
                    if (observation.status === 'mined') {
                      const receipt = readReceipt(
                        rawReceipt,
                        expected.hash,
                        expected.from,
                        expected.chainId
                      );
                      assertPair(tx, receipt);
                      const block = detailsCovered ? readBlock(rawBlock) : readBlock(await read(
                        'eth_getBlockByNumber', [tag(receipt.block.number), false], detailController.signal));
                      if (block.hash !== receipt.block.hash || block.number !== receipt.block.number)
                        fail('CONTEXT_CHANGED');
                      detail = {
                        status: 'fulfilled',
                        value: Object.freeze({
                          ...tx,
                          timestamp: block.timestamp,
                          block: observation.block,
                          status: observation.outcome,
                          events: receipt.events,
                          feeUnits: receipt.feeUnits,
                          ...(observation.transactionIndex === undefined
                            ? {}
                            : {
                                transactionIndex: observation.transactionIndex,
                              }),
                        }),
                      };
                    } else {
                      if (tx.from !== expected.from && tx.to !== expected.from)
                        fail('IRRELEVANT');
                      detail = {
                        status: 'fulfilled',
                        value: Object.freeze({
                          ...tx,
                          block: null,
                          timestamp: null,
                          status: tx.block ? 'unknown' : 'pending',
                          events: [],
                          feeUnits: null,
                        }),
                      };
                    }
                  } else if (observation.status === 'mined')
                    fail('CONTEXT_CHANGED');
                  if (!detailsCovered && quantity(await read('eth_chainId', [], detailController.signal)) !== BigInt(registration.chainId))
                    fail('CONTEXT_CHANGED');
                }
              } catch (error) {
                detail = {
                  status: 'rejected',
                  reason:
                    error instanceof ActivityReceiptError
                      ? error
                      : new ActivityReceiptError('UNAVAILABLE'),
                };
              }
              assertCurrent();
              return { observation, detail };
            }
          )
        )
        .finally(() => {
          current.closing = true;
          if (this.pending.get(key) === current) this.pending.delete(key);
        });
      void current.promise.catch(rejectObservation);
    }
    return this.subscribe(entry, external, guard, entry.observation);
  }

  async read(
    inputHash: string,
    inputOwner: string,
    external: AbortSignal,
    guard: () => void,
    registration: NativeNetworkRegistration,
    sharingScope?: string
  ): Promise<ActivityTransactionObservation | null> {
    let expectedHash: string, owner: string;
    try {
      expectedHash = hash(inputHash);
      owner = address(inputOwner);
      if (/^0x0{40}$/i.test(owner)) return fail('INVALID_INPUT');
    } catch {
      return fail('INVALID_INPUT');
    }
    guardCurrent(guard);
    if (external.aborted) return fail('CANCELLED');
    if (sharingScope) {
      const entry = this.pending.get(
        this.sharedKey(sharingScope, registration, expectedHash)
      );
      if (
        entry &&
        entry.expected.from === owner &&
        !entry.controller.signal.aborted &&
        entry.details()
      )
        return this.subscribe(
          entry,
          external,
          guard,
          entry.promise.then((value) => {
            if (value.detail.status === 'rejected') throw value.detail.reason;
            return value.detail.value;
          }),
          true
        );
    }
    return this.operation(
      registration,
      external,
      guard,
      async (read, check) => {
        const checkChain = async () => {
          if (
            quantity(await read('eth_chainId', [])) !==
            BigInt(registration.chainId)
          )
            fail('CONTEXT_CHANGED');
        };
        const canonical = async (block: Block | Receipt['block']) => {
          const raw = await read('eth_getBlockByNumber', [
            tag(block.number),
            false,
          ]);
          const observed = readBlock(raw);
          if (observed.hash !== block.hash || observed.number !== block.number)
            fail('CONTEXT_CHANGED');
          const index =
            'transactionIndex' in block ? Number(block.transactionIndex) : NaN;
          const transactions = object(raw).transactions;
          return {
            ...observed,
            ...(Number.isSafeInteger(index) &&
            index >= 0 &&
            Array.isArray(transactions) &&
            typeof transactions[index] === 'string' &&
            transactions[index].toLowerCase() === expectedHash
              ? { transactionIndex: index }
              : {}),
          };
        };
        try {
          await checkChain();
          let [rawTransaction, rawReceipt] = await Promise.all([
            read('eth_getTransactionByHash', [expectedHash]),
            read('eth_getTransactionReceipt', [expectedHash]),
          ]);
          check();
          if (rawTransaction === null && rawReceipt !== null)
            rawTransaction = await read('eth_getTransactionByHash', [
              expectedHash,
            ]);
          if (rawTransaction === null) {
            if (rawReceipt !== null) return fail('CONTEXT_CHANGED');
            await checkChain();
            return null;
          }
          let transaction = readTransaction(rawTransaction, expectedHash);
          if (rawReceipt === null) {
            if (transaction.from !== owner && transaction.to !== owner)
              return fail('IRRELEVANT');
            await checkChain();
            check();
            return Object.freeze({
              ...transaction,
              block: null,
              timestamp: null,
              status: transaction.block ? 'unknown' : 'pending',
              events: Object.freeze([]),
              feeUnits: null,
            });
          }
          const receipt = readReceipt(rawReceipt, expectedHash, owner, registration.chainId);
          // A transaction can become mined between the two parallel reads.
          if (!transaction.block) {
            rawTransaction = await read('eth_getTransactionByHash', [
              expectedHash,
            ]);
            if (rawTransaction === null) return fail('CONTEXT_CHANGED');
            transaction = readTransaction(rawTransaction, expectedHash);
          }
          assertPair(transaction, receipt);
          if (
            transaction.from !== owner &&
            transaction.to !== owner &&
            receipt.events.length === 0
          )
            return fail('IRRELEVANT');
          const included = await canonical(receipt.block);
          await checkChain();
          check();
          return Object.freeze({
            hash: expectedHash,
            from: transaction.from,
            to: transaction.to,
            valueUnits: transaction.valueUnits,
            nonce: transaction.nonce,
            timestamp: included.timestamp,
            block: Object.freeze({
              hash: included.hash,
              number: included.number,
            }),
            status: receipt.succeeded === null ? 'unknown' : receipt.succeeded ? 'confirmed' : 'reverted',
            events: receipt.events,
            feeUnits: receipt.feeUnits,
            ...(included.transactionIndex === undefined
              ? {}
              : { transactionIndex: included.transactionIndex }),
          });
        } catch (error) {
          check();
          if (error instanceof ActivityReceiptError) throw error;
          return fail('UNAVAILABLE');
        }
      }
    );
  }

  private async operation<T>(
    registration: NativeNetworkRegistration,
    external: AbortSignal,
    guard: () => void,
    work: (read: Read, check: () => void) => Promise<T>
  ): Promise<T> {
    registration = snapshotNativeNetwork(registration);
    const endpoint = registration.rpcUrl;
    guardCurrent(guard);
    if (external.aborted) return fail('CANCELLED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const check = () => {
      guardCurrent(guard);
      if (controller.signal.aborted) fail('CANCELLED');
    };
    const read: Read = async (method, params, signal) => {
      check();
      const requestController = signal ? new AbortController() : controller;
      const abortRequest = () => requestController.abort();
      if (signal) {
        controller.signal.addEventListener('abort', abortRequest, {
          once: true,
        });
        signal.addEventListener('abort', abortRequest, { once: true });
        if (signal.aborted || controller.signal.aborted) abortRequest();
      }
      try {
        if (requestController.signal.aborted) return fail('CANCELLED');
        const id = ++this.sequence;
        if (!Number.isSafeInteger(id)) return fail('UNAVAILABLE');
        const response = await cancellable(
          this.fetcher(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: requestController.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          }),
          requestController.signal
        );
        check();
        if (!response.ok) {
          cancelResponseBody(response);
          return fail('UNAVAILABLE');
        }
        const contentType = response.headers.get('content-type');
        if (
          contentType &&
          !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
            contentType
          )
        ) {
          cancelResponseBody(response);
          return fail('INVALID_RESPONSE');
        }
        const limit =
          method === 'eth_getBlockByNumber'
            ? MAX_BLOCK_BYTES
            : method === 'eth_getTransactionReceipt'
            ? MAX_RECEIPT_BYTES
            : method === 'eth_getTransactionByHash'
            ? MAX_TRANSACTION_BYTES
            : 16 * 1024;
        const text = await cancellable(
          boundedResponseText(response, requestController.signal, limit),
          requestController.signal
        );
        check();
        let body: Record<string, unknown>;
        try {
          body = object(JSON.parse(text));
        } catch {
          return fail('INVALID_RESPONSE');
        }
        if (
          body.jsonrpc !== '2.0' ||
          body.id !== id ||
          Object.hasOwn(body, 'error') ||
          !Object.hasOwn(body, 'result')
        )
          return fail('INVALID_RESPONSE');
        return body.result;
      } finally {
        if (signal) {
          controller.signal.removeEventListener('abort', abortRequest);
          signal.removeEventListener('abort', abortRequest);
        }
      }
    };
    try {
      return await work(read, check);
    } finally {
      clearTimeout(timer);
      controller.abort();
      external.removeEventListener('abort', abort);
    }
  }
}
