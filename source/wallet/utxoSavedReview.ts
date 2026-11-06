import { utils as syscoinUtils } from 'syscoinjs-lib';

import { supportsSptUtxoChain } from '../shared/sptInventory.ts';
import {
  ALLOCATION_SEND_VERSION,
  getExactAssetAllocations,
} from '../utils/syscoinPsbtValues.ts';

import type { UtxoDurableSubmission } from './utxoSignedRecords.ts';
import type { Transaction } from 'bitcoinjs-lib';

type AssetOutput = Readonly<{ assetGuid: string; rawAmount: string }>;
export type SavedUtxoReviewOutput = Readonly<{
  amountSatoshis: string;
  asset?: AssetOutput;
}> &
  (
    | Readonly<{ address: string; script?: never }>
    | Readonly<{
        address?: never;
        script: Readonly<{ hex: string; kind: 'data' | 'script' }>;
      }>
  );

/** Project outputs from an authenticated retained record without reclassifying change. */
export function reviewSavedUtxoOutputs(
  record: UtxoDurableSubmission,
  addressNetwork: NonNullable<
    Parameters<typeof syscoinUtils.bitcoinjs.address.fromOutputScript>[1]
  >
): SavedUtxoReviewOutput[] {
  const { bitcoinjs } = syscoinUtils;
  const transaction: Transaction = bitcoinjs.Transaction.fromHex(
    record.rawTransaction
  );
  const allocationSend =
    record.operation === 'wallet' &&
    supportsSptUtxoChain(record.owner.chainId) &&
    transaction.version === ALLOCATION_SEND_VERSION;
  const byOutput = new Map<number, AssetOutput>();
  if (allocationSend) {
    const assetGuids = new Set<string>();
    for (const { assetGuid, values } of getExactAssetAllocations(transaction)) {
      if (assetGuid === '0' || assetGuids.has(assetGuid))
        throw new Error('Unable to review saved asset allocations');
      assetGuids.add(assetGuid);
      for (const { n, value } of values) {
        const output = transaction.outs[n]!;
        if (
          value === '0' ||
          byOutput.has(n) ||
          output.script[0] === bitcoinjs.opcodes.OP_RETURN
        )
          throw new Error('Unable to review saved asset allocations');
        byOutput.set(n, { assetGuid, rawAmount: value });
      }
    }
  }

  return transaction.outs.map((output, index): SavedUtxoReviewOutput => {
    const amountSatoshis = output.value.toString();
    const asset = byOutput.get(index);
    try {
      const address = bitcoinjs.address.fromOutputScript(
        output.script,
        addressNetwork
      );
      return { address, amountSatoshis, ...(asset && { asset }) };
    } catch {
      const hex = Buffer.from(output.script).toString('hex');
      if (!allocationSend) return { address: hex, amountSatoshis };
      const kind =
        output.script[0] === bitcoinjs.opcodes.OP_RETURN ? 'data' : 'script';
      return { script: { kind, hex }, amountSatoshis, ...(asset && { asset }) };
    }
  });
}
