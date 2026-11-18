import { readPublicSyscoinFee } from '@sidhujag/sysweb3-keyring/cjs/transactions/syscoin-core.js';
import { AUTOMATIC_FEE, chooseUtxoFeeRate, snapshotUtxoFeeChoice, utxoFeeRateUnits, type UtxoFeeChoice } from '../../../../source/shared/transactionFeeChoice.ts';
import { SENTRY_NETWORKS } from '../../../../source/shared/sentryNetworks.ts';
import { unionUtxoExclusions } from '../../../../source/shared/utxoExclusions.ts';
import { reviewUtxoTransactionOptions, snapshotUtxoRbf, type UtxoTransactionOptions } from '../../../../source/shared/utxoTransactionOptions.ts';
import type { createNativeSentryCollateral } from './sentryNodeManagement.ts';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { isSptDisplaySymbol, supportsSptUtxoChain } from '../../../../source/shared/sptInventory.ts';
import { toEightDecimalBuilderAmount } from '../../../../source/utils/syscoinAssetAmount.ts';
import {
  assertUtxoBuilderFee,
  isPositiveSptAmount,
} from '../../../../source/utils/syscoinPsbtValues.ts';
import { createOwnedUtxoBlockbookRead } from '../../../../source/wallet/utxoBlockbookReads.ts';
import {
  isPositiveSptGuid,
  prepareUtxoSignedBinding,
  utxoSubmissionUrl,
} from '../../../../source/wallet/utxoSignedBinding.ts';
import { availableUtxoReplacementKinds, prepareUtxoReplacement, utxoReplacementReads, type UtxoReplacementKind } from '../../../../source/wallet/utxoReplacement.ts';
import type { SavedUtxoReviewOutput } from '../../../../source/wallet/utxoSavedReview.ts';
import {
  observeRetainedUtxo,
  reconcileRetainedUtxo,
  submitReviewedUtxo,
} from '../../../../source/wallet/utxoSubmission.ts';
import { formatBaseUnits, parseDecimalAmount } from '../core/amounts.ts';
import {
  canUseUtxoCustodyAddress,
  normalizeUtxoAddress,
} from '../core/utxoAddresses.ts';
import { CustodyRuntimeError } from './types.ts';
import type { NativeOperationCredential, NativeOperationAuthorization } from './types.ts';

import type {
  IKeyringManager,
  ISyscoinTransactions,
} from '@sidhujag/sysweb3-keyring';
import type {
  UtxoSignedScope,
  UtxoWalletPayment,
} from '../../../../source/wallet/utxoSignedBinding.ts';
import type {
  UtxoRecordSession,
  UtxoRetainedSubmission,
  UtxoSignedRecords,
} from '../../../../source/wallet/utxoSignedRecords.ts';
import {
  canonicalUtxoEndpoint,
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

export type NativeUtxoReplacement = Readonly<{ txid: string; mode: UtxoReplacementKind }>;

export type NativeUtxoReview = Readonly<{
  transactionOptions: UtxoTransactionOptions;
  assetDisplay?: NativeUtxoAsset;
  feeSatoshis: string;
  replacement?: NativeUtxoReplacement & Readonly<{ previousFeeSatoshis: string }>;
  outputs: readonly SavedUtxoReviewOutput[];
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
  collateral: ReturnType<typeof createNativeSentryCollateral> | null,
  authorization: Readonly<{
    authorize(credential: NativeOperationCredential, input: Parameters<ISyscoinTransactions['signPSBT']>[0], assertCurrent: () => void): Promise<NativeOperationAuthorization>;
    sign(receipt: NativeOperationAuthorization, input: Parameters<ISyscoinTransactions['signPSBT']>[0], read: Parameters<ISyscoinTransactions['signPSBT']>[1], assertCurrent: () => void): ReturnType<ISyscoinTransactions['signPSBT']>;
    release(receipt: NativeOperationAuthorization): void;
  }>,
  now = () => performance.now()
) {
  const sentryChain = Object.values(SENTRY_NETWORKS).some(item=>
    item.chainId===scope.network.chainId && item.genesisHash===scope.network.genesisHash);
  const supplied = collateral !== null && typeof collateral === 'object' && !!collateral?.registry && !!collateral?.scope;
  if ((collateral !== null && !supplied) || sentryChain !== supplied || (collateral && collateral.scope.genesisHash!==scope.network.genesisHash))
    throw new CustodyRuntimeError('NOT_READY');
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
  type Review = {
    view: NativeUtxoReview;
    expires: number;
    binding: Pick<Prepared, 'psbt' | 'review'> & {
      bindSigned(signed: Parameters<Prepared['bindSigned']>[0]): Pick<ReturnType<Prepared['bindSigned']>, 'record'>;
    };
    predecessor?: UtxoRetainedSubmission;
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
  const protectedPoints = async (check:()=>void) => {
    check();
    if (!collateral) return [];
    const reservations = await collateral.registry.getSentryCollateralReservations(collateral.scope);
    check();
    return reservations.map(({txid,vout})=>({txid,vout}));
  };
  const assertUnprotected = async (points:readonly string[],check:()=>void) => {
    const protectedSet=new Set((await protectedPoints(check)).map(item=>`${item.txid}:${item.vout}`));check();
    if(points.some(point=>protectedSet.has(point)))
      throw new Error('This transaction spends protected Sentry Node collateral. Release its protection explicitly only if you intend to stop the node.');
  };
  const submitProtected = <T>(points:readonly string[],check:()=>void,submit:(transport:typeof fetch)=>Promise<T>) => {
    const send=async(markInvoked:()=>void)=>{
      await assertUnprotected(points,check);check();
      return submit((input,init)=>{
        check();if(init?.method==='POST')markInvoked();return fetch(input,init);
      });
    };
    return collateral ? collateral.registry.withSentryCollateralBroadcast(collateral.scope,send) : send(()=>undefined);
  };
  if (canonicalUtxoEndpoint(scope.network.url) !== network.endpoint)
    throw new CustodyRuntimeError('NOT_READY');
  const verifyEndpoint = (signal: AbortSignal, assertCurrent: () => void) =>
    verifySavedUtxoEndpoint(
      network,
      { fetch, timeoutMs: 10_000 },
      signal,
      assertCurrent
    );

  // SDK prepare runs inside the shared journal's dispatch admission. Check
  // the saved endpoint after the submission record is durable and before SDK POST.
  const sender: Pick<ISyscoinTransactions, 'sendTransaction'> = {
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
  };
  const ownedRead = async (
    assertCurrent: () => void,
    reuseAddressDiscovery = false
  ) => {
    readController?.abort();
    const controller = new AbortController();
    readController = controller;
    await verifyEndpoint(controller.signal, assertCurrent);
    const read = createOwnedUtxoBlockbookRead(
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
    return Object.freeze({ ...read, ...records.addressDiscovery({ ...session, assertCurrent: read.assertCurrent }, owner) });
  };
  const candidate = async (txid: string, check: () => void, includeUnacknowledged = false) => {
    check();
    if (scope.account.type !== 'HDAccount' && scope.account.type !== 'Imported') return;
    if (!/^[a-f0-9]{64}$/.test(txid)) return;
    const retained = await records.replacementCandidate({ ...session, assertCurrent: check }, owner, txid, includeUnacknowledged);
    check();
    if (!retained || retained.url !== utxoSubmissionUrl(scope.network.url)) return;
    await assertUnprotected(retained.outpoints, check);
    return retained;
  };
  const observePending = async (txid: string, signal: AbortSignal, check: () => void) => {
    const status = await observeRetainedUtxo({
      backendChain: network.backendChain, fetch, owner, records,
      session: { ...session, assertCurrent: check }, signal, txid,
    });
    check();
    if (status !== 'seen') throw new CustodyRuntimeError('NOT_READY');
  };
  return Object.freeze({
    cancel,
    async availableReplacements(txid: string, assertCurrent: () => void): Promise<readonly UtxoReplacementKind[]> {
      const retained = await candidate(txid, () => { session.assertCurrent(); assertCurrent(); }, true);
      return retained ? availableUtxoReplacementKinds(retained) : [];
    },
    async prepareReplacement(input: NativeUtxoReplacement, inputFeeChoice: UtxoFeeChoice): Promise<NativeUtxoReview> {
      const { txid, mode } = input;
      const feeChoice = snapshotUtxoFeeChoice(inputFeeChoice);
      return run(async () => {
        cancel();
        const expires = now() + REVIEW_MS;
        const check = capture(revision, expires);
        try {
          if (mode !== 'speed-up' && mode !== 'cancel') throw new CustodyRuntimeError('INVALID_INPUT');
          const before = await candidate(txid, check, true);
          if (!before || !availableUtxoReplacementKinds(before).includes(mode))
            throw new CustodyRuntimeError('NOT_READY');
          const read = await ownedRead(check, true);
          await observePending(txid, read.signal, check);
          const predecessor = await candidate(txid, check);
          if (!predecessor || predecessor.signedDigest !== before.signedDigest)
            throw new CustodyRuntimeError('NOT_READY');
          const recommended = feeChoice.kind === 'custom' ? 1e-8 : await readPublicSyscoinFee(scope.network.url, read);
          const rate = chooseUtxoFeeRate(recommended, feeChoice) ?? recommended;
          check();
          const binding = await prepareUtxoReplacement({
            scope,
            predecessor,
            kind: mode,
            feeRateSatoshisPerVbyte: String(utxoFeeRateUnits(rate)),
            isOwnedAddress: address => address === scope.account.address,
            ...utxoReplacementReads(scope, read),
            assertCurrent: check,
          });
          check();
          await assertUnprotected(binding.review.outpoints, check);
          const view = Object.freeze({
            feeSatoshis: binding.review.feeSatoshis,
            outputs: binding.review.outputs,
            replacement: Object.freeze({ txid, mode, previousFeeSatoshis: binding.review.previousFeeSatoshis }),
            transactionOptions: reviewUtxoTransactionOptions(true, false, true),
          });
          review = { expires, binding, predecessor, view };
          return view;
        } finally {
          readController?.abort();
          readController = undefined;
        }
      });
    },
    async feeRecommendations(external?: AbortSignal): Promise<string> {
      return run(async () => {
        const current = revision, expires = now() + REVIEW_MS;
        const check = () => { capture(current, expires)(); if (external?.aborted) throw new CustodyRuntimeError('CANCELLED'); };
        check();
        const abort = () => { if (revision === current) readController?.abort(); };
        external?.addEventListener('abort', abort, { once: true });
        try {
          const read = await ownedRead(check);
          const rate = await readPublicSyscoinFee(scope.network.url, read);
          check();
          return String(utxoFeeRateUnits(rate));
        } finally { external?.removeEventListener('abort', abort); }
      });
    },
    async prepare(
      input: Readonly<{
        recipient: string;
        amount: string;
        max?: boolean;
        asset?: NativeUtxoAsset;
        rbf?: boolean;
        feeChoice?: UtxoFeeChoice;
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
        let rbf: boolean;
        const asset =
          input.asset === undefined
            ? undefined
            : Object.freeze({ ...input.asset });
        const max = input.max === true;
        const feeChoice = snapshotUtxoFeeChoice(input.feeChoice ?? AUTOMATIC_FEE);
        try {
          rbf = snapshotUtxoRbf(input.rbf);
          recipient = normalizeUtxoAddress(input.recipient.trim(), network);
          if (
            !canUseUtxoCustodyAddress(scope.account.address, network) ||
            !canUseUtxoCustodyAddress(recipient, network)
          )
            throw new Error('Unsupported UTXO spending script');
          if (asset) {
            if (
              !supportsSptUtxoChain(network.chainId) ||
              !isPositiveSptGuid(asset.assetGuid) ||
              !isSptDisplaySymbol(asset.symbol)
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
          const { outpoints: retainedOutpoints } =
            await records.fundingExclusions(
              { ...session, assertCurrent: check },
              owner
            );
          const excludedOutpoints = unionUtxoExclusions(
            retainedOutpoints,
            await protectedPoints(check)
          );
          check();
          const rate = feeChoice.kind === 'automatic' || feeChoice.kind === 'medium' ? undefined
            : chooseUtxoFeeRate(feeChoice.kind === 'custom' ? 1e-8 : await readPublicSyscoinFee(scope.network.url, read), feeChoice);
          check();
          const result = await sdk.getEstimateSysTransactionFee(
            {
              amount: amount.builderAmount,
              ...(rate === undefined ? {} : { feeRate: rate }),
              receivingAddress: recipient,
              txOptions: { rbf },
              excludedOutpoints,
              ...(amount.kind === 'spt'
                ? {
                    token: {
                      guid: amount.asset.assetGuid,
                      symbol: amount.asset.symbol,
                    },
                  }
                : {}),
              ...(max && amount.kind === 'native' ? { nativeSweep: true, isMax: true } : {}),
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
          await assertUnprotected(binding.review.outpoints,check);
          assertUtxoBuilderFee(result.fee, binding.review.feeSatoshis);
          const view = Object.freeze({
            transactionOptions: reviewUtxoTransactionOptions(binding.rbf, amount.kind === 'spt', rbf),
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
    async refreshSaved() {
      return run(async () => {
        const check = capture(revision, now() + REVIEW_MS);
        const controller = new AbortController();
        readController = controller;
        try {
          check();
          await reconcileRetainedUtxo({ backendChain: network.backendChain, fetch, owner, records,
            session: { ...session, assertCurrent: check }, signal: controller.signal });
          check();
          return await records.list({ ...session, assertCurrent: check }, owner);
        } finally {
          controller.abort();
          if (readController === controller) readController = undefined;
        }
      });
    },
    async check(txid: string): Promise<'confirmed' | 'seen' | 'unknown'> {
      return run(async () => {
        const check = capture(revision, now() + REVIEW_MS);
        check();
        const controller = new AbortController();
        readController = controller;
        try {
          return await observeRetainedUtxo({
            backendChain: network.backendChain,
            fetch,
            owner,
            records,
            session: { ...session, assertCurrent: check },
            signal: controller.signal,
            txid,
          });
        } finally {
          controller.abort();
          readController = undefined;
        }
      });
    },
    async confirm(view: NativeUtxoReview, credential: NativeOperationCredential): Promise<Readonly<{ txid: string }>> {
      return run(async () => {
        const selected = review;
        if (!selected || view !== selected.view)
          throw new CustodyRuntimeError('NOT_READY');
        const check = capture(revision, selected.expires);
        check();
        const receipt = await authorization.authorize(credential, { psbt: selected.binding.psbt }, check);
        try {
          check();
          if (review !== selected) throw new CustodyRuntimeError('CANCELLED');
          review = undefined;
          const currentSession = { ...session, assertCurrent: check };
          try {
            await assertUnprotected(selected.binding.review.outpoints,check);
            const read = await ownedRead(check);
            if (selected.predecessor) {
              const predecessor = selected.predecessor;
              await observePending(predecessor.txid, read.signal, check);
              const retained = await candidate(predecessor.txid, check);
              if (!retained || retained.signedDigest !== predecessor.signedDigest)
                throw new CustodyRuntimeError('NOT_READY');
            }
            const signed = await authorization.sign(receipt,
              { psbt: selected.binding.psbt },
              read, check
            );
            check();
            const { record } = selected.binding.bindSigned(signed);
            return await submitProtected(record.review.outpoints,check,transport=>submitReviewedUtxo({
              record: {
                owner,
                operation: 'wallet',
                ...(selected.predecessor ? { replacementOf: selected.predecessor.txid } : {}),
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
              signal: readController?.signal,
              fetch:transport,
            }));
          } finally {
            readController?.abort();
            readController = undefined;
          }
        } finally { authorization.release(receipt); }
      });
    },
  });
}

export type NativeUtxoSend = ReturnType<typeof createNativeUtxoSend>;
