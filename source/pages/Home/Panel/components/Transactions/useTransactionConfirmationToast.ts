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
    confirmations: Map<string, number>;
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
    const confirmations = new Map<string, number>();
    let newlyConfirmed = false;
    for (const tx of transactions) {
      const id = tx[identifier];
      const count = tx.confirmations || 0;
      confirmations.set(id, count);
      if (
        sameContext &&
        baseline.confirmations.get(id) === 0 &&
        count > 0 &&
        isSuccessful(tx)
      )
        newlyConfirmed = true;
    }
    const next = {
      context,
      confirmations,
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
