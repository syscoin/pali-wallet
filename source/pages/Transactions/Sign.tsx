import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button, DeviceWaitingBanner, ErrorModal } from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';
import { SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS } from 'utils/constants';
import { handleTransactionError } from 'utils/errorHandling';
import { clearTransactionNavigationState } from 'utils/navigationState';
import { sanitizeErrorMessage } from 'utils/syscoinErrorSanitizer';

interface ISign {
  signOnly?: boolean;
}

const Sign: React.FC<ISign> = ({ signOnly = false }) => {
  const { controllerEmitter } = useController();
  const { host, eventName, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const approvalActionRef = React.useRef<
    'ready' | 'submitting' | 'dismissed' | 'completed'
  >('ready');
  // Cleared callbacks may already be running; every exit must own its attempt.
  const approvalLifetimeRef = React.useRef(0);
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = React.useRef(true);

  const invalidateScheduledClose = useCallback(() => {
    approvalLifetimeRef.current += 1;
    if (closeTimeoutRef.current !== undefined) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = undefined;
    }
    return approvalLifetimeRef.current;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateScheduledClose();
    };
  }, [invalidateScheduledClose]);

  const ownsLifetime = (
    lifetime: number,
    action: typeof approvalActionRef.current
  ) =>
    mountedRef.current &&
    approvalLifetimeRef.current === lifetime &&
    approvalActionRef.current === action;
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(
    'Transaction details are loading'
  );

  const handleReviewStateChange = useCallback((error: string | null) => {
    setReviewError(error);
  }, []);

  // Use shallow equality checks to prevent unnecessary re-renders
  const { activeAccount: activeAccountData, accounts } = useSelector(
    (state: RootState) => state.vault,
    (prev, next) =>
      prev.activeAccount?.type === next.activeAccount?.type &&
      prev.activeAccount?.id === next.activeAccount?.id &&
      prev.accounts === next.accounts
  );
  const activeAccount = accounts[activeAccountData.type][activeAccountData.id];
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork,
    (prev, next) => prev?.chainId === next?.chainId && prev?.url === next?.url
  );

  // Handle initial data loading
  useEffect(() => {
    const processInitialData = async () => {
      try {
        // Small delay to ensure data is properly loaded
        await new Promise((resolve) => setTimeout(resolve, 100));
        setInitialLoading(false);
      } catch (error) {
        console.error('Error processing initial data:', error);
        setInitialLoading(false);
      }
    };

    if (data) {
      processInitialData();
    } else {
      setInitialLoading(false);
    }
  }, [data]);

  const onSubmit = async () => {
    if (!mountedRef.current || approvalActionRef.current !== 'ready') return;
    if (reviewError) {
      setErrorMsg(reviewError);
      return;
    }

    const lifetime = invalidateScheduledClose();
    approvalActionRef.current = 'submitting';
    setErrorMsg('');
    setLoading(true);

    try {
      let response = null;

      if (!signOnly) {
        // Use atomic operation for all wallets (sign + send + save)
        response = await controllerEmitter(
          ['wallet', 'signSendAndSaveTransaction'],
          [
            {
              psbt: data,
              expectedContext: data.approvedContext,
              isTrezor: activeAccount.isTrezorWallet,
              isLedger: activeAccount.isLedgerWallet,
            },
          ],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS,
          false
        );
      } else {
        // Sign-only flow
        response = await controllerEmitter(
          ['wallet', 'signSyscoinPsbt'],
          [
            {
              psbt: data,
              expectedContext: data.approvedContext,
              isTrezor: activeAccount.isTrezorWallet,
              isLedger: activeAccount.isLedgerWallet,
            },
          ],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : SYSCOIN_PSBT_VERIFICATION_TIMEOUT_MS,
          false
        );
      }
      if (!ownsLifetime(lifetime, 'submitting')) return;
      // Show success toast
      alert.success(
        signOnly
          ? t('transactions.theDappHas')
          : t('transactions.youCanCheckYour')
      );

      approvalActionRef.current = 'completed';
      setConfirmed(true);
      setLoading(false);

      // Close window
      closeTimeoutRef.current = setTimeout(async () => {
        if (!ownsLifetime(lifetime, 'completed')) return;
        approvalActionRef.current = 'dismissed';
        closeTimeoutRef.current = undefined;
        try {
          await clearTransactionNavigationState();
        } catch (error) {
          console.error(
            '[Sign] Failed to clear navigation after signing:',
            error
          );
          return;
        }
        if (!ownsLifetime(lifetime, 'dismissed')) return;
        dispatchBackgroundEvent(`${eventName}.${host}`, response);
        window.close();
      }, 2000);
    } catch (error: any) {
      if (!ownsLifetime(lifetime, 'submitting')) return;
      // Create custom alert object that routes to appropriate display method
      const customAlert = {
        error: (msg: string) => setErrorMsg(msg),
        info: (msg: string) => alert.info(msg),
        warning: (msg: string) => setErrorMsg(msg),
        success: (msg: string) => alert.success(msg),
      };

      // Handle all errors with centralized handler
      const wasHandledSpecifically = handleTransactionError(
        error,
        customAlert,
        t,
        activeAccount,
        activeNetwork,
        undefined, // basicTxValues not available in this context (Sign.tsx doesn't have fee/amount info)
        sanitizeErrorMessage
      );

      if (!wasHandledSpecifically) {
        // Fallback for non-structured errors
        const sanitizedMessage = sanitizeErrorMessage(error);
        setErrorMsg(sanitizedMessage);
      }

      approvalActionRef.current = 'ready';
      setLoading(false);
      closeTimeoutRef.current = setTimeout(() => {
        if (!ownsLifetime(lifetime, 'ready')) return;
        closeTimeoutRef.current = undefined;
        void handleDismiss();
      }, 4000);
    }
  };

  const handleDismiss = async () => {
    if (!mountedRef.current || approvalActionRef.current !== 'ready') return;
    const lifetime = invalidateScheduledClose();
    approvalActionRef.current = 'dismissed';
    setClosing(true);
    try {
      await clearTransactionNavigationState();
    } catch (error) {
      console.error('[Sign] Failed to clear navigation state on close:', error);
    } finally {
      if (ownsLifetime(lifetime, 'dismissed')) window.close();
    }
  };

  return (
    <>
      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={handleDismiss}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
      />

      {initialLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingComponent />
        </div>
      ) : (
        <div className="flex flex-col w-full h-screen">
          {/* Main scrollable content area */}
          <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
            {/* Header Section */}
            <div className="flex flex-col w-full items-center justify-center px-6 py-8">
              <div className="w-16 h-16 relative p-4 mb-6 rounded-full bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
                <img
                  className="absolute inset-0 w-full h-full p-4"
                  src="/assets/all_assets/signature.svg"
                  alt="Signature"
                />
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">
                {t('transactions.signatureRequest')}
              </h1>
              <p className="text-sm text-gray-300 text-center">
                {t('transactions.confirmToProceed')}
              </p>
              {host && (
                <p className="text-xs text-gray-400 text-center mt-1">
                  from <span className="font-medium">{host}</span>
                </p>
              )}
            </div>

            {/* Transaction Details Section */}
            <div className="w-full">
              <SyscoinTransactionDetailsFromPSBT
                psbt={data}
                showTechnicalDetails={false}
                showTransactionOptions={false}
                onReviewStateChange={handleReviewStateChange}
              />
            </div>
          </div>

          {/* Fixed button container at bottom */}
          <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <DeviceWaitingBanner account={activeAccount} show={loading} />
            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                type="button"
                disabled={loading || closing || confirmed}
                onClick={handleDismiss}
              >
                {t('buttons.cancel')}
              </Button>

              <Button
                variant="primary"
                type="submit"
                disabled={closing || confirmed || Boolean(reviewError)}
                loading={loading}
                onClick={onSubmit}
              >
                {signOnly ? t('send.sign') : t('buttons.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// Memoize the component to prevent unnecessary re-renders during rapid polling
export default React.memo(
  Sign,
  (prevProps, nextProps) =>
    // Only re-render if signOnly prop changes
    prevProps.signOnly === nextProps.signOnly
);
