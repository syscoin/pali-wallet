import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmationModal } from 'components/Modal';
import { getWalletBrowserTabId } from 'pages/Send/hardwareSendDraft';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import {
  HARDWARE_UTXO_REPLACEMENT_TIMEOUT_MS,
  type ExtensionUtxoReplacementActions,
  type ExtensionUtxoReplacementReview,
} from 'scripts/Background/controllers/utxoReplacementReview';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';

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

export function UtxoReplacementActions({
  currency,
  txid,
}: {
  currency: string;
  txid: string;
}) {
  const { t } = useTranslation();
  const [actions, setActions] = useState<ExtensionUtxoReplacementActions>();
  const [review, setReview] = useState<ExtensionUtxoReplacementReview>();
  const [busy, setBusy] = useState(false);
  const [walletTab, setWalletTab] = useState<boolean>();
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
    const lifetime = new AbortController();
    void controllerEmitter(
      ['wallet', 'getUtxoReplacementActions'],
      [txid],
      15_000
    )
      .then((result) => {
        if (!lifetime.signal.aborted)
          setActions(result as ExtensionUtxoReplacementActions);
      })
      .catch(() => undefined);
    return () => {
      active.current = false;
      lifetime.abort();
      if (reviewId.current) discardReview(reviewId.current);
      reviewId.current = undefined;
    };
  }, [txid]);

  useEffect(() => {
    if (!actions?.hardware) return;
    let current = true;
    void getWalletBrowserTabId()
      .then((id) => {
        if (current) setWalletTab(id !== undefined);
      })
      .catch(() => {
        if (current) setWalletTab(false);
      });
    return () => {
      current = false;
    };
  }, [actions?.hardware]);

  const openWalletTab = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await openUtxoReplacementTab(txid);
    } catch {
      if (active.current) setFeedback('unavailable');
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
      setFeedback('reviewExpired');
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
        [txid, kind],
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
      if (active.current) setFeedback('unavailable');
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
      if (active.current)
        setOutcome({ status: 'submitted', txid: response.txid });
    } catch (error) {
      if (!active.current) return;
      if (error?.transactionNotBroadcast === true) {
        setFeedback('unavailable');
      } else {
        const signedTxid =
          typeof error?.txid === 'string' && /^[0-9a-f]{64}$/.test(error.txid)
            ? error.txid
            : undefined;
        setOutcome({ status: 'unknown', txid: signedTxid });
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

  if (
    (!actions?.speedUp && !actions?.cancel && !outcome) ||
    (actions?.hardware && walletTab === undefined)
  )
    return null;
  const amount = (satoshis: string) =>
    `${formatSyscoinValue(satoshis)} ${currency.toUpperCase()}`;

  return (
    <div className="my-3 min-w-0">
      {outcome ? (
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
      ) : actions?.hardware && walletTab === false ? (
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
      {feedback && (
        <p role="alert" className="mt-2 text-sm text-brand-gray200">
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
