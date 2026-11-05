import { utils as syscoinUtils } from 'syscoinjs-lib';

import { assertUtxoBuilderFee } from '../../../../source/utils/syscoinPsbtValues.ts';
import { createOwnedUtxoBlockbookRead } from '../../../../source/wallet/utxoBlockbookReads.ts';
import {
  prepareUtxoSignedBinding,
  utxoSubmissionUrl,
} from '../../../../source/wallet/utxoSignedBinding.ts';
import { submitReviewedUtxo } from '../../../../source/wallet/utxoSubmission.ts';
import { formatBaseUnits, parseDecimalAmount } from '../core/amounts.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { CustodyRuntimeError } from './types.ts';

import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';
import type { UtxoSignedScope } from '../../../../source/wallet/utxoSignedBinding.ts';
import type {
  UtxoDurableSubmission,
  UtxoRecordSession,
  UtxoSignedRecords,
} from '../../../../source/wallet/utxoSignedRecords.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';

const REVIEW_MS = 90_000;
type Output = Readonly<{ address: string; amountSatoshis: string }>;
export type NativeUtxoReview = Readonly<{
  feeSatoshis: string;
  outputs: readonly Output[];
  retryTxid?: string;
}>;

/** Native consent owner. The UI never receives a PSBT, raw bytes or keyring. */
export function createNativeUtxoSend(
  network: UtxoNetwork,
  scope: UtxoSignedScope,
  session: UtxoRecordSession,
  sdk: ISyscoinTransactions,
  records: UtxoSignedRecords,
  fetch: typeof globalThis.fetch,
  now = () => performance.now()
) {
  const owner = Object.freeze({
    chainId: scope.network.chainId,
    slip44: scope.network.slip44,
    genesisHash: scope.network.genesisHash,
    account: scope.account,
  });
  let revision = 0;
  let busy = false;
  let readController: AbortController | undefined;
  type Prepared = Awaited<ReturnType<typeof prepareUtxoSignedBinding>>;
  type Review =
    | { view: NativeUtxoReview; expires: number; binding: Prepared }
    | {
        view: NativeUtxoReview;
        expires: number;
        retained: UtxoDurableSubmission;
      };
  let review: Review | undefined;
  const cancel = () => {
    revision++;
    review = undefined;
    readController?.abort();
  };
  const capture = (current: number, expires: number) => () => {
    session.assertCurrent();
    if (revision !== current || now() >= expires)
      throw new CustodyRuntimeError('CANCELLED');
  };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new CustodyRuntimeError('BUSY');
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
  const ownedRead = (assertCurrent: () => void) => {
    readController?.abort();
    readController = new AbortController();
    return createOwnedUtxoBlockbookRead(
      {
        kind: 'wallet',
        address: scope.account.address,
        xpub: scope.account.xpub,
        url: scope.network.url,
      },
      readController.signal,
      assertCurrent,
      fetch
    );
  };
  return Object.freeze({
    cancel,
    async prepare(
      input: Readonly<{ recipient: string; amount: string; max?: boolean }>
    ): Promise<NativeUtxoReview> {
      return run(async () => {
        cancel();
        const expires = now() + REVIEW_MS;
        const current = revision;
        const check = capture(current, expires);
        check();
        let recipient: string, amountSatoshis: string;
        const max = input.max === true;
        try {
          recipient = normalizeUtxoAddress(input.recipient.trim(), network.id);
          amountSatoshis = max
            ? '0'
            : parseDecimalAmount(input.amount, network.decimals).toString();
        } catch {
          throw new CustodyRuntimeError('INVALID_INPUT');
        }
        const read = ownedRead(check);
        try {
          const excludedOutpoints = await records.excludedOutpoints(
            { ...session, assertCurrent: check },
            owner
          );
          check();
          const result = await sdk.getEstimateSysTransactionFee(
            {
              amount: formatBaseUnits(amountSatoshis, network.decimals),
              receivingAddress: recipient,
              excludedOutpoints,
              ...(max ? { nativeSweep: true, isMax: true } : {}),
            },
            read
          );
          check();
          if (max)
            amountSatoshis = parseDecimalAmount(
              result.recipientAmount!,
              network.decimals
            ).toString();
          const binding = await prepareUtxoSignedBinding(
            scope,
            result.psbt,
            { address: recipient, amountSatoshis },
            {
              assertCurrent: check,
              fetchPreviousTransaction: (txid) =>
                syscoinUtils.fetchBackendRawTx(scope.network.url, txid, read),
            }
          );
          check();
          assertUtxoBuilderFee(result.fee, binding.review.feeSatoshis);
          const view = Object.freeze({
            feeSatoshis: binding.review.feeSatoshis,
            outputs: binding.review.outputs,
          });
          review = { expires, binding, view };
          return view;
        } finally {
          readController?.abort();
          readController = undefined;
        }
      });
    },
    list() {
      return records.list(session, owner);
    },
    async check(txid: string): Promise<'confirmed' | 'seen' | 'unknown'> {
      return run(async () => {
        const check = capture(revision, now() + REVIEW_MS);
        check();
        const read = ownedRead(check);
        try {
          return await records.observe(
            { ...session, assertCurrent: check },
            owner,
            txid,
            utxoSubmissionUrl(scope.network.url),
            () => syscoinUtils.fetchBackendRawTx(scope.network.url, txid, read)
          );
        } finally {
          readController?.abort();
          readController = undefined;
        }
      });
    },
    async prepareRetry(txid: string): Promise<NativeUtxoReview> {
      return run(async () => {
        cancel();
        const expires = now() + REVIEW_MS,
          check = capture(revision, expires);
        const retained = await records.readExact(
          { ...session, assertCurrent: check },
          owner,
          txid
        );
        check();
        if (!retained || retained.url !== utxoSubmissionUrl(scope.network.url))
          throw new CustodyRuntimeError('NOT_READY');
        const outputs = syscoinUtils.bitcoinjs.Transaction.fromHex(
          retained.rawTransaction
        ).outs.map((output: { script: Uint8Array; value: bigint }) =>
          Object.freeze({
            address: syscoinUtils.bitcoinjs.address.fromOutputScript(
              output.script,
              network.addressNetwork
            ),
            amountSatoshis: output.value.toString(),
          })
        );
        const view = Object.freeze({
          feeSatoshis: retained.feeSatoshis,
          outputs: Object.freeze(outputs),
          retryTxid: txid,
        });
        review = { view, expires, retained };
        return view;
      });
    },
    async confirm(view: NativeUtxoReview): Promise<Readonly<{ txid: string }>> {
      return run(async () => {
        const selected = review;
        if (!selected || view !== selected.view)
          throw new CustodyRuntimeError('NOT_READY');
        review = undefined;
        const check = capture(revision, selected.expires);
        check();
        const currentSession = { ...session, assertCurrent: check };
        if ('retained' in selected)
          return submitReviewedUtxo({
            record: selected.retained,
            sender: sdk,
            records,
            session: currentSession,
            fetch,
            intent: 'replay',
          });
        const read = ownedRead(check);
        try {
          const signed = await sdk.signPSBT(
            { psbt: selected.binding.psbt },
            read
          );
          check();
          const { record } = selected.binding.bindSigned(signed);
          return await submitReviewedUtxo({
            record: {
              owner,
              operation: 'wallet',
              rawTransaction: record.rawTransaction,
              txid: record.txid,
              url: record.url,
              feeSatoshis: record.review.feeSatoshis,
              outpoints: record.review.outpoints,
              virtualSize: record.virtualSize,
            },
            sender: sdk,
            records,
            session: currentSession,
            fetch,
            intent: 'initial',
          });
        } finally {
          readController?.abort();
          readController = undefined;
        }
      });
    },
  });
}

export type NativeUtxoSend = ReturnType<typeof createNativeUtxoSend>;
