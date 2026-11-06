import { utils as syscoinUtils } from 'syscoinjs-lib';

import { supportsSptUtxoChain } from '../../../../source/shared/sptInventory.ts';
import { toEightDecimalBuilderAmount } from '../../../../source/utils/syscoinAssetAmount.ts';
import {
  ALLOCATION_SEND_VERSION,
  assertPlainAllocationSendData,
  assertUtxoBuilderFee,
  isPositiveSptAmount,
} from '../../../../source/utils/syscoinPsbtValues.ts';
import { createOwnedUtxoBlockbookRead } from '../../../../source/wallet/utxoBlockbookReads.ts';
import {
  isPositiveSptGuid,
  prepareUtxoSignedBinding,
  utxoSubmissionUrl,
} from '../../../../source/wallet/utxoSignedBinding.ts';
import { reviewSavedUtxoOutputs } from '../../../../source/wallet/utxoSavedReview.ts';
import { submitReviewedUtxo } from '../../../../source/wallet/utxoSubmission.ts';
import { formatBaseUnits, parseDecimalAmount } from '../core/amounts.ts';
import {
  canUseUtxoCustodyAddress,
  normalizeUtxoAddress,
} from '../core/utxoAddresses.ts';
import { CustodyRuntimeError } from './types.ts';

import type {
  IKeyringManager,
  ISyscoinTransactions,
} from '@sidhujag/sysweb3-keyring';
import type {
  ReviewedUtxoOutput,
  UtxoSignedScope,
  UtxoWalletPayment,
} from '../../../../source/wallet/utxoSignedBinding.ts';
import type {
  UtxoDurableSubmission,
  UtxoRecordSession,
  UtxoSignedRecords,
} from '../../../../source/wallet/utxoSignedRecords.ts';
import {
  isCustomUtxoNetworkId,
  type UtxoNetwork,
} from '../core/utxoNetworks.ts';
import { verifySavedUtxoEndpoint } from '../core/utxoReadSession.ts';

const REVIEW_MS = 90_000;
export type NativeUtxoAsset = Readonly<{
  assetGuid: string;
  decimals: number;
  symbol: string;
}>;
type QuotedAmount =
  | Readonly<{ kind: 'native'; builderAmount: string; rawAmount: string }>
  | Readonly<{
      kind: 'spt';
      builderAmount: string;
      rawAmount: string;
      asset: NativeUtxoAsset;
    }>;

export type NativeUtxoReview = Readonly<{
  assetDisplay?: NativeUtxoAsset;
  feeSatoshis: string;
  outputs: readonly ReviewedUtxoOutput[];
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
  getAddress: IKeyringManager['getAddress'],
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
  const custom = isCustomUtxoNetworkId(network.id);
  if (custom && scope.network.url !== network.endpoint)
    throw new CustodyRuntimeError('NOT_READY');
  const verifyEndpoint = (signal: AbortSignal, assertCurrent: () => void) =>
    verifySavedUtxoEndpoint(network, { fetch, timeoutMs: 10_000 }, signal, assertCurrent);

  // SDK prepare runs inside the shared journal's dispatch admission. Check
  // the saved endpoint after the bytes are durable and before SDK POST.
  const sender: Pick<ISyscoinTransactions, 'sendTransaction'> = custom ? {
    sendTransaction(raw, authority) {
      return sdk.sendTransaction(raw, {
        ...authority,
        async prepare(candidate) {
          await authority.prepare(candidate);
          await verifyEndpoint(authority.signal, authority.assertCurrent);
          authority.assertCurrent();
        },
      });
    },
  } : sdk;
  const ownedRead = async (
    assertCurrent: () => void,
    reuseAddressDiscovery = false
  ) => {
    readController?.abort();
    const controller = new AbortController();
    readController = controller;
    if (custom) await verifyEndpoint(controller.signal, assertCurrent);
    return createOwnedUtxoBlockbookRead(
      {
        kind: 'wallet',
        address: scope.account.address,
        xpub: scope.account.xpub,
        url: scope.network.url,
        ...(reuseAddressDiscovery ? { reuseAddressDiscovery: true } : {}),
      },
      controller.signal,
      assertCurrent,
      fetch
    );
  };
  return Object.freeze({
    cancel,
    async prepare(
      input: Readonly<{
        recipient: string;
        amount: string;
        max?: boolean;
        asset?: NativeUtxoAsset;
      }>
    ): Promise<NativeUtxoReview> {
      return run(async () => {
        cancel();
        const expires = now() + REVIEW_MS;
        const current = revision;
        const check = capture(current, expires);
        check();
        let recipient: string;
        let amount: QuotedAmount;
        const asset =
          input.asset === undefined
            ? undefined
            : Object.freeze({ ...input.asset });
        const max = input.max === true;
        try {
          recipient = normalizeUtxoAddress(input.recipient.trim(), network);
          if (
            !canUseUtxoCustodyAddress(scope.account.address, network) ||
            !canUseUtxoCustodyAddress(recipient, network)
          )
            throw new Error('Unsupported UTXO spending script');
          if (asset) {
            if (
              max ||
              !supportsSptUtxoChain(network.chainId) ||
              !isPositiveSptGuid(asset.assetGuid) ||
              typeof asset.symbol !== 'string' ||
              !/^[A-Za-z0-9]{1,16}$/.test(asset.symbol)
            )
              throw new Error('Unsupported asset');
            const builderAmount = toEightDecimalBuilderAmount(
              input.amount,
              asset.decimals
            );
            const rawAmount = parseDecimalAmount(builderAmount, 8).toString();
            if (!isPositiveSptAmount(rawAmount))
              throw new Error('Asset amount is too large');
            amount = { kind: 'spt', builderAmount, rawAmount, asset };
          } else {
            const rawAmount = max
              ? '0'
              : parseDecimalAmount(input.amount, network.decimals).toString();
            amount = {
              kind: 'native',
              builderAmount: formatBaseUnits(rawAmount, network.decimals),
              rawAmount,
            };
          }
        } catch {
          throw new CustodyRuntimeError('INVALID_INPUT');
        }
        try {
          const read = await ownedRead(check, amount.kind === 'spt');
          const { outpoints: excludedOutpoints } =
            await records.fundingExclusions(
              { ...session, assertCurrent: check },
              owner
            );
          check();
          const result = await sdk.getEstimateSysTransactionFee(
            {
              amount: amount.builderAmount,
              receivingAddress: recipient,
              excludedOutpoints,
              ...(amount.kind === 'spt'
                ? {
                    token: {
                      guid: amount.asset.assetGuid,
                      symbol: amount.asset.symbol,
                    },
                  }
                : {}),
              ...(max ? { nativeSweep: true, isMax: true } : {}),
            },
            read
          );
          check();
          const payment: UtxoWalletPayment =
            amount.kind === 'spt'
              ? {
                  kind: 'spt',
                  address: recipient,
                  assetGuid: amount.asset.assetGuid,
                  rawAmount: amount.rawAmount,
                  changeAddress: await getAddress(
                    scope.account.xpub,
                    true,
                    read
                  ),
                }
              : {
                  kind: 'native',
                  address: recipient,
                  amountSatoshis: max
                    ? parseDecimalAmount(
                        result.recipientAmount!,
                        network.decimals
                      ).toString()
                    : amount.rawAmount,
                };
          check();
          const binding = await prepareUtxoSignedBinding(
            scope,
            result.psbt,
            payment,
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
            ...(amount.kind === 'spt' ? { assetDisplay: amount.asset } : {}),
          });
          review = { expires, binding, view };
          return view;
        } catch (error) {
          check();
          throw error;
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
        try {
          const read = await ownedRead(check);
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
        const transaction = syscoinUtils.bitcoinjs.Transaction.fromHex(
          retained.rawTransaction
        );
        let outputs: ReviewedUtxoOutput[];
        if (transaction.version === ALLOCATION_SEND_VERSION) {
          assertPlainAllocationSendData(transaction);
          outputs = reviewSavedUtxoOutputs(
            retained,
            network.addressNetwork
          ).flatMap((output) => {
            if (output.script?.kind === 'data') return [];
            if (!output.address) throw new CustodyRuntimeError('NOT_READY');
            const asset = output.asset && Object.freeze(output.asset);
            return [
              Object.freeze({
                address: output.address,
                amountSatoshis: output.amountSatoshis,
                ...(asset ? { asset } : {}),
              }),
            ];
          });
          if (!outputs.some((output) => output.asset))
            throw new CustodyRuntimeError('NOT_READY');
        } else {
          outputs = transaction.outs.map(
            (output: { script: Uint8Array; value: bigint }) =>
              Object.freeze({
                address: syscoinUtils.bitcoinjs.address.fromOutputScript(
                  output.script,
                  network.addressNetwork
                ),
                amountSatoshis: output.value.toString(),
              })
          );
        }
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
            sender,
            records,
            session: currentSession,
            fetch,
            intent: 'replay',
          });
        try {
          const read = await ownedRead(check);
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
            sender,
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
