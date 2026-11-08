import { parseEvmFeeQuantity } from '@sidhujag/sysweb3-keyring/cjs/evm-fees.js';
import {
  readEvmOwnData,
  snapshotEvmAccessList,
  snapshotPreparedEvmTransaction,
  type EvmAccessList,
  type PreparedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

import {
  compareEvmDappFees,
  type EvmDappFeeComparison,
  selectEvmDappFees,
  selectEvmDappGasLimit,
} from './evmDappFeePolicy.ts';
import { evmEstimateRequest } from './evmEstimateRequest.ts';
import {
  assertEvmFeeEstimateApproved,
  captureEvmFeeApproval,
  EvmFeeBalanceError,
  EVM_FEE_APPROVAL_LIFETIME_MS,
  getEvmCoveredFee,
  resolveEvmFeeFunding,
  type EvmFeeFunding,
} from './evmFeeApproval.ts';
import { assertSynchronousEvmFeeGuard } from './evmFeeGuard.ts';
import {
  EvmObservationError,
  readEvmRpcHash,
  readEvmRpcQuantity,
} from './evmTransactionObservation.ts';

export type EvmDappTransactionRequest = Readonly<{
  accessList?: EvmAccessList;
  data: string;
  from: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  to: string | null;
  type?: 0 | 2;
  value: string;
}>;

export type EvmDappPreparedQuote = Readonly<{
  balanceUnits: string;
  coveredFeeUnits: string;
  expiresAtMonotonicMilliseconds: number;
  feeComparison: EvmDappFeeComparison;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  transaction: PreparedEvmTransaction;
}>;

export class EvmDappReviewRequiredError extends Error {
  constructor() {
    super('REVIEW_REQUIRED');
    this.name = 'EvmDappReviewRequiredError';
  }
}

export type EvmDappBlock = Readonly<{
  baseFee: bigint | null;
  gasLimit: bigint;
  hash: string;
  number: string;
}>;

export type EvmGasPolicy =
  | Readonly<{ kind: 'estimate' }>
  | Readonly<{ gasLimit: string; kind: 'fixed' }>;

type NonceSample = Readonly<{ nonce: bigint; state: 'latest' | 'pending' }>;
type FeeData = Readonly<{
  baseFeePerGas?: bigint;
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}>;

/** Transport, nonce ownership and reservations remain the host's existing adapters. */
export type EvmDappPreparationPorts<Sample extends NonceSample> = Readonly<{
  assertCurrent(): void;
  balance(block: EvmDappBlock, nonce: Promise<Sample>): Promise<bigint>;
  chainId: string;
  fees(block: EvmDappBlock): Promise<FeeData>;
  funding: EvmFeeFunding;
  gasPolicy: EvmGasPolicy;
  nonce(block: EvmDappBlock, requested: number | undefined): Promise<Sample>;
  now(): number;
  read(
    method: 'eth_getBlockByNumber' | 'eth_estimateGas',
    params: readonly unknown[]
  ): Promise<unknown>;
  scope: string;
  verifyBlock(block: EvmDappBlock): Promise<void>;
  verifyChain(): Promise<void>;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EvmObservationError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function readBlock(value: unknown): EvmDappBlock {
  const raw = record(value);
  return Object.freeze({
    baseFee:
      raw.baseFeePerGas === null || raw.baseFeePerGas === undefined
        ? null
        : readEvmRpcQuantity(raw.baseFeePerGas),
    gasLimit: readEvmRpcQuantity(raw.gasLimit),
    hash: readEvmRpcHash(raw.hash),
    number: readEvmRpcQuantity(raw.number).toString(),
  });
}

/** Snapshot the internal policy before any asynchronous quote work. */
export function captureEvmGasPolicy(value: EvmGasPolicy): EvmGasPolicy {
  const suppliedPolicy = value;
  const kind =
    suppliedPolicy &&
    Object.getOwnPropertyDescriptor(suppliedPolicy, 'kind')?.value;
  if (kind !== 'estimate' && kind !== 'fixed')
    throw new EvmDappReviewRequiredError();
  const policy = readEvmOwnData(
    suppliedPolicy,
    kind === 'fixed' ? ['kind', 'gasLimit'] : ['kind']
  );
  let gasPolicy: EvmGasPolicy;
  if (kind === 'fixed') {
    const gas = parseEvmFeeQuantity(policy.gasLimit, 'fixed gas limit');
    if (gas <= BigInt(0) || gas.toString() !== policy.gasLimit)
      throw new EvmDappReviewRequiredError();
    gasPolicy = Object.freeze({ kind, gasLimit: gas.toString() });
  } else gasPolicy = Object.freeze({ kind });
  return gasPolicy;
}

/** Initial quote and exact refresh use one fee, gas-bound and affordability policy. */
export async function prepareEvmDappQuote<Sample extends NonceSample>(
  input: EvmDappTransactionRequest,
  ports: EvmDappPreparationPorts<Sample>,
  approved?: EvmDappPreparedQuote
): Promise<EvmDappPreparedQuote> {
  const gasPolicy = captureEvmGasPolicy(ports.gasPolicy);
  ports = Object.freeze({
    ...ports,
    gasPolicy,
    assertCurrent: ports.assertCurrent.bind(ports),
    balance: ports.balance.bind(ports),
    fees: ports.fees.bind(ports),
    nonce: ports.nonce.bind(ports),
    now: ports.now.bind(ports),
    read: ports.read.bind(ports),
    verifyBlock: ports.verifyBlock.bind(ports),
    verifyChain: ports.verifyChain.bind(ports),
  });
  const request = Object.freeze({
    ...input,
    ...(input.accessList === undefined
      ? {}
      : { accessList: snapshotEvmAccessList(input.accessList) }),
  });
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  check();
  await ports.verifyChain();
  check();
  const sampled = readBlock(
    await ports.read('eth_getBlockByNumber', ['latest', false])
  );
  check();
  const pendingHeader = approved
    ? null
    : await ports.read('eth_getBlockByNumber', ['pending', false]);
  // Some generic RPCs expose pending state without a pending block header.
  // In that case the canonical header still supplies observed fee/gas bounds.
  const header = pendingHeader === null ? undefined : record(pendingHeader);
  check();
  const feeBase = header
    ? header.baseFeePerGas === null || header.baseFeePerGas === undefined
      ? null
      : readEvmRpcQuantity(header.baseFeePerGas)
    : sampled.baseFee;
  const feeGasLimit = header
    ? readEvmRpcQuantity(header.gasLimit)
    : sampled.gasLimit;
  const nonceState = ports.nonce(sampled, request.nonce);
  const [sample, balance, fees] = await Promise.all([
    nonceState,
    ports.balance(sampled, nonceState),
    ports.fees({ ...sampled, baseFee: feeBase }),
  ]);
  check();
  const selected = approved
    ? undefined
    : selectEvmDappFees(
        {
          type: request.type,
          hasAccessList: request.accessList !== undefined,
          ...(request.gasPrice === undefined
            ? {}
            : { gasPrice: BigInt(request.gasPrice) }),
          ...(request.maxFeePerGas === undefined
            ? {}
            : { maxFeePerGas: BigInt(request.maxFeePerGas) }),
          ...(request.maxPriorityFeePerGas === undefined
            ? {}
            : { maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas) }),
        },
        fees
      );
  const source = approved?.transaction ?? selected!;
  const selectedFees =
    source.type === 0
      ? { type: 0 as const, gasPrice: source.gasPrice.toString() }
      : {
          type: 2 as const,
          accessList:
            approved?.transaction.type === 2
              ? approved.transaction.accessList
              : request.accessList ?? [],
          maxFeePerGas: source.maxFeePerGas.toString(),
          maxPriorityFeePerGas: source.maxPriorityFeePerGas.toString(),
        };
  const execution = {
    from: request.from,
    to: request.to,
    value: request.value,
    data: request.data,
    chainId: ports.chainId,
    nonce: sample.nonce.toString(),
    ...selectedFees,
  };
  let executionGas: bigint;
  let gasLimit: string;
  if (ports.gasPolicy.kind === 'fixed') {
    executionGas = BigInt(ports.gasPolicy.gasLimit);
    gasLimit = executionGas.toString();
    if (
      request.gasLimit !== gasLimit ||
      (approved && approved.transaction.gasLimit !== gasLimit)
    )
      throw new EvmDappReviewRequiredError();
  } else {
    const estimateRequest = evmEstimateRequest(execution);
    executionGas = readEvmRpcQuantity(
      await ports.read('eth_estimateGas', [estimateRequest, sample.state])
    );
    check();
    gasLimit =
      approved?.transaction.gasLimit ??
      selectEvmDappGasLimit(
        executionGas,
        request.gasLimit === undefined ? undefined : BigInt(request.gasLimit),
        BigInt(ports.chainId),
        feeGasLimit
      ).toString();
  }
  const transaction = snapshotPreparedEvmTransaction({
    ...execution,
    gasLimit,
  });
  const now = ports.now();
  const expiry =
    approved?.expiresAtMonotonicMilliseconds ??
    now + EVM_FEE_APPROVAL_LIFETIME_MS;
  const approval = captureEvmFeeApproval(transaction, ports.scope, expiry);
  const coverage = await resolveEvmFeeFunding(ports.funding, approval, check);
  try {
    assertEvmFeeEstimateApproved(
      approval,
      {
        balance,
        estimatedGas: executionGas,
        sampledBlockGasLimit: feeGasLimit,
        ...(feeBase === null ? {} : { baseFeePerGas: feeBase }),
      },
      ports.now(),
      coverage
    );
  } catch (error) {
    if (error instanceof EvmFeeBalanceError) throw error;
    throw new EvmDappReviewRequiredError();
  }
  await ports.verifyBlock(sampled);
  check();
  await ports.verifyChain();
  check();
  const coveredFee = getEvmCoveredFee(approval, coverage);
  return Object.freeze({
    feeComparison: compareEvmDappFees(
      {
        type: request.type,
        ...(request.gasLimit === undefined
          ? {}
          : { gasLimit: BigInt(request.gasLimit) }),
        ...(request.gasPrice === undefined
          ? {}
          : { gasPrice: BigInt(request.gasPrice) }),
        ...(request.maxFeePerGas === undefined
          ? {}
          : { maxFeePerGas: BigInt(request.maxFeePerGas) }),
        ...(request.maxPriorityFeePerGas === undefined
          ? {}
          : { maxPriorityFeePerGas: BigInt(request.maxPriorityFeePerGas) }),
      },
      transaction.type === 0
        ? {
            type: 0,
            gasLimit: BigInt(transaction.gasLimit),
            gasPrice: BigInt(transaction.gasPrice),
          }
        : {
            type: 2,
            gasLimit: BigInt(transaction.gasLimit),
            maxFeePerGas: BigInt(transaction.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
          },
      executionGas,
      fees
    ),
    transaction,
    balanceUnits: balance.toString(),
    maximumFeeUnits: approval.maximumFeeUnits,
    maximumTotalUnits: (
      BigInt(approval.maximumTotalUnits) - coveredFee
    ).toString(),
    coveredFeeUnits: coveredFee.toString(),
    expiresAtMonotonicMilliseconds: expiry,
  });
}
