import { Transaction } from 'ethers/transaction';

import { formatTokenUnits } from '../../../../source/shared/erc20.ts';
import { snapshotUtxoRbf } from '../../../../source/shared/utxoTransactionOptions.ts';
import { formatBaseUnits } from '../core/amounts.ts';
import { assertTransferIntentEnvelope } from '../custody/transferIntent.ts';
import type { NativeTrezorResumeIntent } from '../custody/trezorAccounts.ts';

/** Refill a fresh form only. None of these values authorize a transaction. */
export function trezorResumeDraft(value: NativeTrezorResumeIntent) {
  if (value.kind === 'external-psbt') throw Error('External PSBT resume requires its original pending request');
  if (value.kind === 'utxo')
    return {
      kind: 'utxo' as const,
      asset: value.asset,
      draft: { recipient: value.recipient, amount: value.amount, max: value.max, rbf: snapshotUtxoRbf(value.rbf) },
    };
  const transaction = Transaction.from(value.unsignedTransaction);
  if (transaction.isSigned() || !transaction.to || transaction.chainId <= 0n)
    throw Error('Invalid Trezor resume draft');
  assertTransferIntentEnvelope({
    chainId: transaction.chainId.toString(),
    from: value.intent?.kind === 'nft-transfer' ? value.intent.from : undefined,
    to: transaction.to,
    value: transaction.value.toString(),
    data: transaction.data,
  }, value.intent);
  const draft = {
    recipient: value.intent?.recipient ?? transaction.to,
    amount: value.intent?.kind === 'erc20-transfer'
      ? formatTokenUnits(value.intent.amountUnits, value.intent.token.decimals)
      : value.intent?.kind === 'nft-transfer'
      ? value.intent.amountUnits
      : formatBaseUnits(transaction.value.toString(), 18),
    tokenId: value.intent?.kind === 'nft-transfer' ? value.intent.tokenId : undefined,
    nonce: transaction.nonce.toString(),
  };
  if (value.replacement)
    return { kind: 'replacement' as const, replacement: value.replacement, draft };
  if (value.intent?.kind === 'erc20-transfer')
    return { kind: 'token' as const, token: value.intent.token, draft };
  if (value.intent?.kind === 'nft-transfer') {
    const collectible = value.intent.tokenStandard === 'ERC-721'
      ? { contractAddress: value.intent.contractAddress, tokenStandard: 'ERC-721' as const }
      : { contractAddress: value.intent.contractAddress, tokenStandard: 'ERC-1155' as const, tokenId: value.intent.tokenId };
    return { kind: 'collectible' as const, collectible, draft };
  }
  return { kind: 'native' as const, draft };
}
