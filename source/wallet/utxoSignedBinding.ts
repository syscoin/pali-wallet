import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { assertUtxoSoftwareSpend } from '../shared/utxoSoftwareCustody.ts';
import { assertPsbtWorkBudget } from '../utils/psbtWorkBudget.ts';
import {
  createUtxoFeeReview,
  getVerifiedSyscoinPsbtValueSummary,
} from '../utils/syscoinPsbtValues.ts';
import { utxoInputOutpoints } from '../utils/utxoAcknowledgedInputs.ts';

import type { Psbt, Transaction } from 'bitcoinjs-lib';

export type UtxoSignedScope = Readonly<{
  account: Readonly<{
    address: string;
    id: number;
    type: 'HDAccount' | 'Imported';
    xpub: string;
  }>;
  network: Readonly<{
    chainId: number;
    currency: string;
    genesisHash: string;
    kind: 'syscoin';
    slip44: number;
    url: string;
  }>;
  profileId: string;
}>;

type PsbtData = Readonly<{ assets: string; psbt: string }>;
type UtxoAmount = Readonly<{ address: string; amountSatoshis: string }>;
type UtxoReview = Readonly<{
  feeSatoshis: string;
  outpoints: readonly string[];
  outputs: readonly UtxoAmount[];
  recipient: UtxoAmount;
}>;
type SubmissionDescriptor = Readonly<{
  rawTransaction: string;
  txid: string;
  url: string;
}>;

export type UtxoSignedBindingRecord = SubmissionDescriptor &
  Readonly<{
    review: UtxoReview;
    scope: UtxoSignedScope;
    virtualSize: number;
  }>;

function snapshotPsbt({ psbt, assets }: PsbtData): PsbtData {
  if (typeof psbt !== 'string' || typeof assets !== 'string')
    throw new Error('Invalid UTXO quote');
  const data = Object.freeze({ psbt, assets });
  assertPsbtWorkBudget(data);
  return data;
}

/** Match the owned SyscoinJS send path under the captured Blockbook base. */
export function utxoSubmissionUrl(base: string): string {
  const url = new URL(base);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    /[?#]/.test(url.href)
  )
    throw new Error('Invalid UTXO submission endpoint');
  url.pathname = url.pathname.replace(/\/$/, '') + '/api/v2/sendtx/';
  return url.href;
}

function unsignedTransactionHex(psbt: Psbt): string {
  return Buffer.from(psbt.data.globalMap.unsignedTx.toBuffer()).toString('hex');
}

function withoutSignatures(transaction: Transaction): string {
  const unsigned = transaction.clone();
  unsigned.stripWitnesses();
  for (const input of unsigned.ins) input.script = new Uint8Array();
  return unsigned.toHex();
}

function assertBindingCurrent(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  void Promise.resolve(result).catch(() => undefined);
  throw new Error('UTXO binding requires a synchronous owner');
}

/** Preserve finalization and bitcoinjs' maximum-fee-rate check for every lane. */
export function extractUtxoSignedTransaction(finalized: Psbt): Transaction {
  try {
    return finalized.extractTransaction();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Warning: You are paying around ') &&
      error.message.includes('setMaximumFeeRate')
    )
      throw Object.assign(
        new Error(
          'Transaction fee exceeds the wallet safety limit. Lower the fee and try again.'
        ),
        { code: 'UTXO_FEE_RATE_EXCEEDED' }
      );
    throw error;
  }
}

/** Bind an authenticated quote to the final bytes in either wallet host. */
export function createUtxoTransactionBinding(
  quote: Psbt,
  feeSatoshis: string,
  assertCurrent: () => void
) {
  const check = () => assertBindingCurrent(assertCurrent);
  check();
  if (
    typeof feeSatoshis !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(feeSatoshis)
  )
    throw new Error('Invalid authenticated UTXO fee');
  const unsigned = unsignedTransactionHex(quote);
  const review = createUtxoFeeReview(quote, feeSatoshis);
  const outpoints = Object.freeze(utxoInputOutpoints(quote.txInputs));
  const changed = (message: string) =>
    Object.assign(new Error(message), {
      code: 'UTXO_QUOTE_FEE_CHANGED',
      transactionNotBroadcast: true,
    });
  return Object.freeze({
    review,
    outpoints,
    bindSigned(finalized: Psbt) {
      check();
      if (unsignedTransactionHex(finalized) !== unsigned)
        throw changed('Signed PSBT differs from the reviewed transaction');
      const transaction = extractUtxoSignedTransaction(finalized);
      if (
        withoutSignatures(transaction) !== unsigned ||
        finalized.getFee().toString() !== review.feeSatoshis
      )
        throw changed(
          'Signed transaction differs from the reviewed inputs or fee'
        );
      const result = Object.freeze({
        rawTransaction: transaction.toHex(),
        txid: transaction.getId(),
        virtualSize: transaction.virtualSize(),
        feeSatoshis: review.feeSatoshis,
        outpoints,
      });
      check();
      return result;
    },
  });
}

/** Retain the verified quote for trusted custody. The host owns consent and durable commit. */
export async function prepareUtxoSignedBinding(
  { profileId, account, network }: UtxoSignedScope,
  quote: PsbtData,
  { address, amountSatoshis }: UtxoAmount,
  ports: Readonly<{
    assertCurrent: () => void;
    fetchPreviousTransaction: (txid: string) => Promise<unknown>;
  }>
) {
  const { assertCurrent, fetchPreviousTransaction } = ports;
  const check = () => assertBindingCurrent(assertCurrent);
  check();
  const scope = Object.freeze({
    profileId,
    account: Object.freeze({
      id: account.id,
      type: account.type,
      address: account.address,
      xpub: account.xpub,
    }),
    network: Object.freeze({
      kind: network.kind,
      chainId: network.chainId,
      slip44: network.slip44,
      currency: network.currency,
      url: network.url,
      genesisHash: network.genesisHash,
    }),
  });
  if (
    !/^0x[0-9a-f]{64}$/.test(scope.profileId) ||
    !Number.isSafeInteger(scope.account.id) ||
    scope.account.id < 0 ||
    (scope.account.type !== 'HDAccount' && scope.account.type !== 'Imported') ||
    !scope.account.address ||
    !scope.account.xpub ||
    scope.network.kind !== 'syscoin' ||
    !Number.isSafeInteger(scope.network.chainId) ||
    scope.network.chainId < 0 ||
    !Number.isSafeInteger(scope.network.slip44) ||
    scope.network.slip44 < 0 ||
    !scope.network.currency ||
    !/^[0-9a-f]{64}$/.test(scope.network.genesisHash) ||
    !/^[1-9][0-9]{0,19}$/.test(amountSatoshis)
  )
    throw new Error('Invalid ordinary UTXO review scope or amount');

  const url = utxoSubmissionUrl(scope.network.url);
  const psbt = snapshotPsbt(quote);
  const parsed: Psbt = PsbtUtils.fromPali(psbt, scope.network);
  const { networks } = getNetworkConfig(
    scope.network.slip44,
    scope.network.currency
  );
  const script = syscoinUtils.bitcoinjs.address.toOutputScript(
    address,
    scope.network.slip44 === 1 ? networks.testnet : networks.mainnet
  );
  const outputs = parsed.txOutputs;
  const recipient = outputs[0];
  // The existing single-recipient SDK builder retains the explicit output first.
  if (
    parsed.version !== 2 ||
    !recipient ||
    !Buffer.from(recipient.script).equals(script) ||
    recipient.value.toString() !== amountSatoshis ||
    outputs.some((output) => !output.address)
  )
    throw new Error('PSBT does not match the ordinary UTXO review');

  const summary = await getVerifiedSyscoinPsbtValueSummary(
    parsed,
    async (txid) => {
      check();
      try {
        return await fetchPreviousTransaction(txid);
      } finally {
        check();
      }
    }
  );
  check();
  assertUtxoSoftwareSpend(scope.network, [
    ...summary.inputScripts,
    ...outputs.map(({ script: outputScript }) => outputScript),
  ]);
  if (summary.inputAssets.length || summary.assetAllocations.length)
    throw new Error('Asset-assisted UTXO send requires a separate review');
  const transactionBinding = createUtxoTransactionBinding(
    parsed,
    summary.feeSatoshis,
    check
  );

  const review: UtxoReview = Object.freeze({
    recipient: Object.freeze({ address, amountSatoshis }),
    outputs: Object.freeze(
      outputs.map((output, index) =>
        Object.freeze({
          address: output.address!,
          amountSatoshis: summary.outputValuesSatoshis[index]!,
        })
      )
    ),
    outpoints: transactionBinding.outpoints,
    feeSatoshis: summary.feeSatoshis,
  });

  return Object.freeze({
    psbt,
    review,
    // Only the trusted host's finalized SDK signing result can enter this seam.
    bindSigned(signed: PsbtData) {
      check();
      const finalized: Psbt = PsbtUtils.fromPali(
        snapshotPsbt(signed),
        scope.network
      );
      const transaction = transactionBinding.bindSigned(finalized);
      const record: UtxoSignedBindingRecord = Object.freeze({
        scope,
        review,
        rawTransaction: transaction.rawTransaction,
        txid: transaction.txid,
        virtualSize: transaction.virtualSize,
        url,
      });
      check();
      return Object.freeze({
        record,
        rawTransaction: record.rawTransaction,
        assertCurrent: check,
        bindPrepared({
          url: target,
          rawTransaction,
          txid,
        }: SubmissionDescriptor) {
          check();
          if (
            target !== record.url ||
            rawTransaction !== record.rawTransaction ||
            txid !== record.txid
          )
            throw new Error(
              'Submission differs from the reviewed signed transaction'
            );
          return record;
        },
      });
    },
  });
}
