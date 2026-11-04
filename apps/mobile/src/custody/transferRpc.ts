import { keccak256 } from 'ethers/crypto';
import { Transaction } from 'ethers/transaction';
import { normalizePublicAddress } from '../core/addresses.ts';
import { assertBaseUnits } from '../core/amounts.ts';
import {
  encodeErc20Transfer,
  parseErc20Decimals,
  parseErc20Units,
} from '../../../../source/shared/erc20.ts';
import {
  assertTransferIntentEnvelope,
  snapshotErc20TransferIntent,
  type Erc20TransferIntent,
} from './transferIntent.ts';
import { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { EvmTransferReadError, snapshotUnsignedTransfer } from './evmFeeContracts.ts';
import { getNativeNetwork, getNativeSendContext, nativeTransferGasLimit, erc20SigningEnabled, type EvmNetworkId } from './networkContext.ts';
import {
  boundedResponseText,
  parseRpcQuantity,
} from '../platformRpc.ts';

export type NativeTransferQuote = Readonly<{
  transaction: Readonly<{
    type: 2;
    from: string;
    to: string;
    chainId: string;
    nonce: string;
    value: string;
    gasLimit: string;
    data: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }>;
  balanceUnits: string;
  maximumFeeUnits: string;
  totalUnits: string;
  tokenBalanceUnits?: string;
  intent?: Erc20TransferIntent;
}>;
export type NativeTransferReceipt = Readonly<
  | {
      status: 'confirmed' | 'reverted';
      blockHash: string;
      blockNumber: string;
      finalized: boolean;
      terminalEligible?: boolean;
    }
  | { status: 'nonce-consumed'; finalized: boolean; terminalEligible?: boolean }
>;
export class NativeTransferRpcError extends Error {
  readonly code:
    | 'CANCELLED'
    | 'INVALID_RESPONSE'
    | 'UNAVAILABLE'
    | 'REVIEW_REQUIRED'
    | 'INSUFFICIENT_BALANCE'
    | 'INSUFFICIENT_TOKEN_BALANCE'
    | 'TOKEN_CHANGED'
    | 'TOKEN_TRANSFER_REJECTED';
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
  | 'eth_getBlockByNumber'
  | 'eth_getCode'
  | 'eth_call'
  | 'eth_feeHistory'
  | 'eth_maxPriorityFeePerGas'
  | 'eth_estimateGas'
  | 'eth_sendRawTransaction'
  | 'eth_getTransactionReceipt';
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
  readonly context;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private readonly receiptRpc: EvmTransferReadRpc;
  private sequence = 0;
  constructor(options: { networkId?: EvmNetworkId; fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.context = getNativeSendContext(options.networkId ?? 'ethereum');
    Object.defineProperty(this, 'context', { value: this.context, writable: false, configurable: false });
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 12000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000
    )
      throw new Error('Invalid transfer RPC timeout');
    this.receiptRpc = new EvmTransferReadRpc(this.context.networkId, {
      fetch: this.fetcher,
      timeoutMs: this.timeoutMs,
    });
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
      this.fetcher(this.context.rpcUrl, {
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
          method === 'eth_getBlockByNumber'
            ? 512 * 1024
            : method === 'eth_getCode'
            ? 64 * 1024 + 512
            : 16 * 1024
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
    if (parseRpcQuantity(await this.call('eth_chainId', [], signal)) !== BigInt(this.context.chainId))
      return invalid();
  }
  prepare(
    from: string,
    to: string,
    valueUnits: string,
    signal: AbortSignal
  ): Promise<NativeTransferQuote> {
    const sender = normalizePublicAddress(from, this.context.networkId);
    const recipient = normalizePublicAddress(to, this.context.networkId);
    const value = assertBaseUnits(valueUnits);
    if (value <= 0n || /^0x0{40}$/i.test(recipient))
      throw new NativeTransferRpcError('INVALID_RESPONSE');
    if (this.context.networkId === 'zksys-testnet')
      return this.prepareZkOs(sender, recipient, value, signal);
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
        estimate > nativeTransferGasLimit(this.context.networkId)
      )
        return invalid();
      const gas = estimate === 21000n ? estimate : (estimate * 12n + 9n) / 10n;
      const maxFee = nextBaseFee * 2n + tip;
      const maximumFee = gas * maxFee;
      const total = value + maximumFee;
      assertBaseUnits(maxFee.toString());
      assertBaseUnits(total.toString());
      if (gas > nativeTransferGasLimit(this.context.networkId)) return invalid();
      if (total > balance)
        throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
      await this.checkChain(local);
      return Object.freeze({
        transaction: Object.freeze({
          type: 2,
          from: sender,
          to: recipient,
          chainId: this.context.chainId,
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
  /** Recheck the exact approved fee envelope; a new tip can change zkOS gas requirements. */
  requote(transaction: NativeTransferQuote['transaction'], signal: AbortSignal): Promise<NativeTransferQuote> {
    if (this.context.networkId !== 'zksys-testnet') return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    let approved;
    try { approved = snapshotUnsignedTransfer(transaction as Parameters<typeof snapshotUnsignedTransfer>[0], getNativeNetwork(this.context.networkId)); }
    catch { return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE')); }
    return this.prepareZkOs(approved.from, approved.to, BigInt(approved.value), signal, approved);
  }
  private prepareZkOs(
    sender: string, recipient: string, value: bigint, signal: AbortSignal,
    approved?: NativeTransferQuote['transaction']
  ): Promise<NativeTransferQuote> {
    const quantity = (value: unknown): bigint => {
      try { return parseRpcQuantity(value); } catch { return invalid(); }
    };
    const validUnits = (value: bigint): void => {
      try { assertBaseUnits(value.toString()); } catch { return invalid(); }
    };
    return this.operation(signal, async (local) => {
      await this.checkChain(local);
      const sampled = object(await this.call('eth_getBlockByNumber', ['latest', false], local));
      const height = quantity(sampled.number);
      const sampledHash = checkedHash(sampled.hash);
      const sampledBaseFee = quantity(sampled.baseFeePerGas);
      const blockGasLimit = quantity(sampled.gasLimit);
      const [rawNonce, rawBalance, rawHistory, rawPriority] = await Promise.all([
        this.call('eth_getTransactionCount', [sender, 'pending'], local),
        this.call('eth_getBalance', [sender, 'pending'], local),
        this.call('eth_feeHistory', ['0x1', 'latest', []], local),
        this.call('eth_maxPriorityFeePerGas', [], local),
      ]);
      const nonce = quantity(rawNonce), balance = quantity(rawBalance);
      const history = object(rawHistory);
      if (!Array.isArray(history.baseFeePerGas) || history.baseFeePerGas.length !== 2 ||
          nonce > BigInt(Number.MAX_SAFE_INTEGER) || blockGasLimit < 21000n) return invalid();
      quantity(history.oldestBlock);
      quantity(history.baseFeePerGas[0]);
      const nextBaseFee = quantity(history.baseFeePerGas[1]);
      const selectedTip = quantity(rawPriority);
      const baseFee = sampledBaseFee > nextBaseFee ? sampledBaseFee : nextBaseFee;
      const tip = approved ? BigInt(approved.maxPriorityFeePerGas) : selectedTip;
      const maxFee = approved ? BigInt(approved.maxFeePerGas) : baseFee * 2n + tip;
      validUnits(maxFee);
      if (maxFee === 0n || tip > maxFee) return invalid();
      if (approved && (maxFee < baseFee || BigInt(approved.nonce) !== nonce))
        throw new NativeTransferRpcError('REVIEW_REQUIRED');
      if (maxFee < baseFee) return invalid();
      const hex = (number: bigint) => `0x${number.toString(16)}`;
      // Bind estimation to the fields that will actually be signed. RPC itself also
      // supports omitted fees; explicit fields avoid changing the native-resource budget.
      const rawGas = await this.call('eth_estimateGas', [{
        type: '0x2', chainId: hex(BigInt(this.context.chainId)), from: sender, to: recipient,
        nonce: hex(nonce), value: hex(value), data: '0x',
        maxFeePerGas: hex(maxFee), maxPriorityFeePerGas: hex(tip),
      }, 'pending'], local);
      const estimate = quantity(rawGas);
      if (estimate < 21000n || estimate > blockGasLimit || estimate > nativeTransferGasLimit(this.context.networkId)) return invalid();
      const gas = estimate === 21000n ? estimate : (estimate * 12n + 9n) / 10n;
      if (gas > blockGasLimit || gas > nativeTransferGasLimit(this.context.networkId)) return invalid();
      const maximumFee = gas * maxFee, total = value + maximumFee;
      validUnits(maximumFee); validUnits(total);
      if (total > balance) throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
      const repeated = object(await this.call('eth_getBlockByNumber', [hex(height), false], local));
      if (quantity(repeated.number) !== height || checkedHash(repeated.hash) !== sampledHash) return invalid();
      await this.checkChain(local);
      return Object.freeze({
        transaction: Object.freeze({ type: 2, from: sender, to: recipient, chainId: this.context.chainId,
          nonce: nonce.toString(), value: value.toString(), gasLimit: gas.toString(), data: '0x',
          maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: tip.toString() }),
        balanceUnits: balance.toString(), maximumFeeUnits: maximumFee.toString(), totalUnits: total.toString(),
      });
    });
  }
  prepareToken(
    from: string,
    input: Erc20TransferIntent,
    signal: AbortSignal
  ): Promise<NativeTransferQuote> {
    if (!erc20SigningEnabled(this.context.networkId)) return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
    const sender = normalizePublicAddress(from, 'ethereum');
    const intent = snapshotErc20TransferIntent(input);
    const data = encodeErc20Transfer(intent.recipient, intent.amountUnits);
    const call = Object.freeze({
      from: sender,
      to: intent.token.contractAddress,
      value: '0x0',
      data,
    });
    const word = (value: unknown): bigint => {
      if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value))
        return invalid();
      return BigInt(value);
    };
    const block = (value: unknown) => {
      const raw = object(value);
      return {
        number: `0x${parseRpcQuantity(raw.number).toString(16)}`,
        hash: checkedHash(raw.hash),
      };
    };
    return this.operation(signal, async (local) => {
      await this.checkChain(local);
      const observed = block(
        await this.call('eth_getBlockByNumber', ['latest', false], local)
      );
      const code = await this.call(
        'eth_getCode',
        [intent.token.contractAddress, observed.number],
        local
      );
      if (
        typeof code !== 'string' ||
        code.length > 65538 ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
      )
        return invalid();
      const [
        rawNonce,
        rawBalance,
        rawHistory,
        rawPriority,
        rawGas,
        rawDecimals,
        rawTokens,
        simulation,
      ] = await Promise.all([
        this.call('eth_getTransactionCount', [sender, 'pending'], local),
        this.call('eth_getBalance', [sender, 'pending'], local),
        this.call('eth_feeHistory', ['0x1', 'latest', []], local),
        this.call('eth_maxPriorityFeePerGas', [], local),
        this.call('eth_estimateGas', [call, observed.number], local),
        this.call(
          'eth_call',
          [
            { to: intent.token.contractAddress, data: '0x313ce567' },
            observed.number,
          ],
          local
        ),
        this.call(
          'eth_call',
          [
            {
              to: intent.token.contractAddress,
              data: `0x70a08231${sender
                .slice(2)
                .toLowerCase()
                .padStart(64, '0')}`,
            },
            observed.number,
          ],
          local
        ),
        this.call('eth_call', [call, observed.number], local),
      ]);
      // Some established tokens return no bytes on success. Explicit false and
      // every other malformed/noncanonical return remain rejected.
      if (simulation !== '0x' && word(simulation) !== 1n)
        throw new NativeTransferRpcError('TOKEN_TRANSFER_REJECTED');
      let decimals: number;
      try {
        decimals = parseErc20Decimals(word(rawDecimals));
      } catch {
        return invalid();
      }
      if (decimals !== intent.token.decimals)
        throw new NativeTransferRpcError('TOKEN_CHANGED');
      const tokenBalanceUnits = parseErc20Units(word(rawTokens));
      if (BigInt(tokenBalanceUnits) < BigInt(intent.amountUnits))
        throw new NativeTransferRpcError('INSUFFICIENT_TOKEN_BALANCE');
      const nonce = parseRpcQuantity(rawNonce),
        balance = parseRpcQuantity(rawBalance),
        history = object(rawHistory);
      if (
        !Array.isArray(history.baseFeePerGas) ||
        history.baseFeePerGas.length !== 2
      )
        return invalid();
      parseRpcQuantity(history.oldestBlock);
      parseRpcQuantity(history.baseFeePerGas[0]);
      const nextBaseFee = parseRpcQuantity(history.baseFeePerGas[1]),
        tip = parseRpcQuantity(rawPriority),
        estimate = parseRpcQuantity(rawGas);
      if (
        nonce > BigInt(Number.MAX_SAFE_INTEGER) ||
        estimate < 21000n ||
        estimate > nativeTransferGasLimit(this.context.networkId)
      )
        return invalid();
      const gas = estimate === 21000n ? estimate : (estimate * 12n + 9n) / 10n;
      const maxFee = nextBaseFee * 2n + tip,
        maximumFee = gas * maxFee;
      assertBaseUnits(maxFee.toString());
      assertBaseUnits(maximumFee.toString());
      if (gas > nativeTransferGasLimit(this.context.networkId)) return invalid();
      if (maximumFee > balance)
        throw new NativeTransferRpcError('INSUFFICIENT_BALANCE');
      const finalBlock = block(
        await this.call('eth_getBlockByNumber', [observed.number, false], local)
      );
      if (
        finalBlock.number !== observed.number ||
        finalBlock.hash !== observed.hash
      )
        return invalid();
      await this.checkChain(local);
      return Object.freeze({
        transaction: Object.freeze({
          type: 2 as const,
          from: sender,
          to: intent.token.contractAddress,
          chainId: '1' as const,
          nonce: nonce.toString(),
          value: '0',
          gasLimit: gas.toString(),
          data,
          maxFeePerGas: maxFee.toString(),
          maxPriorityFeePerGas: tip.toString(),
        }),
        balanceUnits: balance.toString(),
        maximumFeeUnits: maximumFee.toString(),
        totalUnits: maximumFee.toString(),
        tokenBalanceUnits,
        intent,
      });
    });
  }
  broadcast(
    rawTransaction: string,
    expectedHash: string,
    signal: AbortSignal,
    intent?: Erc20TransferIntent
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
        tx.chainId !== BigInt(this.context.chainId) ||
        (tx.type !== 0 && tx.type !== 2) ||
        !tx.to
      )
        return Promise.reject(new NativeTransferRpcError('INVALID_RESPONSE'));
      if (this.context.networkId === 'zksys-testnet' &&
          (tx.type !== 2 || tx.gasLimit < 21000n || tx.gasLimit > nativeTransferGasLimit(this.context.networkId))) return invalid();
      assertTransferIntentEnvelope(
        {
          chainId: tx.chainId.toString(),
          to: tx.to!,
          value: tx.value.toString(),
          data: tx.data,
        },
        intent
      );
      if (intent && !erc20SigningEnabled(this.context.networkId)) return invalid();
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
    return this.receiptRpc
      .receipt(expected, signal, () => undefined)
      .then((observation) => {
        if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (!observation) return null;
        if (observation.status === 'nonce-consumed') {
          if (!observation.settlement.terminalEligible) return invalid();
          return Object.freeze({
            status: 'nonce-consumed' as const,
            finalized: observation.settlement.kind === 'ethereum-finalized',
            ...(this.context.networkId === 'ethereum' ? {} : { terminalEligible: true }),
          });
        }
        return Object.freeze({
          status:
            observation.outcome === 'succeeded'
              ? ('confirmed' as const)
              : ('reverted' as const),
          blockHash: observation.block.hash,
          blockNumber: observation.block.number,
          finalized: observation.settlement.kind === 'ethereum-finalized' && observation.settlement.terminalEligible,
          ...(this.context.networkId === 'ethereum' ? {} : { terminalEligible: observation.settlement.terminalEligible }),
        });
      })
      .catch((error: unknown) => {
        // A read deadline is an unavailable observation, not user cancellation.
        // Only the caller's actual abort signal admits CANCELLED here.
        if (signal.aborted) throw new NativeTransferRpcError('CANCELLED');
        if (
          error instanceof EvmTransferReadError &&
          ['INVALID_INPUT', 'INVALID_RESPONSE', 'PROFILE_CHANGED'].includes(
            error.code
          )
        )
          throw new NativeTransferRpcError('INVALID_RESPONSE');
        if (error instanceof NativeTransferRpcError) throw error;
        throw new NativeTransferRpcError('UNAVAILABLE');
      });
  }
}
