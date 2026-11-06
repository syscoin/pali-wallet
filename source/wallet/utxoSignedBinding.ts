import { PsbtUtils } from '@sidhujag/sysweb3-keyring/cjs/utils/psbt.js';
import { getNetworkConfig } from '@sidhujag/sysweb3-network/cjs/networks.js';
import { utils as syscoinUtils } from 'syscoinjs-lib';
import { coinSelect } from 'syscointx-js';

import { SENTRY_NETWORKS } from '../shared/sentryNetworks.ts';
import { supportsSptUtxoChain } from '../shared/sptInventory.ts';
import { assertUtxoSoftwareSpend } from '../shared/utxoSoftwareCustody.ts';
import { assertPsbtWorkBudget } from '../utils/psbtWorkBudget.ts';
import {
  ALLOCATION_SEND_VERSION,
  assertPlainAllocationSendData,
  createUtxoFeeReview,
  getVerifiedSyscoinPsbtValueSummary,
  isPositiveSptAmount,
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
type SptAmount = Readonly<{ assetGuid: string; rawAmount: string }>;
export type ReviewedUtxoOutput = UtxoAmount & Readonly<{ asset?: SptAmount }>;
export type UtxoWalletPayment =
  | (UtxoAmount & Readonly<{ kind: 'native' }>)
  | (SptAmount &
      Readonly<{ address: string; changeAddress: string; kind: 'spt' }>);
type UtxoReview = Readonly<{
  feeSatoshis: string;
  outpoints: readonly string[];
  outputs: readonly ReviewedUtxoOutput[];
  recipient: ReviewedUtxoOutput;
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

export const isPositiveSptGuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9][0-9]{0,19}$/.test(value) &&
  BigInt(value) <= 0xffffffffffffffffn;

function assertSptFunding(
  network: UtxoSignedScope['network'],
  inputValuesSatoshis: readonly string[]
): void {
  const registered = Object.values(SENTRY_NETWORKS).find(
    ({ chainId, genesisHash }) =>
      chainId === network.chainId && genesisHash === network.genesisHash
  );
  if (!registered) throw new Error('Unable to identify SPT collateral rules');
  // Internal Sentry registrations can use more than the external key-hash scripts.
  if (inputValuesSatoshis.includes(registered.collateralSatoshis))
    throw Object.assign(
      new Error(
        'This asset transfer would spend a possible Sentry collateral output'
      ),
      {
        code: 'UTXO_POSSIBLE_SENTRY_COLLATERAL',
        transactionNotBroadcast: true,
      }
    );
}

function reviewSptPayment(
  psbt: Psbt,
  summary: Awaited<ReturnType<typeof getVerifiedSyscoinPsbtValueSummary>>,
  payment: Extract<UtxoWalletPayment, { kind: 'spt' }>,
  toScript: (address: string) => Buffer
): readonly ReviewedUtxoOutput[] {
  const invalid = () =>
    new Error('PSBT does not match the ordinary SPT review');
  const recipient = toScript(payment.address);
  const change = toScript(payment.changeAddress);
  if (
    recipient.equals(change) ||
    summary.inputAssets.some(({ assetGuid }) => assetGuid !== payment.assetGuid)
  )
    throw invalid();
  const [allocation] = summary.assetAllocations;
  if (
    summary.assetAllocations.length !== 1 ||
    allocation?.assetGuid !== payment.assetGuid
  )
    throw invalid();
  const amounts = new Map<number, string>();
  for (const { n, value } of allocation.values) {
    if (amounts.has(n)) throw invalid();
    amounts.set(n, value);
  }
  assertPlainAllocationSendData(
    syscoinUtils.bitcoinjs.Transaction.fromHex(unsignedTransactionHex(psbt))
  );

  let paid: ReviewedUtxoOutput | undefined;
  const changeOutputs: ReviewedUtxoOutput[] = [];
  for (const [index, output] of psbt.txOutputs.entries()) {
    const rawAmount = amounts.get(index);
    const script = Buffer.from(output.script);
    if (script[0] === syscoinUtils.bitcoinjs.opcodes.OP_RETURN) {
      if (rawAmount !== undefined) throw invalid();
      continue;
    }
    if (!output.address) throw invalid();
    const amountSatoshis = summary.outputValuesSatoshis[index]!;
    const asset =
      rawAmount === undefined
        ? undefined
        : Object.freeze({ assetGuid: payment.assetGuid, rawAmount });
    const projected = Object.freeze({
      address: output.address,
      amountSatoshis,
      ...(asset ? { asset } : {}),
    });
    if (script.equals(recipient)) {
      // This builder uses the shared destination-script dust policy for the
      // recipient carrier. A native payment must have its own review.
      if (
        paid ||
        rawAmount !== payment.rawAmount ||
        amountSatoshis !==
          coinSelect.utils.dustThreshold({ scriptPubKey: script }).toString()
      )
        throw invalid();
      paid = projected;
    } else {
      if (!script.equals(change)) throw invalid();
      changeOutputs.push(projected);
    }
  }
  if (!paid) throw invalid();
  return Object.freeze([paid, ...changeOutputs]);
}

/** Retain the verified quote for trusted custody. The host owns consent and durable commit. */
export async function prepareUtxoSignedBinding(
  { profileId, account, network }: UtxoSignedScope,
  quote: PsbtData,
  payment: UtxoWalletPayment,
  ports: Readonly<{
    assertCurrent: () => void;
    fetchPreviousTransaction: (txid: string) => Promise<unknown>;
  }>
) {
  const { assertCurrent, fetchPreviousTransaction } = ports;
  const check = () => assertBindingCurrent(assertCurrent);
  check();
  const intent: UtxoWalletPayment = Object.freeze({ ...payment });
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
    (intent.kind === 'native'
      ? !/^[1-9][0-9]{0,19}$/.test(intent.amountSatoshis)
      : intent.kind !== 'spt' ||
        !supportsSptUtxoChain(scope.network.chainId) ||
        !isPositiveSptGuid(intent.assetGuid) ||
        !isPositiveSptAmount(intent.rawAmount))
  )
    throw new Error('Invalid ordinary UTXO review scope or amount');

  const url = utxoSubmissionUrl(scope.network.url);
  const psbt = snapshotPsbt(quote);
  const parsed: Psbt = PsbtUtils.fromPali(psbt, scope.network);
  const { networks } = getNetworkConfig(
    scope.network.slip44,
    scope.network.currency
  );
  const addressNetwork =
    scope.network.slip44 === 1 ? networks.testnet : networks.mainnet;
  const toScript = (address: string) =>
    Buffer.from(
      syscoinUtils.bitcoinjs.address.toOutputScript(address, addressNetwork)
    );
  const outputs = parsed.txOutputs;
  const recipient = outputs[0];
  if (intent.kind === 'native') {
    // The existing single-recipient native builder retains the explicit output first.
    if (
      parsed.version !== 2 ||
      !recipient ||
      !Buffer.from(recipient.script).equals(toScript(intent.address)) ||
      recipient.value.toString() !== intent.amountSatoshis ||
      outputs.some((output) => !output.address)
    )
      throw new Error('PSBT does not match the ordinary UTXO review');
  } else if (parsed.version !== ALLOCATION_SEND_VERSION) {
    throw new Error('PSBT does not match the ordinary SPT review');
  }

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
  if (
    intent.kind === 'native' &&
    (summary.inputAssets.length || summary.assetAllocations.length)
  )
    throw new Error('Asset-assisted UTXO send requires a separate review');
  if (intent.kind === 'spt')
    assertSptFunding(scope.network, summary.inputValuesSatoshis);
  const reviewedOutputs =
    intent.kind === 'spt'
      ? reviewSptPayment(parsed, summary, intent, toScript)
      : Object.freeze(
          outputs.map((output, index) =>
            Object.freeze({
              address: output.address!,
              amountSatoshis: summary.outputValuesSatoshis[index]!,
            })
          )
        );
  const transactionBinding = createUtxoTransactionBinding(
    parsed,
    summary.feeSatoshis,
    check
  );

  const review: UtxoReview = Object.freeze({
    recipient: reviewedOutputs[0]!,
    outputs: reviewedOutputs,
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
