import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { normalizePublicAddress } from '../core/addresses.ts';
import { assertBaseUnits } from '../core/amounts.ts';
import {
  boundedResponseText,
  parseRpcQuantity,
  RPC_ENDPOINTS,
  ResponseSizeLimitError,
} from '../platformRpc.ts';

export type NativeTransferQuote = Readonly<{
  transaction: Readonly<{
    type: 2;
    from: string;
    to: string;
    chainId: '1';
    nonce: string;
    value: string;
    gasLimit: string;
    data: '0x';
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }>;
  balanceUnits: string;
  maximumFeeUnits: string;
  totalUnits: string;
}>;
export type NativeTransferReceipt = Readonly<
  | {
      status: 'confirmed' | 'reverted';
      blockHash: string;
      blockNumber: string;
      finalized: boolean;
    }
  | { status: 'nonce-consumed'; finalized: true }
>;
export class NativeTransferRpcError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'INSUFFICIENT_BALANCE';
  constructor(code: NativeTransferRpcError['code']) {
    super(code);
    this.name = 'NativeTransferRpcError';
    this.code = code;
  }
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Method =
  | 'eth_chainId'
  | 'eth_getTransactionCount'
  | 'eth_getBalance'
  | 'eth_feeHistory'
  | 'eth_maxPriorityFeePerGas'
  | 'eth_estimateGas'
  | 'eth_sendRawTransaction'
  | 'eth_getTransactionReceipt'
  | 'eth_getBlockByNumber';
const invalid = (): never => {
  throw new NativeTransferRpcError('INVALID_RESPONSE');
};
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
function checkedHash(value: unknown): string {
  if (typeof value !== 'string' || !hashPattern.test(value)) return invalid();
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted)
    return Promise.reject(new NativeTransferRpcError('CANCELLED'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new NativeTransferRpcError('CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Only the native transfer authority receives this network capability. */
export class NativeTransferRpc {
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private sequence = 0;
  constructor(options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000
    )
      throw new Error('Invalid transfer RPC timeout');
  }
  private async operation<T>(
    external: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (external.aborted) throw new NativeTransferRpcError('CANCELLED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    external.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      const result = await abortable(
        work(controller.signal),
        controller.signal
      );
      if (controller.signal.aborted)
        throw new NativeTransferRpcError('CANCELLED');
      return result;
    } catch (error) {
      if (controller.signal.aborted)
        throw new NativeTransferRpcError('CANCELLED');
      if (error instanceof NativeTransferRpcError) throw error;
      throw new NativeTransferRpcError('UNAVAILABLE');
    } finally {
      controller.abort();
      clearTimeout(timer);
      external.removeEventListener('abort', abort);
    }
  }
  private async call(
    method: Method,
    params: readonly unknown[],
    signal: AbortSignal
  ): Promise<unknown> {
    if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
    const id = ++this.sequence;
    if (!Number.isSafeInteger(id)) return invalid();
    const response = await abortable(
      this.fetcher(RPC_ENDPOINTS.ethereum!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
      signal
    );
    if (!response.ok) throw new NativeTransferRpcError('UNAVAILABLE');
    const contentType = response.headers.get('content-type');
    if (
      contentType &&
      !/^(application\/json|application\/[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
        contentType
      )
    )
      return invalid();
    const body = object(
      JSON.parse(
        await boundedResponseText(
          response,
          signal,
          method === 'eth_getBlockByNumber' ? 512 * 1024 : undefined
        )
      )
    );
    if (
      body.jsonrpc !== '2.0' ||
      body.id !== id ||
      Object.prototype.hasOwnProperty.call(body, 'error') ||
      !Object.prototype.hasOwnProperty.call(body, 'result')
    )
      return invalid();
    return body.result;
  }
  private async checkChain(signal: AbortSignal): Promise<void> {
    if (parseRpcQuantity(await this.call('eth_chainId', [], signal)) !== 1n)
      return invalid();
  }
  /** A receipt too large to inspect proves no outcome, even after inclusion. */
  private async consumedAfterOversizedReceipt(
    from: string,
    nonce: bigint,
    signal: AbortSignal
  ): Promise<NativeTransferReceipt> {
    const finalized = object(
      await this.call('eth_getBlockByNumber', ['finalized', false], signal)
    );
    const number = parseRpcQuantity(finalized.number);
    const hash = checkedHash(finalized.hash);
    const tag = '0x' + number.toString(16);
    const finalizedNonce = parseRpcQuantity(
      await this.call('eth_getTransactionCount', [from, tag], signal)
    );
    const canonical = object(
      await this.call('eth_getBlockByNumber', [tag, false], signal)
    );
    if (
      parseRpcQuantity(canonical.number) !== number ||
      checkedHash(canonical.hash) !== hash
    )
      return invalid();
    await this.checkChain(signal);
    if (finalizedNonce <= nonce)
      throw new NativeTransferRpcError('UNAVAILABLE');
    return Object.freeze({ status: 'nonce-consumed', finalized: true });
  }
  prepare(
    from: string,
    to: string,
    valueUnits: string,
    signal: AbortSignal
  ): Promise<NativeTransferQuote> {
    const sender = normalizePublicAddress(from, 'ethereum');
    const recipient = normalizePublicAddress(to, 'ethereum');
    const value = assertBaseUnits(valueUnits);
    if (value <= 0n || /^0x0{40}$/i.test(recipient))
      throw new NativeTransferRpcError('INVALID_RESPONSE');
    return this.operation(signal, async (local) => {
      // Check chain before disclosing an address, then again before admitting the quote.
      await this.checkChain(local);
      const [rawNonce, rawBalance, rawHistory, rawPriority, rawGas] =
        await Promise.all([
          this.call('eth_getTransactionCount', [sender, 'pending'], local),
          this.call('eth_getBalance', [sender, 'pending'], local),
          this.call('eth_feeHistory', ['0x1', 'latest', []], local),
          this.call('eth_maxPriorityFeePerGas', [], local),
          this.call(
            'eth_estimateGas',
            [
              {
                from: sender,
                to: recipient,
                value: '0x' + value.toString(16),
                data: '0x',
              },
            ],
            local
          ),
        ]);
      const nonce = parseRpcQuantity(rawNonce);
      const balance = parseRpcQuantity(rawBalance);
      const history = object(rawHistory);
      if (
        !Array.isArray(history.baseFeePerGas) ||
        history.baseFeePerGas.length !== 2
      )
        return invalid();
      parseRpcQuantity(history.oldestBlock);
      parseRpcQuantity(history.baseFeePerGas[0]);
      const nextBaseFee = parseRpcQuantity(history.baseFeePerGas[1]);
      const tip = parseRpcQuantity(rawPriority);
      const estimate = parseRpcQuantity(rawGas);
      if (
        nonce > BigInt(Number.MAX_SAFE_INTEGER) ||
        estimate < 21000n ||
        estimate > 30000000n
      )
        return invalid();
      const gas = estimate === 21000n ? estimate : (estimate * 12n + 9n) / 10n;
      const maxFee = nextBaseFee * 2n + tip;
      const maximumFee = gas * maxFee;
      const total = value + maximumFee;
      assertBaseUnits(maxFee.toString());
      assertBaseUnits(total.toString());
      if (gas > 30000000n) return invalid();
      if (total > balance)
        throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
      await this.checkChain(local);
      return Object.freeze({
        transaction: Object.freeze({
          type: 2,
          from: sender,
          to: recipient,
          chainId: '1',
          nonce: nonce.toString(),
          value: value.toString(),
          gasLimit: gas.toString(),
          data: '0x',
          maxFeePerGas: maxFee.toString(),
          maxPriorityFeePerGas: tip.toString(),
        }),
        balanceUnits: balance.toString(),
        maximumFeeUnits: maximumFee.toString(),
        totalUnits: total.toString(),
      });
    });
  }
  broadcast(
    rawTransaction: string,
    expectedHash: string,
    signal: AbortSignal
  ): Promise<string> {
    const hash = checkedHash(expectedHash);
    if (
      typeof rawTransaction !== 'string' ||
      rawTransaction.length > 4096 ||
      !/^0x(?:[0-9a-f]{2})+$/.test(rawTransaction) ||
      keccak256(rawTransaction) !== hash
    )
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    try {
      const tx = Transaction.from(rawTransaction);
      if (
        !tx.isSigned() ||
        tx.chainId !== 1n ||
        (tx.type !== 0 && tx.type !== 2) ||
        tx.data !== '0x'
      )
        return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    } catch {
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    }
    return this.operation(signal, async (local) => {
      await this.checkChain(local);
      // No automatic retry: the remote side may accept before a response is lost.
      const returned = checkedHash(
        await this.call('eth_sendRawTransaction', [rawTransaction], local)
      );
      if (returned !== hash) return invalid();
      return hash;
    });
  }
  receipt(
    expected: Readonly<{
      hash: string;
      from: string;
      to: string;
      nonce: string;
    }>,
    signal: AbortSignal
  ): Promise<NativeTransferReceipt | null> {
    const hash = checkedHash(expected.hash);
    const from = normalizePublicAddress(expected.from, 'ethereum');
    const to = normalizePublicAddress(expected.to, 'ethereum');
    const nonce = assertBaseUnits(expected.nonce);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER))
      return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    return this.operation(signal, async (local) => {
      await this.checkChain(local);
      let result: unknown;
      try {
        result = await this.call('eth_getTransactionReceipt', [hash], local);
      } catch (error) {
        if (!(error instanceof ResponseSizeLimitError)) throw error;
        return this.consumedAfterOversizedReceipt(from, nonce, local);
      }
      if (result === null) {
        const finalizedNonce = parseRpcQuantity(
          await this.call('eth_getTransactionCount', [from, 'finalized'], local)
        );
        await this.checkChain(local);
        return finalizedNonce > nonce
          ? Object.freeze({
              status: 'nonce-consumed' as const,
              finalized: true as const,
            })
          : null;
      }
      const data = object(result);
      if (
        checkedHash(data.transactionHash) !== hash ||
        normalizePublicAddress(data.from as string, 'ethereum') !== from ||
        normalizePublicAddress(data.to as string, 'ethereum') !== to
      )
        return invalid();
      const status = parseRpcQuantity(data.status);
      if (status !== 0n && status !== 1n) return invalid();
      const blockHash = checkedHash(data.blockHash);
      const blockNumber = parseRpcQuantity(data.blockNumber).toString();
      // Inclusion and finality are distinct. A nonce consumed in finalized state
      // plus a still-canonical receipt lets the host release its pending journal.
      const finalizedNonce = parseRpcQuantity(
        await this.call('eth_getTransactionCount', [from, 'finalized'], local)
      );
      if (finalizedNonce > nonce) {
        let repeated: Record<string, unknown>;
        try {
          repeated = object(
            await this.call('eth_getTransactionReceipt', [hash], local)
          );
        } catch (error) {
          if (!(error instanceof ResponseSizeLimitError)) throw error;
          return this.consumedAfterOversizedReceipt(from, nonce, local);
        }
        if (
          checkedHash(repeated.transactionHash) !== hash ||
          checkedHash(repeated.blockHash) !== blockHash ||
          parseRpcQuantity(repeated.status) !== status
        )
          return invalid();
      }
      await this.checkChain(local);
      return Object.freeze({
        status: status === 1n ? 'confirmed' : 'reverted',
        blockHash,
        blockNumber,
        finalized: finalizedNonce > nonce,
      });
    });
  }
}
