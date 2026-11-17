import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmationModal } from 'components/index';
import { formatEther } from 'utils/ethersV6Compat';

type FeeReview = Readonly<{
  id: string;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  transaction: ReturnType<typeof snapshotPreparedEvmTransaction>;
  validForMs: number;
}>;
export type SettingsFeeReviewResult = Readonly<{
  claimHash?: string;
  contractName?: string;
  feeReview?: unknown;
}>;
type PendingReview = {
  account: string;
  assertCurrent(): void;
  expires: number;
  label: string;
  quote: FeeReview;
  resolve(id: string | null): void;
  scope: string;
  smartAccount?: string;
  symbol: string;
  timer?: ReturnType<typeof setTimeout>;
};

/** The host owns the exact envelope; this dialog only records explicit consent. */
export function useSmartAccountFeeConfirmation(scope: string) {
  const { t } = useTranslation();
  const current = useRef(scope);
  current.current = scope;
  const alive = useRef(false);
  const pending = useRef<PendingReview | null>(null);
  const [view, setView] = useState<PendingReview | null>(null);
  const [expired, setExpired] = useState(false);
  const finish = (id: string | null, publish = true) => {
    const review = pending.current;
    if (!review) return;
    pending.current = null;
    clearTimeout(review.timer);
    if (publish) setView(null);
    review.resolve(id);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      finish(null, false);
    };
  }, [scope]);

  const confirmFee = (
    input: unknown,
    details: {
      account: string;
      assertCurrent(): void;
      chainId: number;
      label: string;
      smartAccount?: string;
      symbol: string;
    }
  ): Promise<string | null> => {
    details.assertCurrent();
    if (!alive.current || current.current !== scope || pending.current)
      throw new Error('Fee review context changed');
    const raw = input as FeeReview;
    const transaction = snapshotPreparedEvmTransaction(raw?.transaction);
    const maximumFee =
      BigInt(transaction.gasLimit) *
      BigInt(
        transaction.type === 0 ? transaction.gasPrice : transaction.maxFeePerGas
      );
    if (
      typeof raw?.id !== 'string' ||
      !raw.id ||
      raw.id.length > 160 ||
      transaction.chainId !== String(details.chainId) ||
      !/^0x[\da-f]{40}$/i.test(details.account) ||
      (details.smartAccount !== undefined &&
        !/^0x[\da-f]{40}$/i.test(details.smartAccount)) ||
      raw.maximumFeeUnits !== maximumFee.toString() ||
      raw.maximumTotalUnits !==
        (maximumFee + BigInt(transaction.value)).toString() ||
      !Number.isSafeInteger(raw.validForMs) ||
      raw.validForMs <= 0 ||
      raw.validForMs > 90_000
    )
      throw new Error('Invalid network fee review');
    const quote = Object.freeze({ ...raw, transaction });
    return new Promise((resolve) => {
      const review: PendingReview = {
        ...details,
        quote,
        resolve,
        scope,
        expires: performance.now() + quote.validForMs,
      };
      pending.current = review;
      setExpired(false);
      setView(review);
      review.timer = setTimeout(() => {
        if (pending.current === review) setExpired(true);
      }, quote.validForMs);
    });
  };
  const shown = view?.scope === scope ? view : null;
  const row = (label: string, value: string) => (
    <div className="min-w-0">
      <dt className="text-brand-graylight">{label}</dt>
      <dd className="break-all text-brand-white">{value}</dd>
    </div>
  );
  const feeConfirmation = shown ? (
    <ConfirmationModal
      show
      title={t('settings.smartAccountFeeReviewTitle')}
      buttonText={t(expired ? 'buttons.close' : 'buttons.confirm')}
      onClose={() => finish(null)}
      onClick={() => {
        try {
          shown.assertCurrent();
          if (
            expired ||
            performance.now() >= shown.expires ||
            !alive.current ||
            current.current !== shown.scope
          ) {
            finish(null);
            return;
          }
          finish(shown.quote.id);
        } catch {
          finish(null);
        }
      }}
    >
      <p className="mb-3 text-sm text-brand-white">{shown.label}</p>
      <dl className="space-y-3 rounded-2xl bg-alpha-whiteAlpha100 p-3 text-left text-sm">
        {row(t('settings.smartAccountFeeReviewSelectedAccount'), shown.account)}
        {shown.smartAccount &&
          row(t('smartAccountHub.accountAddress'), shown.smartAccount)}
        {row(t('transactions.feePayer'), shown.quote.transaction.from)}
        {row(
          t('send.to'),
          shown.quote.transaction.to ?? t('transactions.contractDeploy')
        )}
        {row(t('nftDetails.network'), shown.quote.transaction.chainId)}
        {row(
          t('transactions.replay.maximumFee'),
          `${formatEther(shown.quote.maximumFeeUnits)} ${shown.symbol}`
        )}
        {row(
          t('settings.smartAccountFeeReviewMaximumTotal'),
          `${formatEther(shown.quote.maximumTotalUnits)} ${shown.symbol}`
        )}
      </dl>
      {expired && (
        <p role="status" className="mt-3 text-sm text-brand-yellowInfo">
          {t('mobile.infrastructure.reviewExpired')}
        </p>
      )}
    </ConfirmationModal>
  ) : null;
  return { confirmFee, feeConfirmation };
}
