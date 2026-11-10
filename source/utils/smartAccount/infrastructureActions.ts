import type {
  PaliInfrastructureContract,
  PaliInfrastructureContractId,
} from './deployment.ts';
import { PALI_CREATE2_DEPLOYER_ADDRESS } from './deploymentMetadata.ts';
import type {
  InfrastructureJournalEntry,
  InfrastructureNetworkContext,
} from '../../wallet/infrastructureJournal.ts';

export type InfrastructureReceipt = Readonly<{
  hash?: string;
  status: 0 | 1 | '0x0' | '0x1';
  transactionHash?: string;
}>;

/** A mined success or failure settles an attempt only for its exact transaction. */
export function validInfrastructureReceipt(
  receipt: unknown,
  hash: string
): receipt is InfrastructureReceipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const value = receipt as Record<string, unknown>;
  const receiptHash = value.hash || value.transactionHash;
  return (
    [0, 1, '0x0', '0x1'].includes(value.status as number | string) &&
    typeof receiptHash === 'string' &&
    receiptHash.toLowerCase() === hash.toLowerCase()
  );
}

export type InfrastructureSettlementPorts = Readonly<{
  readLatestNonce(address: string): Promise<unknown>;
  /** The host owns deadlines and current-context checks around these reads. */
  readReceipt(hash: string): Promise<unknown>;
}>;

export type InfrastructureSettlementRequest = Readonly<{
  context: Readonly<Pick<InfrastructureNetworkContext, 'url'>>;
  entry: Readonly<InfrastructureJournalEntry>;
  ports: InfrastructureSettlementPorts;
  /** The caller verifies the entry against its captured contract catalogue. */
  status: Readonly<{ missing: readonly PaliInfrastructureContractId[] }>;
}>;

/** Reconcile one captured attempt. Admission, catalogue policy and journal CAS stay with the host. */
export async function settleInfrastructurePending({
  context,
  entry,
  ports,
  status,
}: InfrastructureSettlementRequest): Promise<'settled' | 'pending'> {
  if (
    typeof ports?.readReceipt !== 'function' ||
    typeof ports.readLatestNonce !== 'function'
  )
    throw new Error('Infrastructure settlement ports are required');
  // A chain ID cannot establish a legacy attempt's RPC or identify an alias/fork.
  if (entry.rpcUrl === undefined || entry.rpcUrl !== context.url)
    return 'pending';
  let settled = !status.missing.includes(entry.contractId);
  if (!settled && entry.transactionHash) {
    const receipt = await ports.readReceipt(entry.transactionHash);
    if (receipt && !validInfrastructureReceipt(receipt, entry.transactionHash))
      throw new Error(
        'Invalid deployment receipt. Refresh status before retrying.'
      );
    settled = Boolean(receipt);
  }
  if (!settled && entry.payerAddress && entry.nonce !== undefined) {
    const latestNonce = await ports.readLatestNonce(entry.payerAddress);
    if (
      typeof latestNonce !== 'string' ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(latestNonce) ||
      !Number.isSafeInteger(Number(latestNonce))
    )
      throw new Error('Invalid deployment nonce response');
    settled = Number(latestNonce) > entry.nonce;
  }
  return settled ? 'settled' : 'pending';
}

export type InfrastructureDeploymentCommand = Readonly<{
  chainId: number;
  data: string;
  from: string;
  nonce?: number;
  to: string;
  value: '0x0';
}>;

/** The host supplies the actual catalogue contract, loading deployment bytecode only when needed. */
export function buildInfrastructureDeploymentCommand({
  contract,
  chainId,
  from,
  nonce,
}: Readonly<{
  chainId: number;
  contract: Readonly<PaliInfrastructureContract>;
  from: string;
  /** null explicitly delegates nonce selection to the existing transaction planner. */
  nonce: number | null;
}>): InfrastructureDeploymentCommand {
  if (contract.externallyDeployed || !contract.deployCalldata)
    throw new Error(
      `${contract.displayName} must be deployed externally before Pali smart account infrastructure can be deployed.`
    );
  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    typeof from !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(from) ||
    (nonce !== null && (!Number.isSafeInteger(nonce) || nonce < 0)) ||
    typeof contract.deployCalldata !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(contract.deployCalldata)
  )
    throw new Error('Invalid infrastructure deployment command');
  return Object.freeze({
    chainId,
    from,
    ...(nonce === null ? {} : { nonce }),
    data: contract.deployCalldata,
    to: PALI_CREATE2_DEPLOYER_ADDRESS,
    value: '0x0',
  });
}
