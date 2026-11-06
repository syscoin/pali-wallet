import { Transaction } from 'ethers/transaction';
import { EvmSignedRecords, type EvmSignedRecordSession, type EvmRetainedSignedRecord } from '../../../../source/wallet/evmSignedRecords.ts';
import { projectSavedEvmTransaction } from '../../../../source/wallet/evmSignedReplay.ts';
import { nativeAccountId, type NativeAccountType } from './accountIdentity.ts';
import { assertTransferIntentEnvelope, snapshotErc20TransferIntent, type Erc20TransferIntent } from './transferIntent.ts';
import { TransferJournalError, type TransferJournalEntry, type TransferJournalPhase } from './transferJournal.ts';
import type { NativeNetworkRegistration } from './networkContext.ts';
import { LOCAL_ACTIVITY_LIMIT, type LocalActivityRecord } from '../activity/types.ts';

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
  const map = (entry: EvmRetainedSignedRecord): TransferJournalEntry => {
    const tx = Transaction.from(entry.rawTransaction);
    const intent = entry.metadata?.intent === undefined ? undefined : snapshotErc20TransferIntent(entry.metadata.intent);
    if (intent) assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to ?? '', value: tx.value.toString(), data: tx.data }, intent);
    return Object.freeze({
    version: 1, scope, phase: entry.phase, rawTransaction: entry.rawTransaction, hash: entry.hash,
    nonce: entry.nonce, createdAt: entry.createdAt,
    ...(intent ? { intent } : {}),
  }); };
  return Object.freeze({
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
        const recent=await records.readRecent(session,network.chainId,account.address,LOCAL_ACTIVITY_LIMIT);
        const projected=recent.entries.map(entry => {
          const saved=projectSavedEvmTransaction(entry), token=saved.tokenTransfer?.token;
          const inspectionOnly = entry.operation === 'erc721' || entry.operation === 'erc1155';
          const speedUpEligible = (saved.operation === 'send' || saved.operation === 'erc20' || saved.operation === 'speed-up') &&
            saved.to !== null && (saved.type === 0 || saved.type === 2) &&
            (saved.dataBytes === 0 ? saved.value !== '0' : !!token) &&
            !Transaction.from(entry.rawTransaction).accessList?.length;
          return Object.freeze({walletFingerprint:walletBindingId,accountId:nativeAccountId(account.type,account.index),address:account.address,networkId:network.id,registrationHash:network.registrationHash,chainId:network.chainId,hash:entry.hash,phase:entry.phase,nonce:entry.nonce,createdAt:entry.createdAt,
            recipient:saved.tokenTransfer?.recipient??saved.to,amountUnits:token?saved.tokenTransfer!.amountUnits:saved.value,maximumFeeUnits:saved.maximumFee,...(token?{token}:{}),
            operation: saved.operation, transactionType: saved.type, ...(saved.originalHash ? { originalHash: saved.originalHash } : {}),
            ...(inspectionOnly ? { inspectionOnly: true as const } : {}),
            ...(speedUpEligible ? { speedUpEligible: true as const } : {}),
            ...(saved.collectibleTransfer ? { collectibleTransfer: saved.collectibleTransfer } : {})});
        });
        return Object.freeze({records:Object.freeze(projected),truncated:recent.total>projected.length});
      });
    },
  });
}
