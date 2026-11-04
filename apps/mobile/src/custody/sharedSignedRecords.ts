import { Transaction } from 'ethers/transaction';
import { EvmSignedRecords, type EvmSignedRecordSession, type EvmRetainedSignedRecord } from '../../../../source/wallet/evmSignedRecords.ts';
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
    if (tx.to === null) throw new TransferJournalError('CORRUPT');
    const intent = entry.metadata?.intent === undefined ? undefined : snapshotErc20TransferIntent(entry.metadata.intent);
    assertTransferIntentEnvelope({ chainId: tx.chainId.toString(), to: tx.to, value: tx.value.toString(), data: tx.data }, intent);
    return Object.freeze({
    version: 1, scope, phase: entry.phase, rawTransaction: entry.rawTransaction, hash: entry.hash,
    nonce: entry.nonce, createdAt: entry.createdAt,
    ...(intent ? { intent } : {}),
  }); };
  const latest = () => checked(async () => {
    const values = await records.listSender(session, network.chainId, account.address);
    const chosen = [...values].sort((a,b) => b.createdAt-a.createdAt || b.nonce-a.nonce || a.hash.localeCompare(b.hash))[0];
    return chosen ? records.readExact(session,network.chainId,account.address,chosen.hash) : null;
  });
  return Object.freeze({
    async load() { const entry=await latest(); return entry ? map(entry) : null; },
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
          const tx=Transaction.from(entry.rawTransaction), fee=tx.maxFeePerGas??tx.gasPrice;
          if(fee===null)throw new TransferJournalError('CORRUPT');
          const intent=entry.metadata?.intent===undefined?undefined:snapshotErc20TransferIntent(entry.metadata.intent);
          if(intent)assertTransferIntentEnvelope({chainId:tx.chainId.toString(),to:tx.to??'',value:tx.value.toString(),data:tx.data},intent);
          return Object.freeze({walletFingerprint:walletBindingId,accountId:nativeAccountId(account.type,account.index),address:account.address,networkId:network.id,registrationHash:network.registrationHash,chainId:network.chainId,hash:entry.hash,phase:entry.phase,nonce:entry.nonce,createdAt:entry.createdAt,
            recipient:intent?.recipient??tx.to,amountUnits:intent?.amountUnits??tx.value.toString(),maximumFeeUnits:(tx.gasLimit*fee).toString(),...(intent?{token:intent.token}:{})});
        });
        return Object.freeze({records:Object.freeze(projected),truncated:recent.total>projected.length});
      });
    },
  });
}
