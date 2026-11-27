import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmationModal } from 'components/index';
import { SmartAccountPayerFee } from 'components/TransactionDetails/SmartAccountFeePayer';
import { formatEther } from 'utils/ethersV6Compat';
import type {
  SmartAccountExecutionFeeConsent,
  SmartAccountFeeQuote,
} from 'utils/smartAccount/execution';

type FeeReview = Readonly<{
  coveredFeeUnits?: string;
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
type FeeReviewDetails = {
  account: string;
  assertCurrent(): void;
  chainId: number;
  label: string;
  signal?: AbortSignal;
  signedInstruction?: true;
  smartAccount?: string;
  symbol: string;
};
type EntryPointReview = Readonly<{
  entryPoint: true;
  id: string;
  maximumFeeUnits: string;
  payer?: {
    address: string;
    budget: NonNullable<SmartAccountFeeQuote['payerBudget']>;
  };
  validForMs: number;
}>;
type PendingReview = FeeReviewDetails & {
  abort?: () => void;
  account: string;
  assertCurrent(): void;
  expires: number;
  label: string;
  quote: FeeReview | EntryPointReview;
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
    if (review.abort) review.signal?.removeEventListener('abort', review.abort);
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

  const present = (
    quote: FeeReview | EntryPointReview,
    details: FeeReviewDetails
  ): Promise<string | null> => {
    details.assertCurrent();
    if (!alive.current || current.current !== scope || pending.current)
      throw new Error('Fee review context changed');
    if (details.signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const review: PendingReview = {
        ...details,
        quote,
        resolve,
        scope,
        expires: performance.now() + quote.validForMs,
      };
      review.abort = () => {
        if (pending.current === review) finish(null);
      };
      pending.current = review;
      details.signal?.addEventListener('abort', review.abort, { once: true });
      setExpired(false);
      setView(review);
      review.timer = setTimeout(() => {
        if (pending.current === review) setExpired(true);
      }, quote.validForMs);
    });
  };
  const confirmFee = (
    input: unknown,
    details: FeeReviewDetails
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
    const coveredText =
      raw.coveredFeeUnits === undefined ? '0' : raw.coveredFeeUnits;
    if (
      typeof coveredText !== 'string' ||
      !/^(?:0|[1-9]\d{0,77})$/.test(coveredText)
    )
      throw new Error('Invalid network fee coverage');
    const covered = BigInt(coveredText);
    if (
      covered > maximumFee ||
      typeof raw?.id !== 'string' ||
      !raw.id ||
      raw.id.length > 160 ||
      transaction.chainId !== String(details.chainId) ||
      !/^0x[\da-f]{40}$/i.test(details.account) ||
      (details.smartAccount !== undefined &&
        !/^0x[\da-f]{40}$/i.test(details.smartAccount)) ||
      raw.maximumFeeUnits !== maximumFee.toString() ||
      raw.maximumTotalUnits !==
        (maximumFee - covered + BigInt(transaction.value)).toString() ||
      !Number.isSafeInteger(raw.validForMs) ||
      raw.validForMs <= 0 ||
      raw.validForMs > 90_000
    )
      throw new Error('Invalid network fee review');
    return present(
      Object.freeze({
        ...raw,
        coveredFeeUnits: covered.toString(),
        transaction,
      }),
      details
    );
  };
  const forExecution = (
    details: FeeReviewDetails
  ): SmartAccountExecutionFeeConsent => ({
    confirmEntryPoint: (
      quote: SmartAccountFeeQuote & { executionContextId: string }
    ) => {
      if (
        typeof quote.executionContextId !== 'string' ||
        !quote.executionContextId ||
        quote.executionContextId.length > 160 ||
        typeof quote.maximumFeeWei !== 'string' ||
        !/^\d{1,78}$/.test(quote.maximumFeeWei) ||
        typeof quote.gasUnits !== 'string' ||
        !/^\d{1,78}$/.test(quote.gasUnits) ||
        !/^0x[\da-f]{40}$/i.test(details.smartAccount ?? details.account)
      )
        throw new Error('Invalid smart account fee review');
      return present(
        {
          entryPoint: true,
          ...(quote.payerBudget && {
            payer: {
              address: quote.feePayer.address,
              budget: quote.payerBudget,
            },
          }),
          id: quote.executionContextId,
          maximumFeeUnits: quote.maximumFeeWei,
          validForMs: 60_000,
        },
        details
      );
    },
    confirmFee: (review, signal) =>
      confirmFee(review, { ...details, signal, signedInstruction: true }),
  });
  const shown = view?.scope === scope ? view : null;
  const gasSymbol = shown?.symbol.toUpperCase();
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
      {shown.signedInstruction && 'transaction' in shown.quote && (
        <p className="mb-3 text-sm text-brand-yellowInfo">
          {t('transactions.smartAccountAuthorizationRetained')}
        </p>
      )}
      <dl className="space-y-3 rounded-2xl bg-alpha-whiteAlpha100 p-3 text-left text-sm">
        {row(t('settings.smartAccountFeeReviewSelectedAccount'), shown.account)}
        {shown.smartAccount &&
          row(t('smartAccountHub.accountAddress'), shown.smartAccount)}
        {(!('entryPoint' in shown.quote) || !shown.quote.payer) &&
          row(
            t('transactions.feePayer'),
            'transaction' in shown.quote
              ? shown.quote.transaction.from
              : shown.smartAccount ?? shown.account
          )}
        {'transaction' in shown.quote &&
          row(
            t('send.to'),
            shown.quote.transaction.to ?? t('transactions.contractDeploy')
          )}
        {row(t('nftDetails.network'), String(shown.chainId))}
        {row(
          t(
            'entryPoint' in shown.quote
              ? 'send.smartAccountMaxFee'
              : 'transactions.replay.maximumFee'
          ),
          `${formatEther(shown.quote.maximumFeeUnits)} ${gasSymbol}`
        )}
        {'transaction' in shown.quote &&
          BigInt(shown.quote.coveredFeeUnits ?? '0') > BigInt(0) &&
          row(
            t('settings.smartAccountFeeReviewGasTank'),
            `${formatEther(shown.quote.coveredFeeUnits!)} ${gasSymbol}`
          )}
        {'transaction' in shown.quote &&
          row(
            t('settings.smartAccountFeeReviewMaximumTotal'),
            `${formatEther(shown.quote.maximumTotalUnits)} ${gasSymbol}`
          )}
      </dl>
      {'entryPoint' in shown.quote && shown.quote.payer && (
        <SmartAccountPayerFee {...shown.quote.payer} currency={gasSymbol} />
      )}
      {'entryPoint' in shown.quote && (
        <p className="mt-3 text-sm text-brand-graylight">
          {t(
            shown.quote.payer?.budget.gasTank === false
              ? 'send.smartAccountFeeReimbursement'
              : 'send.smartAccountFeeDetails'
          )}
        </p>
      )}
      {expired && (
        <p role="status" className="mt-3 text-sm text-brand-yellowInfo">
          {t('send.feeReviewExpired')}
        </p>
      )}
    </ConfirmationModal>
  ) : null;
  return { confirmFee, feeConfirmation, forExecution };
}
