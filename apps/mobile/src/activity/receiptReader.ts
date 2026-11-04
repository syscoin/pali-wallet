import { getAddress } from 'ethers/address';
import { boundedResponseText, parseRpcQuantity } from '../platformRpc.ts';
import { getNativeNetwork } from '../custody/networkContext.ts';
import { assertBaseUnits } from '../core/amounts.ts';

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
    | 'included'
    | 'finalized'
    | 'reverted'
    | 'finalized-reverted'
    | 'unknown';
  events: readonly ActivityTransferEvent[];
  feeUnits: string | null;
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
  | 'eth_getTransactionByHash'
  | 'eth_getTransactionReceipt'
  | 'eth_getBlockByNumber';
type Read = (method: Method, params: readonly unknown[]) => Promise<unknown>;
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
  succeeded: boolean;
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
  owner: string
): Receipt {
  const raw = object(value);
  if (hash(raw.transactionHash) !== expectedHash)
    return fail('INVALID_RESPONSE');
  const block = Object.freeze({
    hash: hash(raw.blockHash),
    number: quantity(raw.blockNumber).toString(),
    transactionIndex: quantity(raw.transactionIndex).toString(),
  });
  const status = quantity(raw.status);
  if (status !== 0n && status !== 1n) return fail('INVALID_RESPONSE');
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
  if (raw.gasUsed !== undefined && raw.effectiveGasPrice !== undefined) {
    feeUnits = (
      quantity(raw.gasUsed) * quantity(raw.effectiveGasPrice)
    ).toString();
    try {
      assertBaseUnits(feeUnits);
    } catch {
      return fail('INVALID_RESPONSE');
    }
  }
  const from = address(raw.from),
    to = raw.to === null ? null : address(raw.to);
  return Object.freeze({
    from,
    to,
    block,
    succeeded: status === 1n,
    events: Object.freeze(events),
    feeUnits,
    identity: JSON.stringify([
      from,
      to,
      block,
      status.toString(),
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

/** Indexed rows are hints; this adapter only returns bounded observations from the registered Ethereum RPC. */
export class ActivityReceiptReader {
  private readonly endpoint = getNativeNetwork('ethereum').rpcUrl;
  private readonly fetcher: (
    url: string,
    init: RequestInit
  ) => Promise<Response>;
  private readonly timeoutMs: number;
  private sequence = 0;
  constructor(
    options: {
      fetch?: (url: string, init: RequestInit) => Promise<Response>;
      timeoutMs?: number;
    } = {}
  ) {
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000
    )
      throw new Error('Invalid Activity timeout');
  }
  async read(
    inputHash: string,
    inputOwner: string,
    external: AbortSignal,
    guard: () => void
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
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    const check = () => {
      guardCurrent(guard);
      if (controller.signal.aborted) fail('CANCELLED');
    };
    const read: Read = async (method, params) => {
      check();
      const id = ++this.sequence;
      if (!Number.isSafeInteger(id)) return fail('UNAVAILABLE');
      const response = await cancellable(
        this.fetcher(this.endpoint, {
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
      check();
      if (!response.ok) return fail('UNAVAILABLE');
      const contentType = response.headers.get('content-type');
      if (
        contentType &&
        !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
          contentType
        )
      )
        return fail('INVALID_RESPONSE');
      const limit =
        method === 'eth_getBlockByNumber'
          ? MAX_BLOCK_BYTES
          : method === 'eth_getTransactionReceipt'
          ? MAX_RECEIPT_BYTES
          : method === 'eth_getTransactionByHash'
          ? MAX_TRANSACTION_BYTES
          : 16 * 1024;
      const text = await cancellable(
        boundedResponseText(response, controller.signal, limit),
        controller.signal
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
    };
    const checkChain = async () => {
      if (quantity(await read('eth_chainId', [])) !== 1n)
        fail('CONTEXT_CHANGED');
    };
    const canonical = async (block: Block | Receipt['block']) => {
      const observed = readBlock(
        await read('eth_getBlockByNumber', [tag(block.number), false])
      );
      if (observed.hash !== block.hash || observed.number !== block.number)
        fail('CONTEXT_CHANGED');
      return observed;
    };
    try {
      await checkChain();
      let [rawTransaction, rawReceipt] = await Promise.all([
        read('eth_getTransactionByHash', [expectedHash]),
        read('eth_getTransactionReceipt', [expectedHash]),
      ]);
      check();
      if (rawTransaction === null && rawReceipt !== null)
        rawTransaction = await read('eth_getTransactionByHash', [expectedHash]);
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
      const receipt = readReceipt(rawReceipt, expectedHash, owner);
      // A transaction can become mined between the two parallel reads.
      if (!transaction.block) {
        rawTransaction = await read('eth_getTransactionByHash', [expectedHash]);
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
      const finalized = readBlock(
        await read('eth_getBlockByNumber', ['finalized', false])
      );
      await canonical(finalized);
      const isFinalized =
        BigInt(receipt.block.number) <= BigInt(finalized.number);
      if (isFinalized) {
        rawReceipt = await read('eth_getTransactionReceipt', [expectedHash]);
        if (
          rawReceipt === null ||
          readReceipt(rawReceipt, expectedHash, owner).identity !==
            receipt.identity
        )
          return fail('CONTEXT_CHANGED');
        await canonical(receipt.block);
      }
      await checkChain();
      check();
      return Object.freeze({
        hash: expectedHash,
        from: transaction.from,
        to: transaction.to,
        valueUnits: transaction.valueUnits,
        nonce: transaction.nonce,
        timestamp: included.timestamp,
        block: Object.freeze({ hash: included.hash, number: included.number }),
        status: receipt.succeeded
          ? isFinalized
            ? 'finalized'
            : 'included'
          : isFinalized
          ? 'finalized-reverted'
          : 'reverted',
        events: receipt.events,
        feeUnits: receipt.feeUnits,
      });
    } catch (error) {
      check();
      if (error instanceof ActivityReceiptError) throw error;
      return fail('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      controller.abort();
      external.removeEventListener('abort', abort);
    }
  }
}
