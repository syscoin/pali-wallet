import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { ConfirmationModal } from 'components/Modal';
import { useContextualState } from 'hooks/useContextualState';
import { useUtils } from 'hooks/useUtils';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import type {
  RetainedCancellationOutcome,
  RetainedEvmCancellationReview,
} from 'scripts/Background/controllers/evmSignedReplay';
import { RootState } from 'state/store';
import { KeyringAccountType } from 'types/network';
import { formatUnits } from 'utils/ethersV6Compat';
import { getWalletNavigationScope } from 'utils/navigationState';

import { useSmartAccountCancellation } from './useSmartAccountCancellation';
import type { EvmSavedTransaction } from '../../wallet/evmSignedReplay';
import type { SmartAccountReplayIntent } from '../../wallet/smartAccountSignedReplay';

export type SavedTransaction = EvmSavedTransaction & {
  smartAccount?: SmartAccountReplayIntent;
};

type View = {
  busy?: 'prepare' | 'confirm';
  cancellation?: RetainedEvmCancellationReview;
  cancellationHash?: string;
};

/** Public review fields only. Raw bytes and the consumed consent stay in the background. */
export const RetainedTransactionReplay = ({
  hash,
  onRetainedTransaction,
}: {
  hash: string;
  onRetainedTransaction?: (transaction: SavedTransaction | null) => void;
}) => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const network = useSelector((state: RootState) => state.vault.activeNetwork);
  const smartCancellation = useSmartAccountCancellation(hash);
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
  const context = useRef({
    scope,
    scopeRevision: 0,
    generation: 0,
    active: true,
  });
  if (context.current.scope !== scope)
    context.current = {
      scope,
      scopeRevision: context.current.scopeRevision + 1,
      generation: context.current.generation + 1,
      active: true,
    };
  const [retained, setRetained] = useContextualState<SavedTransaction | null>(
    scope,
    null
  );
  const [view, setView] = useContextualState<View>(
    `${scope}:${context.current.scopeRevision}`,
    {}
  );
  const reviewReference = useRef<string>();
  const confirming = useRef(false);
  const cancelReview = (id?: string) => {
    if (id)
      void controllerEmitter(
        ['wallet', 'cancelRetainedEvmCancellationReview'],
        [id],
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
        if (current()) {
          const transaction = result as SavedTransaction | null;
          setRetained(transaction);
          onRetainedTransaction?.(transaction);
        }
      })
      .catch(() => {
        if (current()) {
          setRetained(null);
          onRetainedTransaction?.(null);
        }
      });
    return () => {
      context.current.active = false;
      context.current.generation++;
      cancelReview(reviewReference.current);
      reviewReference.current = undefined;
      confirming.current = false;
    };
  }, [scope, onRetainedTransaction]);

  const close = () => {
    if (confirming.current) return;
    context.current.generation++;
    cancelReview(reviewReference.current);
    reviewReference.current = undefined;
    setView({});
  };
  const prepare = async () => {
    if (confirming.current) return;
    cancelReview(reviewReference.current);
    reviewReference.current = undefined;
    const generation = ++context.current.generation;
    const current = () =>
      context.current.active && context.current.generation === generation;
    setView({ busy: 'prepare' });
    try {
      const cancellation = (await controllerEmitter(
        ['wallet', 'prepareRetainedEvmCancellation'],
        [hash],
        15000,
        false
      )) as RetainedEvmCancellationReview;
      if (!current()) {
        cancelReview(cancellation.id);
        return;
      }
      reviewReference.current = cancellation.id;
      setView({ cancellation });
    } catch (error) {
      if (current()) {
        setView({});
        alert.error(
          t(
            error instanceof Error &&
              error.message === 'Insufficient funds for reviewed EVM transfer'
              ? 'send.insufficientFundsForGas'
              : 'transactions.cancelFeeUnavailable'
          )
        );
      }
    }
  };
  const displayed = view.cancellation;
  useEffect(() => {
    const reference = reviewReference.current;
    if (!displayed || !reference || view.busy === 'confirm') return;
    const generation = context.current.generation;
    const timer = setTimeout(() => {
      if (
        !context.current.active ||
        context.current.generation !== generation ||
        reviewReference.current !== reference ||
        confirming.current
      )
        return;
      cancelReview(reference);
      reviewReference.current = undefined;
      setView({});
      alert.warning(t('transactions.replay.cancellationExpired'));
    }, displayed.validForMs);
    return () => clearTimeout(timer);
  }, [displayed?.id, view.busy, scope, t]);

  const confirm = async () => {
    const reference = reviewReference.current;
    if (
      !displayed ||
      !reference ||
      confirming.current ||
      reference !== displayed.id
    )
      return;
    confirming.current = true;
    const generation = context.current.generation;
    const current = () =>
      context.current.active && context.current.generation === generation;
    setView({ cancellation: displayed, busy: 'confirm' });
    try {
      // A confirm must never be retried by the service-worker connection helper.
      const result = (await controllerEmitter(
        ['wallet', 'confirmRetainedEvmCancellation'],
        [reference],
        30000,
        false
      )) as RetainedCancellationOutcome;
      if (current()) {
        if (result.status === 'not-dispatched') {
          setView({});
          alert.error(t('transactions.transactionCancelFailed'));
        } else {
          setView({ cancellationHash: result.hash });
          const message = t(
            result.status === 'submitted'
              ? 'transactions.transactionCancelSubmitted'
              : 'transactions.replay.unknown',
            { payer: displayed.from }
          );
          const notice = `${message} ${t('transactions.replay.hash')}: ${
            result.hash
          }`;
          if (result.status === 'submitted')
            alert.success(notice, undefined, current);
          else alert.warning(notice);
        }
      }
    } catch (error) {
      if (current()) {
        setView({});
        if (
          error instanceof Error &&
          error.message === 'Insufficient funds for reviewed EVM transfer'
        )
          alert.error(t('send.insufficientFundsForGas'));
        else alert.warning(t('transactions.replay.checkActivity'));
      }
    } finally {
      if (current()) {
        reviewReference.current = undefined;
        confirming.current = false;
      }
    }
  };
  if (!retained) return null;
  const collectible =
    retained.hash === hash.toLowerCase() &&
    retained.collectibleTransfer?.chainId === String(network.chainId)
      ? retained.collectibleTransfer
      : undefined;
  const currency = network.currency?.toUpperCase();
  const rows = displayed
    ? [
        [
          t('transactions.replay.network'),
          `${network.label} · ${displayed.chainId}`,
        ],
        [t('transactions.replay.from'), displayed.from],
        [t('transactions.replay.original'), displayed.hash],
        [t('transactions.replay.nonce'), String(displayed.nonce)],
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
      {(canSignRetainedCancellation || smartCancellation.available) &&
        retained.hash === hash.toLowerCase() &&
        retained.cancellationUnavailable !== true &&
        !view.cancellationHash &&
        !retained.smartAccount?.cancellation &&
        retained.operation !== 'cancel' &&
        (retained.type === 0 || retained.type === 2) &&
        ['signed', 'attempted', 'submitted'].includes(retained.phase) && (
          <button
            type="button"
            onClick={() =>
              smartCancellation.available
                ? void smartCancellation.request()
                : void prepare()
            }
            disabled={Boolean(view.busy) || smartCancellation.busy}
            className="mt-2 w-full rounded-lg border border-bkg-white200 px-4 py-3 text-sm text-white hover:bg-alpha-whiteAlpha50 disabled:opacity-60"
          >
            {t('header.cancelTx')}
          </button>
        )}
      {smartCancellation.content}
      {displayed && (
        <ConfirmationModal
          show
          title={t('header.cancelTx')}
          description={t('transactions.replay.cancellationDescription', {
            fee: formatUnits(displayed.maximumFee, 18),
            currency,
          })}
          buttonText={t('buttons.confirm')}
          onClose={close}
          onClick={() => void confirm()}
          isButtonLoading={view.busy === 'confirm'}
        >
          <dl className="mt-4 space-y-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-brand-gray200">{label}</dt>
                <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </ConfirmationModal>
      )}
    </div>
  );
};
