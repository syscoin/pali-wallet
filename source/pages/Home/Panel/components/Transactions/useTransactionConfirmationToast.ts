import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useUtils } from 'hooks/useUtils';

const alwaysSuccessful = () => true;

/** Compare observed confirmations only within one wallet browsing context. */
export const useTransactionConfirmationToast = (
  scope: string,
  transactions: readonly any[] | undefined,
  identifier: 'hash' | 'txid',
  isSuccessful: (transaction: any) => boolean = alwaysSuccessful
) => {
  const { alert } = useUtils();
  const { t } = useTranslation();
  const active = useRef(true);
  const contextRef = useRef({ scope });
  if (contextRef.current.scope !== scope) contextRef.current = { scope };
  const context = contextRef.current;
  const previous = useRef<{
    awaitingSuccess: Set<string>;
    context: typeof context;
    lastToast: number;
  }>();

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!Array.isArray(transactions)) return;
    const baseline = previous.current;
    const sameContext = baseline?.context === context;
    const awaitingSuccess = new Set<string>();
    let newlyConfirmed = false;
    for (const tx of transactions) {
      const id = tx[identifier];
      const count = tx.confirmations || 0;
      const wasPending = sameContext && baseline.awaitingSuccess.has(id);
      const successful = count > 0 && isSuccessful(tx);
      if (count <= 0 || (wasPending && !successful)) awaitingSuccess.add(id);
      if (sameContext && wasPending && successful) newlyConfirmed = true;
    }
    const next = {
      context,
      awaitingSuccess,
      lastToast: sameContext ? baseline.lastToast : 0,
    };
    previous.current = next;
    const now = Date.now();
    if (newlyConfirmed && now - next.lastToast > 3000) {
      next.lastToast = now;
      alert.success(
        t('send.txSuccessfull'),
        { autoClose: 5000 },
        () => active.current && contextRef.current === context
      );
    }
  }, [transactions, identifier, isSuccessful, context, alert, t]);
};
