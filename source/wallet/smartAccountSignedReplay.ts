import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

import {
  decodeAssetTransfer,
  type AssetTransferCall,
} from '../shared/assetTransfer.ts';
import { decodeSmartAccountExecutions } from '../shared/smartAccountExecutions.ts';
import { paliEntryPointInterface } from '../utils/smartAccount/contracts.ts';

import type { EvmRetainedSmartAccountRecord } from './evmSignedRecords.ts';
import {
  EvmReplayError,
  projectSavedEvmTransaction,
  type EvmSavedTransaction,
} from './evmSignedReplay.ts';
import {
  canSpeedUpSmartAccountOuter,
  decodeRetainedSmartAccountTransfer,
  type RetainedSmartAccountTransfer,
} from './smartAccountActivity.ts';
import {
  decodeSmartAccountCancellation,
  type SmartAccountCancellationRequest,
} from './smartAccountCancellation.ts';
import type { SmartAccountExecution } from '../utils/smartAccount/account.ts';

export type SmartAccountReplayIntent = Readonly<{
  account: string;
  callData: string;
  cancellation?: true;
  cancellationRetry?: Required<SmartAccountCancellationRequest>;
  executions?: readonly Readonly<
    SmartAccountExecution & { assetTransfer?: AssetTransferCall }
  >[];
  operationCount: number;
  operationHash: string;
  operationNonce: string;
  operations: readonly Pick<
    SmartAccountReplayIntent,
    'operationHash' | 'operationNonce'
  >[];
  pendingCancellationOf?: string;
  transfer?: Pick<
    RetainedSmartAccountTransfer,
    | 'recipient'
    | 'amountUnits'
    | 'token'
    | 'collectibleTransfer'
    | 'contractInteraction'
  >;
}>;
export type SmartAccountSavedTransaction = EvmSavedTransaction &
  Readonly<{
    smartAccount: SmartAccountReplayIntent;
  }>;
export function projectSmartAccountSavedTransaction(
  record: EvmRetainedSmartAccountRecord,
  address: string
): SmartAccountSavedTransaction {
  const account = getAddress(address),
    selected = record.operations.find(
      (operation) => operation.account === account
    );
  if (!selected) throw new EvmReplayError('NOT_FOUND');
  const revocation = decodeSmartAccountCancellation(record.entry);
  const isRevocation =
    revocation?.operationHash.toLowerCase() === selected.operationHash;
  const cancellation = Boolean(record.cancellation) || isRevocation;
  const decoded = record.cancellation
    ? undefined
    : paliEntryPointInterface.decodeFunctionData(
        'handleOps',
        Transaction.from(record.entry.rawTransaction).data
      )[0];
  const index = record.operations.indexOf(selected),
    callData = decoded ? String(decoded[index].callData) : '0x';
  const calls = decodeSmartAccountExecutions(callData)?.map((call) => {
    const assetTransfer = decodeAssetTransfer(call.data, call.target);
    return Object.freeze({
      ...call,
      ...(assetTransfer ? { assetTransfer } : {}),
    });
  });
  // Membership was proved above from handleOps bytes. Supply only that proven
  // hint to the existing transfer projection; optional asset metadata is unchanged.
  const transfer = cancellation
    ? null
    : decodeRetainedSmartAccountTransfer(
        {
          ...record.entry,
          metadata: {
            ...record.entry.metadata,
            smartAccountExecution: true,
            smartAccountExecutionFrom: account,
          },
        },
        account
      );
  const smartAccount: SmartAccountReplayIntent = Object.freeze({
    account,
    ...(cancellation ? { cancellation: true as const } : {}),
    ...(isRevocation
      ? {
          cancellationRetry: Object.freeze({
            originalHash: revocation.originalHash.toLowerCase(),
            operationHash: revocation.originalOperationHash.toLowerCase(),
          }),
        }
      : {}),
    ...(isRevocation &&
    ['signed', 'attempted', 'submitted'].includes(record.entry.phase)
      ? {
          pendingCancellationOf: revocation.originalOperationHash.toLowerCase(),
        }
      : {}),
    operationHash: selected.operationHash,
    operationNonce: selected.operationNonce,
    operationCount: record.operations.length,
    operations: Object.freeze(
      record.operations
        .filter((operation) => operation.account === account)
        .map((operation) =>
          Object.freeze({
            operationHash: operation.operationHash,
            operationNonce: operation.operationNonce,
          })
        )
    ),
    callData,
    ...(calls ? { executions: Object.freeze(calls) } : {}),
    ...(transfer
      ? {
          transfer: Object.freeze({
            recipient: transfer.recipient,
            amountUnits: transfer.amountUnits,
            ...(transfer.token ? { token: transfer.token } : {}),
            ...(transfer.collectibleTransfer
              ? { collectibleTransfer: transfer.collectibleTransfer }
              : {}),
            ...(transfer.contractInteraction
              ? { contractInteraction: true as const }
              : {}),
          }),
        }
      : {}),
  });
  return Object.freeze({
    ...projectSavedEvmTransaction(record.entry),
    ...(!cancellation && canSpeedUpSmartAccountOuter(record, address)
      ? { speedUpAvailable: true as const }
      : {}),
    smartAccount,
  });
}
