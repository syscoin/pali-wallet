import { Transaction } from 'ethers/transaction';
import { getAddress } from 'ethers/address';
import { EvmSignedRecords, type EvmSignedRecordSession, type EvmRetainedSignedRecord, type EvmRetainedSmartAccountRecord } from '../../../../source/wallet/evmSignedRecords.ts';
import { projectSavedEvmTransaction } from '../../../../source/wallet/evmSignedReplay.ts';
import { projectSmartAccountSavedTransaction } from '../../../../source/wallet/smartAccountSignedReplay.ts';
import { decodeRetainedNftTransfer, isRetainedNftReplayEnvelope } from '../../../../source/shared/nftTransfer.ts';
import type { EvmAutoNonceSnapshot } from '../../../../source/shared/evmAutoNonce.ts';
import type { NativeAutomaticNoncePlanner } from './evmTransferReadRpc.ts';
import { nativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { assertTransferIntentEnvelope, snapshotErc20TransferIntent, type Erc20TransferIntent } from './transferIntent.ts';
import { TransferJournalError, type TransferJournalEntry, type TransferJournalPhase } from './transferJournal.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import { LOCAL_ACTIVITY_LIMIT, type LocalActivityRecord } from '../activity/types.ts';

const maySpeedUp = (entry: EvmRetainedSignedRecord, type: number | null | undefined) =>
  entry.operation !== 'cancel' && (type === 0 || type === 2) &&
  !Object.hasOwn(entry.metadata ?? {}, 'privateDeposit') && !Object.hasOwn(entry.metadata ?? {}, 'privateWithdrawal');

/** Address aliases never substitute for the signer that owns retained bytes. */
export function findRetainedSignerAccount<T extends { type: NativeAccountType; index: number; slip44: number; address: string }>(
  accounts: readonly T[], entry: Pick<EvmRetainedSignedRecord, 'signer' | 'from'>
): T | undefined {
  return accounts.find(account => account.slip44 === 60 &&
    ['HDAccount', 'Imported', 'Ledger', 'Trezor'].includes(account.type) &&
    account.type === entry.signer.type && account.index === entry.signer.id &&
    account.address.toLowerCase() === entry.from.toLowerCase());
}

export function createNativeAutomaticNoncePlanner(
  records: EvmSignedRecords, session: EvmSignedRecordSession, chainId: string, from: string, endpoint: string,
  heldSnapshot?: EvmAutoNonceSnapshot
): NativeAutomaticNoncePlanner {
  return async (input) => {
    const assertCurrent = () => { session.assertCurrent(); input.assertCurrent(); };
    assertCurrent();
    const snapshot = heldSnapshot ?? await records.captureAutoNonceSnapshot({ keyring: session.keyring, assertCurrent }, chainId, from);
    assertCurrent();
    return records.autoNonceAcceptance.plan({ ...input, chainId, from, endpoint, snapshot, assertCurrent });
  };
}

/** Presentation adapter only. Canonical storage, ownership and retention are shared. */
export function createNativeSignedRecordView(
  records: EvmSignedRecords, session: EvmSignedRecordSession, walletBindingId: string,
  account: Readonly<{ index: number; type: NativeAccountType; address: string }>, network: NativeNetworkRegistration
) {
  const scope = Object.freeze({ walletFingerprint: walletBindingId, address: account.address, chainId: network.chainId });
  const checked = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch (error) { if (records.requiresReopen) throw new TransferJournalError('REOPEN_REQUIRED'); throw error; }
  };
  const planAutomaticNonce = createNativeAutomaticNoncePlanner(records, session, network.chainId, account.address, network.rpcUrl);
  const map = (entry: EvmRetainedSignedRecord): TransferJournalEntry => {
    const tx = Transaction.from(entry.rawTransaction);
    const collectible = decodeRetainedNftTransfer(entry, tx);
    const inspectionOnly = (entry.operation === 'erc721' || entry.operation === 'erc1155') &&
      (!collectible || !isRetainedNftReplayEnvelope(tx));
    const intent = entry.metadata?.intent === undefined ? undefined : snapshotErc20TransferIntent(entry.metadata.intent);
    if (intent) assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to ?? '', value: tx.value.toString(), data: tx.data }, intent);
    return Object.freeze({
    version: 1, scope, phase: entry.phase, rawTransaction: entry.rawTransaction, hash: entry.hash,
    nonce: entry.nonce, createdAt: entry.createdAt,
    ...(intent ? { intent } : {}),
    ...(collectible ? { collectible } : {}),
    ...(inspectionOnly ? { inspectionOnly: true as const } : {}),
  }); };
  const activity = (entry: EvmRetainedSignedRecord): LocalActivityRecord => {
    const saved=projectSavedEvmTransaction(entry), token=saved.tokenTransfer?.token;
    const inspectionOnly = (entry.operation === 'erc721' || entry.operation === 'erc1155') &&
      (!saved.collectibleTransfer || !isRetainedNftReplayEnvelope(Transaction.from(entry.rawTransaction)));
    const speedUpEligible = maySpeedUp(entry, saved.type);
    return Object.freeze({walletFingerprint:walletBindingId,accountId:nativeAccountId(account.type,account.index),address:account.address,networkId:network.id,registrationHash:network.registrationHash,chainId:network.chainId,hash:entry.hash,phase:entry.phase,nonce:entry.nonce,createdAt:entry.createdAt,
      recipient:saved.collectibleTransfer?.recipient??saved.tokenTransfer?.recipient??saved.to,amountUnits:token?saved.tokenTransfer!.amountUnits:saved.value,maximumFeeUnits:saved.maximumFee,...(token?{token}:{}),
      operation: saved.operation, transactionType: saved.type, ...(saved.originalHash ? { originalHash: saved.originalHash } : {}),
      ...(saved.value === '0' && saved.dataBytes > 0 && !saved.tokenTransfer && !saved.collectibleTransfer ? { contractInteraction: true as const } : {}),
      ...(inspectionOnly ? { inspectionOnly: true as const } : {}),
      ...(speedUpEligible ? { speedUpEligible: true as const } : {}),
      ...(saved.collectibleTransfer ? { collectibleTransfer: saved.collectibleTransfer } : {})});
  };
  const smartActivity = (record: EvmRetainedSmartAccountRecord): LocalActivityRecord => {
    const saved = projectSmartAccountSavedTransaction(record, account.address), smart = saved.smartAccount, transfer = smart.transfer;
    const single = smart.executions?.length === 1 ? smart.executions[0] : undefined;
    if (record.cancellation) return Object.freeze({ ...activity(record.entry), inspectionOnly: true,
      smartAccount: Object.freeze({ payer: record.cancellation.original.payer, operations: [Object.freeze({ operationHash: record.cancellation.original.operationHash, operationNonce: record.cancellation.original.operationNonce })], cancellation: true }) });
    return Object.freeze({
    walletFingerprint: walletBindingId, accountId: nativeAccountId(account.type, account.index),
    address: account.address, networkId: network.id, registrationHash: network.registrationHash,
    chainId: network.chainId, hash: saved.hash, nonce: saved.nonce,
    createdAt: saved.createdAt, recipient: transfer?.recipient ?? single?.target ?? account.address, amountUnits: transfer?.amountUnits ?? single?.value ?? '0',
    maximumFeeUnits: saved.maximumFee,
    ...(transfer?.token ? { token: transfer.token } : {}),
    ...(transfer?.collectibleTransfer ? { collectibleTransfer: transfer.collectibleTransfer } : {}),
    ...(!transfer || transfer.contractInteraction ? { contractInteraction: true as const } : {}),
    // The outer transaction's terminal status does not establish the UserOperation outcome.
    phase: 'submitted', ...(!smart.replayable ? { inspectionOnly: true as const } : {}),
    operation: saved.operation, transactionType: saved.type ?? undefined,
    ...(saved.originalHash ? { originalHash: saved.originalHash } : {}),
    ...(maySpeedUp(record.entry, saved.type) && !!transfer ? { speedUpEligible: true as const, reviewNavigation: Object.freeze({ speedUp: true }) } : {}),
    smartAccount: Object.freeze({ payer: getAddress(saved.from), operations: smart.operations }),
  }); };
  return Object.freeze({
    smartActivity(hash: string) {
      return checked(async () => {
        const record = await records.readSmartAccountReplayExact(session, network.chainId, account.address, hash);
        return record ? smartActivity(record) : null;
      });
    },
    planAutomaticNonce: (...args: Parameters<NativeAutomaticNoncePlanner>) => checked(() => planAutomaticNonce(...args)),
    assertSpendingNonce(nonce: number) {
      return checked(() => records.assertSpendingNonce(session, network.chainId, account.address, nonce));
    },
    async load(hash?: string) {
      return checked(async () => {
        const entry = hash === undefined
          ? await records.readCurrent(session, network.chainId, account.address)
          : await records.readExact(session, network.chainId, account.address, hash);
        return entry ? map(entry) : null;
      });
    },
    saveSigned(rawTransaction: string, intent?: Erc20TransferIntent) { return checked(async () => {
      const tx=Transaction.from(rawTransaction);
      if (tx.to === null) throw new TransferJournalError('CORRUPT');
      assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to, value: tx.value.toString(), data: tx.data }, intent);
      const entry=await records.append(session,{rawTransaction,hash:tx.hash!,from:tx.from!,chainId:tx.chainId.toString(),nonce:tx.nonce,type:tx.type,
        context:{account:{id:account.index,type:account.type,address:account.address},network:{kind:'ethereum',chainId:Number(network.chainId),slip44:60,url:network.rpcUrl},operation:intent?'erc20':'send'}},intent?{intent}:undefined);
      return map(entry);
    }); },
    transition(hash:string,phase:Exclude<TransferJournalPhase,'signed'>) { return checked(async () => {
      await records.updatePhase(session,network.chainId,account.address,hash,phase);
      const entry=await records.readExact(session,network.chainId,account.address,hash);
      if(!entry)throw new TransferJournalError('CORRUPT'); return map(entry);
    }); },
    async activities():Promise<Readonly<{records: readonly LocalActivityRecord[]; truncated: boolean}>> {
      return checked(async () => {
        if (account.type === 'SmartAccount') {
          const page = await records.readSmartAccountReplayPage(session, network.chainId, account.address, { maximum: LOCAL_ACTIVITY_LIMIT });
          return Object.freeze({ records: Object.freeze(page.entries.map(smartActivity)), truncated: page.nextCursor !== null });
        }
        const recent=await records.readRecent(session,network.chainId,account.address,LOCAL_ACTIVITY_LIMIT);
        const projected=recent.entries.map(activity);
        return Object.freeze({records:Object.freeze(projected),truncated:recent.total>projected.length});
      });
    },
    pendingActivities(beforeHash?: string) {
      return checked(async () => {
        if (account.type === 'SmartAccount') {
          const page = await records.readSmartAccountReplayPage(session, network.chainId, account.address,
            { beforeHash, maximum: 20 });
          return Object.freeze({ records: Object.freeze(page.entries.map(smartActivity)), nextCursor: page.nextCursor });
        }
        const page = await records.readPage(session, network.chainId, account.address,
          { beforeHash, maximum: 20, pendingOnly: true });
        return Object.freeze({ records: Object.freeze(page.entries.map(activity)), nextCursor: page.nextCursor });
      });
    },
  });
}
