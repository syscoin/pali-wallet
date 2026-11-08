import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import {
  createErc20Policy,
  decodeErc20Transfer,
  type Erc20Metadata,
} from '../shared/erc20.ts';
import {
  observeEvmTransaction,
  type EvmObservationMethod,
  type EvmTransactionObservation,
} from '../shared/evmTransactionObservation.ts';
import {
  decodeNftSafeTransferData,
  type NftTransferIntent,
} from '../shared/nftTransfer.ts';
import {
  ERC7579_MODE_SINGLE_DEFAULT,
  getSmartAccountUserOpRequiredPrefund,
  type SmartAccountPackedUserOperation,
} from '../utils/smartAccount/account.ts';
import {
  getPaliEntryPointAddress,
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from '../utils/smartAccount/contracts.ts';
import { decodeSmartAccountUserOperationEvent } from '../utils/smartAccount/userOperationEvent.ts';
import { getSmartAccountUserOpHash } from '../utils/smartAccount/userOperationHash.ts';

import type { EvmRetainedSignedRecord } from './evmSignedRecords.ts';

const tokenPolicy = createErc20Policy(getAddress);

export type SmartAccountActivityIdentity = Readonly<{
  operationHash: string;
  operationNonce: string;
  payer: string;
}>;

export type SmartAccountActivityObservation = SmartAccountActivityIdentity &
  Readonly<{
    account: string;
    chainId: string;
    hash: string;
    nonce: number;
  }>;

export type RetainedSmartAccountTransfer = Readonly<{
  account: string;
  amountUnits: string;
  collectibleTransfer?: NftTransferIntent;
  contractInteraction?: true;
  entry: EvmRetainedSignedRecord;
  maximumAccountCharge: string;
  operationHash: string;
  operationNonce: string;
  recipient: string;
  token?: Erc20Metadata;
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

export type RetainedSmartAccountOperation = Readonly<{
  account: string;
  chainId: string;
  hash: string;
  operationHash: string;
  operationNonce: string;
  payer: string;
  payerNonce: number;
}>;

/** Authenticate the outer envelope independently of the inner execution mode. */
export function decodeRetainedSmartAccountOperations(
  entry: EvmRetainedSignedRecord
): readonly RetainedSmartAccountOperation[] {
  try {
    const tx = Transaction.from(entry.rawTransaction);
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
      return [];
    const decoded = paliEntryPointInterface.decodeFunctionData(
      'handleOps',
      tx.data
    );
    if (
      !decoded[0].length ||
      paliEntryPointInterface
        .encodeFunctionData('handleOps', decoded)
        .toLowerCase() !== tx.data.toLowerCase()
    )
      return [];
    return Object.freeze(
      decoded[0].map((raw: SmartAccountPackedUserOperation) => {
        const operation = {
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
        return Object.freeze({
          chainId: entry.chainId,
          payer: entry.from,
          hash: entry.hash,
          payerNonce: entry.nonce,
          account: operation.sender,
          operationNonce: operation.nonce,
          operationHash: getSmartAccountUserOpHash(operation, chainId),
        });
      })
    );
  } catch {
    return [];
  }
}

/** Metadata only narrows candidates. Every displayed identity and amount comes from signed bytes. */
export function decodeRetainedSmartAccountTransfer(
  entry: EvmRetainedSignedRecord,
  address: string
): RetainedSmartAccountTransfer | null {
  if (!isSmartAccountActivityCandidate(entry, address)) return null;
  try {
    const account = getAddress(address),
      chainId = Number(entry.chainId);
    const identities = decodeRetainedSmartAccountOperations(entry);
    if (identities.length !== 1 || identities[0]!.account !== account)
      return null;
    const tx = Transaction.from(entry.rawTransaction);
    const raw = paliEntryPointInterface.decodeFunctionData(
      'handleOps',
      tx.data
    )[0][0];
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
    const [mode, calldata] = paliSmartAccountInterface.decodeFunctionData(
      'execute',
      operation.callData
    );
    if (
      mode !== ERC7579_MODE_SINGLE_DEFAULT ||
      typeof calldata !== 'string' ||
      calldata.length < 106
    )
      return null;
    if (
      paliSmartAccountInterface
        .encodeFunctionData('execute', [mode, calldata])
        .toLowerCase() !== operation.callData.toLowerCase()
    )
      return null;
    const executionTarget = getAddress('0x' + calldata.slice(2, 42));
    const nativeValue = BigInt('0x' + calldata.slice(42, 106));
    const data = '0x' + calldata.slice(106);
    let recipient = executionTarget,
      amountUnits = nativeValue.toString();
    let token: Erc20Metadata | undefined;
    let collectibleTransfer: NftTransferIntent | undefined;
    let contractInteraction = nativeValue === BigInt(0);
    if (data !== '0x') {
      const standard = entry.metadata?.smartAccountNftStandard;
      contractInteraction = true;
      if (
        nativeValue === BigInt(0) &&
        (standard === 'ERC-721' || standard === 'ERC-1155')
      ) {
        collectibleTransfer = decodeNftSafeTransferData(data, {
          chainId: entry.chainId,
          from: account,
          contractAddress: executionTarget,
          tokenStandard: standard,
        });
        if (!collectibleTransfer) return null;
        recipient = collectibleTransfer.recipient;
        amountUnits = collectibleTransfer.amountUnits;
        contractInteraction = false;
      } else if (
        nativeValue === BigInt(0) &&
        entry.metadata?.smartAccountToken !== undefined
      ) {
        const transfer = decodeErc20Transfer(data);
        token = tokenPolicy.parseMetadata(entry.metadata?.smartAccountToken);
        if (token.contractAddress !== executionTarget) return null;
        recipient = getAddress(transfer.recipient);
        amountUnits = transfer.amountUnits;
        contractInteraction = false;
      }
    }
    if (amountUnits === '0' && !contractInteraction) return null;
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
      ...(token ? { token } : {}),
      ...(collectibleTransfer ? { collectibleTransfer } : {}),
      ...(contractInteraction ? { contractInteraction: true as const } : {}),
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
