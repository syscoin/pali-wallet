import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../utils/smartAccount/contracts.ts';
import {
  ERC7579_MODE_SINGLE_DEFAULT,
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from '../utils/smartAccount/account.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';
import { decodeSmartAccountUserOperationEvent } from '../utils/smartAccount/userOperationEvent.ts';
import {
  observeEvmTransaction,
  type EvmObservationMethod,
  type EvmTransactionObservation,
} from '../shared/evmTransactionObservation.ts';
import type { EvmRetainedSignedRecord } from './evmSignedRecords.ts';

export type SmartAccountActivityIdentity = Readonly<{
  payer: string;
  operationHash: string;
  operationNonce: string;
}>;

export type SmartAccountActivityObservation = SmartAccountActivityIdentity &
  Readonly<{
    chainId: string;
    hash: string;
    nonce: number;
    account: string;
  }>;

export type RetainedSmartAccountTransfer = Readonly<{
  entry: EvmRetainedSignedRecord;
  account: string;
  recipient: string;
  amountUnits: string;
  maximumAccountCharge: string;
  operationHash: string;
  operationNonce: string;
}>;

export function isSmartAccountActivityCandidate(
  entry: Pick<EvmRetainedSignedRecord, 'metadata'>,
  address: string
): boolean {
  return (
    entry.metadata?.smartAccountExecution === true &&
    typeof entry.metadata.smartAccountExecutionFrom === 'string' &&
    entry.metadata.smartAccountExecutionFrom.toLowerCase() ===
      address.toLowerCase()
  );
}

/** Metadata only narrows candidates. Every displayed identity and amount comes from signed bytes. */
export function decodeRetainedSmartAccountTransfer(
  entry: EvmRetainedSignedRecord,
  address: string
): RetainedSmartAccountTransfer | null {
  if (!isSmartAccountActivityCandidate(entry, address)) return null;
  try {
    const account = getAddress(address),
      tx = Transaction.from(entry.rawTransaction);
    const chainId = Number(entry.chainId);
    if (
      !Number.isSafeInteger(chainId) ||
      !tx.isSigned() ||
      tx.hash !== entry.hash ||
      tx.nonce !== entry.nonce ||
      tx.from?.toLowerCase() !== entry.from.toLowerCase() ||
      tx.chainId.toString() !== entry.chainId ||
      tx.to !== getPaliEntryPointAddress(chainId) ||
      tx.value !== BigInt(0)
    )
      return null;
    const decoded = paliEntryPointInterface.decodeFunctionData(
      'handleOps',
      tx.data
    );
    if (
      decoded[0].length !== 1 ||
      paliEntryPointInterface
        .encodeFunctionData('handleOps', decoded)
        .toLowerCase() !== tx.data.toLowerCase()
    )
      return null;
    const raw = decoded[0][0];
    const operation: SmartAccountPackedUserOperation = {
      sender: getAddress(raw.sender),
      nonce: raw.nonce.toString(),
      initCode: raw.initCode,
      callData: raw.callData,
      accountGasLimits: raw.accountGasLimits,
      preVerificationGas: raw.preVerificationGas.toString(),
      gasFees: raw.gasFees,
      paymasterAndData: raw.paymasterAndData,
      signature: raw.signature,
    };
    if (operation.sender !== account) return null;
    const [mode, calldata] = paliSmartAccountInterface.decodeFunctionData(
      'execute',
      operation.callData
    );
    if (
      mode !== ERC7579_MODE_SINGLE_DEFAULT ||
      typeof calldata !== 'string' ||
      calldata.length !== 106
    )
      return null;
    if (
      paliSmartAccountInterface
        .encodeFunctionData('execute', [mode, calldata])
        .toLowerCase() !== operation.callData.toLowerCase()
    )
      return null;
    const recipient = getAddress('0x' + calldata.slice(2, 42));
    const amountUnits = BigInt('0x' + calldata.slice(42, 106)).toString();
    if (amountUnits === '0') return null;
    const operationHash = getSmartAccountUserOpHash(operation, chainId);
    if (
      entry.metadata?.smartAccountOperationHash !== undefined &&
      entry.metadata.smartAccountOperationHash !== operationHash
    )
      return null;
    return Object.freeze({
      entry,
      account,
      recipient,
      amountUnits,
      operationHash,
      operationNonce: operation.nonce,
      maximumAccountCharge:
        getSmartAccountUserOpRequiredPrefund(operation).toString(),
    });
  } catch {
    return null;
  }
}

/** Reuses canonical receipt observation and binds the inner outcome to this exact signed UserOperation. */
export async function observeSmartAccountActivity(
  transfer: SmartAccountActivityObservation,
  read: (
    method: EvmObservationMethod,
    params: readonly unknown[]
  ) => Promise<unknown>,
  assertCurrent: () => void
): Promise<EvmTransactionObservation> {
  transfer = Object.freeze({ ...transfer });
  if (
    !Number.isSafeInteger(Number(transfer.chainId)) ||
    Number(transfer.chainId) <= 0
  )
    throw new Error('Invalid Smart account chain');
  let receipt: unknown;
  const entryPoint = getPaliEntryPointAddress(Number(transfer.chainId));
  const observation = await observeEvmTransaction(
    {
      chainId: transfer.chainId,
      hash: transfer.hash,
      from: transfer.payer,
      to: entryPoint,
      nonce: String(transfer.nonce),
    },
    async (method, params) => {
      const value = await read(method, params);
      if (method === 'eth_getTransactionReceipt') receipt = value;
      return value;
    },
    assertCurrent
  );
  assertCurrent();
  if (observation.status !== 'mined' || observation.outcome === 'reverted')
    return observation;
  const logs =
    receipt && typeof receipt === 'object'
      ? (receipt as Record<string, unknown>).logs
      : undefined;
  if (!Array.isArray(logs) || logs.length > 512)
    throw new Error('Smart account outcome unavailable');
  const matches: boolean[] = [];
  for (const value of logs) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const log = value as Record<string, unknown>;
    try {
      if (
        typeof log.address !== 'string' ||
        getAddress(log.address) !== entryPoint ||
        log.removed === true ||
        typeof log.transactionHash !== 'string' ||
        log.transactionHash.toLowerCase() !== transfer.hash ||
        typeof log.blockHash !== 'string' ||
        log.blockHash.toLowerCase() !== observation.block.hash ||
        typeof log.blockNumber !== 'string' ||
        !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(log.blockNumber) ||
        BigInt(log.blockNumber).toString() !== observation.block.number
      )
        continue;
      const event = decodeSmartAccountUserOperationEvent({
        topics: log.topics as string[],
        data: log.data as string,
      });
      if (
        event.sender === transfer.account &&
        event.operationHash === transfer.operationHash &&
        event.nonce === transfer.operationNonce
      )
        matches.push(event.success);
    } catch {
      /* Unrelated or malformed logs do not establish this operation's outcome. */
    }
  }
  if (matches.length !== 1)
    throw new Error('Smart account outcome unavailable');
  return Object.freeze({
    ...observation,
    outcome: matches[0] ? 'confirmed' : 'reverted',
  });
}
