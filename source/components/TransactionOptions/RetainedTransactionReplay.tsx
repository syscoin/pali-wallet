import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { AssetTransferSummary } from '../../pages/Send/components/AssetTransferSummary';
import { createAssetTransferDisplay } from '../../shared/assetTransferDisplay';
import { formatTokenUnits } from '../../shared/erc20';
import { ConfirmationModal } from 'components/Modal';
import { useContextualState } from 'hooks/useContextualState';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type { RetainedEvmCancellationReview } from 'scripts/Background/controllers/evmSignedReplay';
import { RootState } from 'state/store';
import { KeyringAccountType } from 'types/network';
import { formatUnits } from 'utils/ethersV6Compat';
import { getWalletNavigationScope } from 'utils/navigationState';

import type {
  EvmReplayPreparation,
  EvmReplayReview,
  EvmReplayCandidate,
  EvmSavedTransaction,
} from '../../wallet/evmSignedReplay';
import type {
  SmartAccountReplayIntent,
  SmartAccountReplayPreparation,
} from '../../wallet/smartAccountSignedReplay';

type ReplayReview = EvmReplayReview & {
  smartAccount?: SmartAccountReplayIntent;
};
type SavedTransaction = EvmSavedTransaction & {
  smartAccount?: SmartAccountReplayIntent;
};

type View = {
  additionalPredecessors?: readonly EvmReplayCandidate[];
  busy?: 'prepare' | 'confirm';
  cancellation?: RetainedEvmCancellationReview;
  cancellationHash?: string;
  loadingPrevious?: boolean;
  message?: string;
  predecessorCursor?: string | null;
  previousError?: boolean;
  review?: ReplayReview;
};

type ReviewReference = Readonly<{ id: string; kind: 'cancel' | 'replay' }>;

/** Public review fields only. Raw bytes and the consumed consent stay in the background. */
export const RetainedTransactionReplay = ({ hash }: { hash: string }) => {
  const { t } = useTranslation();
  const smartAccountSelected = useSelector(
    ({ vault }: RootState) =>
      vault.activeAccount.type === KeyringAccountType.SmartAccount
  );
  const network = useSelector((state: RootState) => state.vault.activeNetwork);
  const walletScope = useSelector(getWalletNavigationScope, shallowEqual);
  const canSignRetainedCancellation = useSelector(({ vault }: RootState) => {
    const account = vault.activeAccount;
    return (
      account?.type === KeyringAccountType.HDAccount ||
      (account?.type === KeyringAccountType.Imported &&
        !!vault.accounts[account.type]?.[account.id]?.xprv)
    );
  });
  const scope = `${walletScope.account}:${
    walletScope.network
  }:${hash.toLowerCase()}`;
  const context = useRef({ scope, generation: 0, active: true });
  if (context.current.scope !== scope)
    context.current = {
      scope,
      generation: context.current.generation + 1,
      active: true,
    };
  const [retained, setRetained] = useContextualState<SavedTransaction | null>(
    scope,
    null
  );
  const [view, setView] = useContextualState<View>(scope, {});
  const reviewReference = useRef<ReviewReference>();
  const confirming = useRef(false);
  const cancelReview = (review?: ReviewReference) => {
    if (review)
      void controllerEmitter(
        [
          'wallet',
          review.kind === 'cancel'
            ? 'cancelRetainedEvmCancellationReview'
            : 'cancelEvmSignedReplay',
        ],
        [review.id],
        10000,
        false
      ).catch(() => undefined);
  };
  useEffect(() => {
    context.current.active = true;
    const generation = context.current.generation;
    const current = () =>
      context.current.active && context.current.generation === generation;
    void controllerEmitter(['wallet', 'getSavedEvmTransaction'], [hash])
      .then((result) => {
        if (current()) setRetained(result as SavedTransaction | null);
      })
      .catch(() => {
        if (current()) setRetained(null);
      });
    return () => {
      context.current.active = false;
      context.current.generation++;
      cancelReview(reviewReference.current);
      reviewReference.current = undefined;
      confirming.current = false;
    };
  }, [scope]);

  const close = () => {
    if (confirming.current) return;
    context.current.generation++;
    cancelReview(reviewReference.current);
    reviewReference.current = undefined;
    setView({});
  };
  const prepare = async (
    selectedHash = hash,
    kind: ReviewReference['kind'] = 'replay',
    parentReviewId?: string
  ) => {
    if (confirming.current) return;
    const priorReview = reviewReference.current;
    if (!parentReviewId) cancelReview(priorReview);
    reviewReference.current = undefined;
    const generation = ++context.current.generation;
    const current = () =>
      context.current.active && context.current.generation === generation;
    setView({ busy: 'prepare' });
    try {
      const response = await controllerEmitter(
        [
          'wallet',
          parentReviewId
            ? 'prepareSmartAccountPredecessor'
            : kind === 'cancel'
            ? 'prepareRetainedEvmCancellation'
            : 'prepareEvmSignedReplay',
        ],
        parentReviewId ? [parentReviewId, selectedHash] : [selectedHash],
        15000,
        false
      );
      if (kind === 'cancel') {
        const cancellation = response as RetainedEvmCancellationReview;
        const reference = { id: cancellation.id, kind };
        if (!current()) {
          cancelReview(reference);
          return;
        }
        reviewReference.current = reference;
        setView({ cancellation });
        return;
      }
      const result = response as
        | EvmReplayPreparation
        | SmartAccountReplayPreparation;
      if (!current()) {
        if (result?.status === 'review')
          cancelReview({ id: result.review.id, kind });
        return;
      }
      if (result.status === 'review') {
        reviewReference.current = { id: result.review.id, kind };
        setView({
          review: result.review,
          predecessorCursor:
            result.review.predecessorCount > result.review.predecessors.length
              ? result.review.predecessors.at(-1)?.hash
              : null,
        });
      } else {
        setView({
          message: t(
            result.status === 'inspect-only'
              ? 'transactions.replay.unavailable'
              : `transactions.replay.${result.status}`
          ),
        });
      }
    } catch (error) {
      if (parentReviewId) cancelReview(priorReview);
      if (current())
        setView({
          message: t(
            kind === 'cancel'
              ? error instanceof Error &&
                error.message === 'Insufficient funds for reviewed EVM transfer'
                ? 'send.insufficientFundsForGas'
                : 'transactions.cancelFeeUnavailable'
              : 'transactions.replay.unavailable'
          ),
        });
    }
  };
  const displayed = view.cancellation ?? view.review;
  useEffect(() => {
    const reference = reviewReference.current;
    if (!displayed || !reference || view.busy === 'confirm') return;
    const timer = setTimeout(() => {
      if (reviewReference.current !== reference || confirming.current) return;
      cancelReview(reference);
      reviewReference.current = undefined;
      setView({
        message: t(
          reference.kind === 'cancel'
            ? 'transactions.replay.cancellationExpired'
            : 'transactions.replay.expired'
        ),
      });
    }, displayed.validForMs);
    return () => clearTimeout(timer);
  }, [displayed?.id, view.busy, scope, t]);

  const confirm = async () => {
    const reference = reviewReference.current;
    if (
      !displayed ||
      !reference ||
      confirming.current ||
      reference.id !== displayed.id
    )
      return;
    confirming.current = true;
    const generation = context.current.generation;
    const current = () =>
      context.current.active && context.current.generation === generation;
    setView({
      review: view.review,
      cancellation: view.cancellation,
      busy: 'confirm',
    });
    try {
      // A confirm must never be retried by the service-worker connection helper.
      const result = (await controllerEmitter(
        [
          'wallet',
          reference.kind === 'cancel'
            ? 'confirmRetainedEvmCancellation'
            : 'confirmEvmSignedReplay',
        ],
        [reference.id],
        30000,
        false
      )) as
        | { hash: string; status: 'submitted' | 'unknown' }
        | { status: 'not-dispatched' };
      if (current()) {
        if (result.status === 'not-dispatched') {
          setView({ message: t('transactions.transactionCancelFailed') });
        } else {
          const cancellation = reference.kind === 'cancel';
          setView({
            ...(cancellation ? { cancellationHash: result.hash } : {}),
            message: t(
              cancellation && result.status === 'submitted'
                ? 'transactions.transactionCancelSubmitted'
                : `transactions.replay.${result.status}`
            ),
          });
        }
      }
    } catch (error) {
      if (current())
        setView({
          message: t(
            reference.kind === 'cancel' &&
              error instanceof Error &&
              error.message === 'Insufficient funds for reviewed EVM transfer'
              ? 'send.insufficientFundsForGas'
              : 'transactions.replay.checkActivity'
          ),
        });
    } finally {
      if (current()) {
        reviewReference.current = undefined;
        confirming.current = false;
      }
    }
  };
  const loadPrevious = async () => {
    const review = view.review,
      cursor = view.predecessorCursor;
    if (!review || !cursor || view.loadingPrevious || confirming.current)
      return;
    const generation = context.current.generation;
    const current = () =>
      context.current.active &&
      context.current.generation === generation &&
      reviewReference.current?.id === review.id;
    setView((previous) => ({
      ...previous,
      loadingPrevious: true,
      previousError: false,
    }));
    try {
      const page = (await controllerEmitter(
        [
          'wallet',
          smartAccountSelected
            ? 'getSmartAccountPredecessors'
            : 'getSavedEvmTransactions',
        ],
        smartAccountSelected
          ? [review.id, cursor, 20]
          : [cursor, 20, Number(review.missingNonce)]
      )) as { nextCursor: string | null; transactions: EvmReplayCandidate[] };
      if (!current()) return;
      setView((previous) => ({
        ...previous,
        loadingPrevious: false,
        predecessorCursor: page.nextCursor,
        additionalPredecessors: [
          ...(previous.additionalPredecessors ?? []),
          ...page.transactions,
        ],
      }));
    } catch {
      if (current())
        setView((previous) => ({
          ...previous,
          loadingPrevious: false,
          previousError: true,
        }));
    }
  };
  if (!retained) return null;
  const collectible =
    retained.hash === hash.toLowerCase() &&
    retained.collectibleTransfer?.chainId === String(network.chainId)
      ? retained.collectibleTransfer
      : undefined;
  const review = view.review;
  const cancellation = view.cancellation;
  const smart = review?.smartAccount;
  const inner =
    smart?.executions?.length === 1 ? smart.executions[0] : undefined;
  const reviewData = inner?.data;
  const dataBytes =
    reviewData === undefined
      ? review?.dataBytes ?? 0
      : (reviewData.length - 2) / 2;
  const selector =
    reviewData === undefined
      ? review?.selector
      : reviewData.length >= 10
      ? reviewData.slice(0, 10)
      : null;
  const currency = network.currency?.toUpperCase();
  const rows = cancellation
    ? [
        [
          t('transactions.replay.network'),
          `${network.label} · ${cancellation.chainId}`,
        ],
        [t('transactions.replay.from'), cancellation.from],
        [t('transactions.replay.original'), cancellation.hash],
        [t('transactions.replay.nonce'), String(cancellation.nonce)],
      ]
    : review
    ? [
        [
          t('transactions.replay.operationLabel'),
          t(`transactions.replay.operation.${review.operation}`),
        ],
        [
          t('transactions.replay.network'),
          `${network.label} · ${review.chainId}`,
        ],
        [t('transactions.replay.from'), smart?.account ?? review.from],
        ...(smart ? [[t('mobile.infrastructure.feePayer'), review.from]] : []),
        ...(!smart || inner
          ? [
              [
                t('transactions.replay.to'),
                inner?.target ??
                  (smart ? smart.account : review.to) ??
                  t('transactions.replay.creation'),
              ],
              [
                t('transactions.replay.amount'),
                `${formatUnits(inner?.value ?? review.value, 18)} ${currency}`,
              ],
            ]
          : []),
        [
          t('transactions.replay.maximumFee'),
          `${formatUnits(review.maximumFee, 18)} ${currency}`,
        ],
        [t('transactions.replay.nonce'), review.nonce],
        [t('transactions.replay.hash'), review.hash],
        ...(review.tokenTransfer
          ? [
              [
                t('transactions.replay.tokenRecipient'),
                review.tokenTransfer.recipient,
              ],
              [
                t('transactions.replay.tokenAmount'),
                review.tokenTransfer.token
                  ? `${formatTokenUnits(
                      review.tokenTransfer.amountUnits,
                      review.tokenTransfer.token.decimals
                    )} ${review.tokenTransfer.token.symbol}`
                  : `${review.tokenTransfer.amountUnits} ${t(
                      'transactions.replay.rawUnits'
                    )}`,
              ],
            ]
          : []),
        ...(review.collectibleTransfer
          ? [
              [
                t('transactions.tokenStandard'),
                review.collectibleTransfer.tokenStandard,
              ],
              [
                t('settings.contractAddress'),
                review.collectibleTransfer.contractAddress,
              ],
              [
                t('transactions.replay.tokenRecipient'),
                review.collectibleTransfer.recipient,
              ],
              [t('send.tokenId'), review.collectibleTransfer.tokenId],
              [
                t('transactions.replay.tokenAmount'),
                review.collectibleTransfer.amountUnits,
              ],
            ]
          : []),
        ...(dataBytes
          ? [
              [
                t('transactions.replay.data'),
                `${dataBytes} ${t('transactions.replay.bytes')}${
                  selector ? ` · ${selector}` : ''
                }`,
              ],
            ]
          : []),
        ...(review.accessListEntries
          ? [
              [
                t('transactions.replay.accessList'),
                String(review.accessListEntries),
              ],
            ]
          : []),
        ...(review.originalHash
          ? [[t('transactions.replay.original'), review.originalHash]]
          : []),
      ]
    : [];
  return (
    <div className="my-4 min-w-0">
      {collectible && (
        <section className="mb-4 min-w-0 text-sm">
          <h3>{t('transactions.replay.operation.erc721')}</h3>
          <p>{collectible.tokenStandard}</p>
          <dl className="mt-2 space-y-2">
            {[
              [t('send.tokenId'), collectible.tokenId],
              [t('transactions.replay.tokenAmount'), collectible.amountUnits],
              [t('settings.contractAddress'), collectible.contractAddress],
              [t('transactions.replay.tokenRecipient'), collectible.recipient],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <button
        type="button"
        onClick={() => void prepare()}
        disabled={Boolean(view.busy)}
        className="w-full rounded-lg border border-bkg-white200 px-4 py-3 text-sm text-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60"
      >
        {view.busy === 'prepare'
          ? t('buttons.loading')
          : t('transactions.replay.review')}
      </button>
      {canSignRetainedCancellation &&
        retained.hash === hash.toLowerCase() &&
        !view.cancellationHash &&
        retained.operation !== 'cancel' &&
        (retained.type === 0 || retained.type === 2) &&
        ['signed', 'attempted', 'submitted'].includes(retained.phase) && (
          <button
            type="button"
            onClick={() => void prepare(hash, 'cancel')}
            disabled={Boolean(view.busy)}
            className="mt-2 w-full rounded-lg border border-bkg-white200 px-4 py-3 text-sm text-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60"
          >
            {t('transactions.replay.reviewCancellation')}
          </button>
        )}
      {view.message && (
        <div
          role="status"
          className="mt-2 break-words text-sm text-brand-gray200"
        >
          <p>{view.message}</p>
          {view.cancellationHash && (
            <p className="mt-1 break-all">
              {t('transactions.replay.hash')}: {view.cancellationHash}
            </p>
          )}
        </div>
      )}
      {displayed && (
        <ConfirmationModal
          show
          describeDialog={!cancellation}
          title={t(
            cancellation ? 'header.cancelTx' : 'transactions.replay.title'
          )}
          description={
            cancellation
              ? t('transactions.replay.cancellationDescription', {
                  fee: formatUnits(cancellation.maximumFee, 18),
                  currency,
                })
              : `${t('transactions.replay.description')} ${t(
                  'transactions.replay.sameNonceWarning'
                )}`
          }
          buttonText={t(
            cancellation ? 'buttons.confirm' : 'transactions.replay.resend'
          )}
          onClose={close}
          onClick={() => void confirm()}
          isButtonLoading={view.busy === 'confirm'}
        >
          <dl className="mt-4 space-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-brand-gray200">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {smart?.executions?.map((call, index) =>
            call.assetTransfer ? (
              <section key={index}>
                <AssetTransferSummary
                  compact
                  transfer={createAssetTransferDisplay(call.assetTransfer)}
                />
                {call.value !== '0' && (
                  <p className="mt-2 text-sm">
                    {t('assetTransfer.nativeValue')}:{' '}
                    {formatUnits(call.value, 18)} {currency}
                  </p>
                )}
              </section>
            ) : smart.executions!.length > 1 ? (
              <section
                key={index}
                className="mt-4 rounded-lg bg-bkg-2 p-3 text-sm"
              >
                <p>
                  {t(
                    call.data === '0x'
                      ? 'transactions.methodNames.transfer'
                      : 'mobile.dappConsent.transactionReview.contractInteraction'
                  )}
                </p>
                <p className="mt-2 break-all">{call.target}</p>
                <p className="mt-1">
                  {formatUnits(call.value, 18)} {currency}
                </p>
                {call.data !== '0x' && (
                  <p className="mt-1 break-all">
                    {call.data.slice(0, 10)} · {(call.data.length - 2) / 2}{' '}
                    {t('transactions.replay.bytes')}
                  </p>
                )}
              </section>
            ) : null
          )}
          {review?.missingNonce !== undefined && (
            <div className="mt-4 border-t border-bkg-white200 pt-4">
              <p className="text-sm text-brand-gray200">
                {t('transactions.replay.previousNeeded', {
                  nonce: review.missingNonce,
                })}
              </p>
              {[
                ...review.predecessors,
                ...(view.additionalPredecessors ?? []),
              ].map((previous) => (
                <button
                  key={previous.hash}
                  type="button"
                  disabled={Boolean(view.busy)}
                  onClick={() =>
                    void prepare(
                      previous.hash,
                      'replay',
                      smartAccountSelected ? review.id : undefined
                    )
                  }
                  className="mt-2 w-full rounded border border-bkg-white200 p-3 text-left text-xs [overflow-wrap:anywhere]"
                >
                  {t('transactions.replay.previous')} ·{' '}
                  {t(`transactions.replay.operation.${previous.operation}`)}
                  <br />
                  {previous.hash}
                </button>
              ))}
              {!review.predecessors.length && (
                <p className="mt-2 text-sm">
                  {t('transactions.replay.previousMissing')}
                </p>
              )}
              {view.predecessorCursor && (
                <button
                  type="button"
                  disabled={Boolean(view.busy) || view.loadingPrevious}
                  onClick={() => void loadPrevious()}
                  className="mt-3 min-h-[44px] w-full rounded border border-bkg-white200 px-3 text-sm"
                >
                  {view.loadingPrevious
                    ? t('buttons.loading')
                    : t('buttons.loadMore')}
                </button>
              )}
              {view.previousError && (
                <p role="status" className="mt-2 text-sm">
                  {t('transactions.replay.unavailable')}
                </p>
              )}
            </div>
          )}
        </ConfirmationModal>
      )}
    </div>
  );
};
