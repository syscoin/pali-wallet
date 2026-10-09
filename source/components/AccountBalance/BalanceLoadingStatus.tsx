import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const BALANCE_LOADING_FEEDBACK_MS = 1800;

/** Unknown balance is distinct from a loaded zero balance. */
export const BalanceLoadingStatus = () => {
  const { t } = useTranslation();
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(
      () => setIsSlow(true),
      BALANCE_LOADING_FEEDBACK_MS
    );
    return () => clearTimeout(timeout);
  }, []);

  const operation = t('networkConnection.updatingBalances');
  return (
    <p
      id="home-balance-pending"
      role="status"
      aria-live="polite"
      className="text-xs text-brand-graylight"
    >
      {isSlow ? t('networkConnection.operationSlow', { operation }) : operation}
    </p>
  );
};
