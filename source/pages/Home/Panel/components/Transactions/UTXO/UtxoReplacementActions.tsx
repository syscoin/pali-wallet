import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmationModal } from 'components/Modal';
import {
  TransactionOptionsMenu,
  TransactionOptionsMenuItem,
} from 'components/TransactionOptions/TransactionOptionsMenu';
import type { useUtils } from 'hooks/useUtils';
import { getWalletBrowserTabId } from 'pages/Send/hardwareSendDraft';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import {
  HARDWARE_UTXO_REPLACEMENT_TIMEOUT_MS,
  type ExtensionUtxoReplacementActions,
  type ExtensionUtxoReplacementReview,
} from 'scripts/Background/controllers/utxoReplacementReview';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import { getWalletNavigationScope } from 'utils/navigationState';

import { openUtxoReplacementTab } from './utxoReplacementNavigation';

const buttonClass =
  'rounded-lg border border-bkg-white200 px-3 py-2 text-sm text-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60';

const discardReview = (reviewId: string) =>
  void controllerEmitter(
    ['wallet', 'discardUtxoReplacement'],
    [reviewId],
    10_000,
    false
  ).catch(() => undefined);

type WalletScope = ReturnType<typeof getWalletNavigationScope>;
type ReplacementKind = ExtensionUtxoReplacementReview['kind'];
type RowMenu = {
  alert: Pick<
    ReturnType<typeof useUtils>['alert'],
    'success' | 'error' | 'info'
  >;
  onDetails: () => void;
  onExplorer?: () => void;
  scope: WalletScope;
};

function useReplacementActions(
  txid: string,
  enabled: boolean,
  scope?: WalletScope
) {
  const [result, setResult] = useState<{
    actions: ExtensionUtxoReplacementActions;
    needsWalletTab: boolean;
  }>();
  const account = scope?.account;
  const network = scope?.network;
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void (async () => {
      try {
        const method = ['wallet', 'getUtxoReplacementActions'] as const;
        const actions = (await (account !== undefined && network !== undefined
          ? controllerEmitter(
              [...method],
              [txid, { account, network }],
              15_000,
              false
            )
          : controllerEmitter(
              [...method],
              [txid],
              15_000
            ))) as ExtensionUtxoReplacementActions;
        if (!current || (actions?.speedUp !== true && actions?.cancel !== true))
          return;
        const needsWalletTab =
          actions.hardware === true &&
          (await getWalletBrowserTabId().catch(() => undefined)) === undefined;
        if (current) setResult({ actions, needsWalletTab });
      } catch {
        // Only a successful eligibility lookup exposes replacement actions.
      }
    })();
    return () => {
      current = false;
    };
  }, [account, network, enabled, txid]);
  return result;
}

function UtxoReplacementMenuItems({
  busy,
  onOpenWalletTab,
  onPrepare,
  scope,
  txid,
}: {
  busy: boolean;
  onOpenWalletTab: () => void;
  onPrepare: (kind: ReplacementKind) => void;
  scope: WalletScope;
  txid: string;
}) {
  const { t } = useTranslation();
  const { actions, needsWalletTab } =
    useReplacementActions(txid, true, scope) ?? {};

  if (needsWalletTab)
    return (
      <TransactionOptionsMenuItem
        icon="link"
        disabled={busy}
        onClick={onOpenWalletTab}
      >
        {t('send.openWalletTab')}
      </TransactionOptionsMenuItem>
    );
  return (
    <>
      {actions?.speedUp === true && (
        <TransactionOptionsMenuItem
          icon="speed-up"
          disabled={busy}
          onClick={() => onPrepare('speed-up')}
        >
          {t('header.speedUp')}
        </TransactionOptionsMenuItem>
      )}
      {actions?.cancel === true && (
        <TransactionOptionsMenuItem
          icon="cancel"
          disabled={busy}
          onClick={() => onPrepare('cancel')}
        >
          {t('buttons.cancel')}
        </TransactionOptionsMenuItem>
      )}
    </>
  );
}

export function UtxoReplacementActions({
  currency,
  menu,
  txid,
}: {
  currency: string;
  menu?: RowMenu;
  txid: string;
}) {
  const { t } = useTranslation();
  const { actions, needsWalletTab } = useReplacementActions(txid, !menu) ?? {};
  const [review, setReview] = useState<ExtensionUtxoReplacementReview>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'unavailable' | 'reviewExpired'>();
  const [outcome, setOutcome] = useState<{
    status: 'submitted' | 'unknown';
    txid?: string;
  }>();
  const [status, setStatus] = useState<'seen' | 'confirmed' | 'unknown'>();
  const active = useRef(false);
  const pending = useRef(false);
  const reviewId = useRef<string>();

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (reviewId.current) discardReview(reviewId.current);
      reviewId.current = undefined;
    };
  }, [txid]);

  const reportReviewFailure = (reason: 'unavailable' | 'reviewExpired') => {
    if (menu)
      menu.alert.error(
        t(`transactions.utxoReplacement.${reason}`),
        undefined,
        () => active.current
      );
    else setFeedback(reason);
  };

  const openWalletTab = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await openUtxoReplacementTab(txid);
    } catch {
      if (active.current) reportReviewFailure('unavailable');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const closeReview = () => {
    if (pending.current) return;
    if (reviewId.current) discardReview(reviewId.current);
    reviewId.current = undefined;
    setReview(undefined);
  };

  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(() => {
      if (pending.current || reviewId.current !== review.id) return;
      closeReview();
      reportReviewFailure('reviewExpired');
    }, review.validForMs);
    return () => clearTimeout(timer);
  }, [review]);

  const prepare = async (kind: ExtensionUtxoReplacementReview['kind']) => {
    if (pending.current || reviewId.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const prepared = (await controllerEmitter(
        ['wallet', 'prepareUtxoReplacement'],
        menu ? [txid, kind, menu.scope] : [txid, kind],
        35_000,
        false
      )) as ExtensionUtxoReplacementReview;
      if (!active.current) {
        discardReview(prepared.id);
        return;
      }
      reviewId.current = prepared.id;
      setReview(prepared);
    } catch {
      if (active.current) reportReviewFailure('unavailable');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  const confirm = async () => {
    if (!review || pending.current || reviewId.current !== review.id) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = (await controllerEmitter(
        ['wallet', 'confirmUtxoReplacement'],
        [review.id],
        review.hardware ? HARDWARE_UTXO_REPLACEMENT_TIMEOUT_MS : 65_000,
        false
      )) as { txid: string };
      if (active.current) {
        setOutcome({ status: 'submitted', txid: response.txid });
        menu?.alert.success(
          t('transactions.utxoReplacement.submitted'),
          undefined,
          () => active.current
        );
      }
    } catch (error) {
      if (!active.current) return;
      if (error?.transactionNotBroadcast === true) {
        reportReviewFailure('unavailable');
      } else {
        const signedTxid =
          typeof error?.txid === 'string' && /^[0-9a-f]{64}$/.test(error.txid)
            ? error.txid
            : undefined;
        setOutcome({ status: 'unknown', txid: signedTxid });
        menu?.alert.info(
          t('transactions.replay.unknown'),
          undefined,
          () => active.current
        );
      }
    } finally {
      pending.current = false;
      reviewId.current = undefined;
      if (active.current) {
        setReview(undefined);
        setBusy(false);
      }
    }
  };

  const check = async () => {
    if (pending.current || !outcome?.txid) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await controllerEmitter(
        ['wallet', 'checkRetainedUtxoTransfer'],
        [outcome.txid],
        15_000,
        false
      );
      if (active.current)
        setStatus(
          result === 'confirmed' || result === 'seen' ? result : 'unknown'
        );
    } catch {
      if (active.current) setStatus('unknown');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };

  if (!menu && !actions && !outcome) return null;
  const amount = (satoshis: string) =>
    `${formatSyscoinValue(satoshis)} ${currency.toUpperCase()}`;

  return (
    <div className={menu ? undefined : 'my-3 min-w-0'}>
      {menu && (
        <TransactionOptionsMenu
          pending
          onDetails={menu.onDetails}
          onExplorer={menu.onExplorer}
        >
          {!outcome && (
            <UtxoReplacementMenuItems
              busy={busy || !!review}
              onOpenWalletTab={() => void openWalletTab()}
              onPrepare={(kind) => void prepare(kind)}
              scope={menu.scope}
              txid={txid}
            />
          )}
        </TransactionOptionsMenu>
      )}
      {menu ? null : outcome ? (
        <div className="space-y-2 text-sm">
          <p role="status">
            {t(
              outcome.status === 'unknown' && !outcome.txid
                ? 'transactions.replay.unknown'
                : `transactions.utxoReplacement.${outcome.status}`
            )}
          </p>
          {outcome.txid && (
            <p className="break-all font-mono text-xs">{outcome.txid}</p>
          )}
          {outcome.txid && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void check()}
            >
              {t('transactions.utxoReplacement.checkStatus')}
            </button>
          )}
          {status && (
            <p role="status">
              {t(
                status === 'confirmed'
                  ? 'send.confirmed'
                  : status === 'seen'
                  ? 'send.pending'
                  : 'settings.unavailable'
              )}
            </p>
          )}
        </div>
      ) : needsWalletTab ? (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void openWalletTab()}
        >
          {t('send.openWalletTab')}
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions?.speedUp && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void prepare('speed-up')}
            >
              {t('header.speedUp')}
            </button>
          )}
          {actions?.cancel && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void prepare('cancel')}
            >
              {t('header.cancelTx')}
            </button>
          )}
        </div>
      )}
      {!menu && feedback && (
        <p role="alert" className="mt-2 text-sm text-warning-error">
          {t(`transactions.utxoReplacement.${feedback}`)}
        </p>
      )}
      {review && (
        <ConfirmationModal
          compact
          describeDialog
          show
          title={t(
            review.kind === 'cancel' ? 'header.cancelTx' : 'header.speedUp'
          )}
          description={t(
            review.kind === 'cancel'
              ? 'transactions.utxoReplacement.cancelDescription'
              : 'transactions.utxoReplacement.speedUpDescription'
          )}
          buttonText={t('buttons.confirm')}
          onClose={closeReview}
          onClick={() => void confirm()}
          isButtonLoading={busy}
        >
          <dl className="mt-3 rounded-xl bg-alpha-whiteAlpha100 px-3 py-2">
            <dt className="text-brand-gray200">{t('send.networkFee')}</dt>
            <dd className="break-words text-base font-semibold text-white">
              {amount(review.feeSatoshis)}
            </dd>
          </dl>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-brand-gray200">
              {t('send.details')}
            </summary>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="text-brand-gray200">
                  {t('transactions.utxoReplacement.originalTransaction')}
                </dt>
                <dd className="break-all font-mono">{txid}</dd>
              </div>
              <div>
                <dt className="text-brand-gray200">
                  {t('transactions.utxoReplacement.originalFee')}
                </dt>
                <dd>{amount(review.previousFeeSatoshis)}</dd>
              </div>
              {review.outputs.map((output, index) => (
                <div key={index}>
                  <dt className="text-brand-gray200">
                    {t('transactions.outputNumber', { index: index + 1 })}
                  </dt>
                  <dd className="break-all">{output.address}</dd>
                  <dd>{amount(output.amountSatoshis)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </ConfirmationModal>
      )}
    </div>
  );
}
