import type { NativeTransferRuntime } from '../src/custody/transfers.ts';

/** Qualification uses the same one-use consent receipt and operation-scoped credential as the send controller. */
export async function signQualificationTransfer(
  runtime: NativeTransferRuntime,
  transaction: Parameters<NativeTransferRuntime['sign']>[0],
  authority: Omit<Parameters<NativeTransferRuntime['sign']>[1], 'authorization'>
) {
  const authorization = await runtime.authorizeOperation({ method: 'device' }, transaction, authority.assertCurrent);
  try { return await runtime.sign(transaction, { ...authority, authorization }); }
  finally { runtime.releaseOperationAuthorization(authorization); }
}

/** Inspect the authenticated journal view while keeping signatures out of qualification reports. */
export async function inspectQualificationEoaEnvelope(
  runtime: NativeTransferRuntime,
  saved: Pick<import('../src/custody/transferJournal.ts').TransferJournalEntry, 'hash' | 'rawTransaction' | 'inspectionOnly'>,
  address: string,
  assertCurrent: () => void
) {
  const { Transaction } = await import('ethers/transaction');
  const raw = saved.rawTransaction;
  if (raw) {
    const transaction = Transaction.from(raw);
    assertCurrent();
    if (!transaction.isSigned() || transaction.from !== address ||
        transaction.hash !== saved.hash || transaction.serialized !== raw)
      throw Error('QUALIFICATION_EOA_ENVELOPE_MISMATCH');
    return transaction;
  }
  if (!saved.inspectionOnly || !runtime.replacementOriginal)
    throw Error('QUALIFICATION_EOA_INTENT_UNAVAILABLE');
  try {
    const retained = await runtime.replacementOriginal(saved.hash, 'speed-up', assertCurrent, new AbortController().signal);
    assertCurrent();
    if (!retained?.unsignedTransaction || retained.rawTransaction !== undefined || retained.from !== address)
      throw Error('QUALIFICATION_EOA_INTENT_UNAVAILABLE');
    const transaction = Transaction.from(retained.unsignedTransaction);
    if (transaction.isSigned() || transaction.unsignedSerialized !== retained.unsignedTransaction)
      throw Error('QUALIFICATION_EOA_ENVELOPE_MISMATCH');
    return transaction;
  } finally {
    runtime.releaseReplacement();
  }
}
