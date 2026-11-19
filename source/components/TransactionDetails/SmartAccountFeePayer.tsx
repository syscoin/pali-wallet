import React from 'react';
import { useTranslation } from 'react-i18next';

import { formatEther } from 'utils/ethersV6Compat';

import type { SmartAccountPayerBudget } from '../../shared/smartAccountFeeQuote';

/** The public payer captured by the same quote that authorizes submission. */
export function SmartAccountFeePayer({ address }: { address: string }) {
  const { t } = useTranslation();
  return (
    <div className="my-2 flex flex-col gap-1 text-xs">
      <span className="text-brand-gray200">{t('transactions.feePayer')}</span>
      <span className="break-all text-brand-white">{address}</span>
    </div>
  );
}

export function SmartAccountPayerFee({
  address,
  budget,
  currency,
}: {
  address: string;
  budget: SmartAccountPayerBudget;
  currency?: string;
}) {
  const { t } = useTranslation();
  const feeRow = (label: string, wei: string) => (
    <div>
      <dt>{t(label)}</dt>
      <dd className="text-white">
        {formatEther(wei)} {currency?.toUpperCase()}
      </dd>
    </div>
  );

  return (
    <>
      <SmartAccountFeePayer address={address} />
      <dl className="mb-2 space-y-2 text-xs text-brand-gray200">
        {feeRow(
          budget.gasTank
            ? 'settings.smartAccountFeeReviewGasTank'
            : 'transactions.replay.maximumFee',
          budget.maximumFeeWei
        )}
        {budget.maximumPrefundWei !== '0' && (
          <>
            {feeRow(
              'transactions.smartAccountCancelMaximumDeposit',
              budget.maximumPrefundWei
            )}
            {feeRow(
              'transactions.smartAccountCancelMaximumDepositFee',
              budget.maximumPrefundFeeWei
            )}
          </>
        )}
      </dl>
    </>
  );
}
