import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { DefaultModal, Button } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { HardWallets } from 'scripts/Background/controllers/message-handler/types';
import { RootState } from 'state/store';
import { handleTransactionError } from 'utils/errorHandling';

const ConnectHardwareWalletView: FC = () => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedHardwareWallet, setSelectedHardwareWallet] = useState<
    string | undefined
  >();

  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(
    window.innerWidth <= 600
  );
  const { accounts } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const { alert, navigate } = useUtils();
  const { controllerEmitter, isUnlocked } = useController();
  const trezorAccounts = Object.values(accounts.Trezor);
  const ledgerAccounts = Object.values(accounts.Ledger);

  const modalTitle = t('settings.walletSelected');
  const modalDescription = t('settings.walletSelectedMessage');

  const trezorSelectedButtonStyle = `${
    selectedHardwareWallet === HardWallets.TREZOR
      ? 'bg-brand-blue400 border-2 border-brand-blue400 cursor-pointer'
      : 'bg-transparent border-2 border-white '
  }`;

  const ledgerSelectedButtonStyle = `${
    selectedHardwareWallet === HardWallets.LEDGER
      ? 'bg-brand-blue400 border-2 border-brand-blue400 cursor-pointer'
      : 'bg-transparent border-2 border-white '
  }`;

  const isLedger = selectedHardwareWallet === HardWallets.LEDGER;

  const handleCreateHardwareWallet = async () => {
    setIsLoading(true);
    try {
      switch (selectedHardwareWallet) {
        case HardWallets.TREZOR:
          // Trezor initialization is handled internally by importTrezorAccountFromController
          await controllerEmitter(
            ['wallet', 'importTrezorAccountFromController'],
            [],
            false,
            300000 // 5 minutes timeout for hardware wallet operations
          );

          setIsModalOpen(true);
          setIsLoading(false);
          break;
        case HardWallets.LEDGER:
          const LEDGER_USB_VENDOR_ID = 0x2c97;

          if ((navigator as any).hid?.requestDevice) {
            await (navigator as any).hid.requestDevice({
              filters: [{ vendorId: LEDGER_USB_VENDOR_ID }],
            });
          }

          // Ledger connection is handled internally by ensureConnection
          await controllerEmitter(
            ['wallet', 'importLedgerAccountFromController'],
            [],
            false,
            300000 // 5 minutes timeout for hardware wallet operations
          );

          setIsModalOpen(true);
          setIsLoading(false);
          break;
      }
    } catch (error) {
      setIsLoading(false);

      // Log error for debugging
      console.log('Hardware wallet connection error:', error);

      // Create custom alert object that handles hardware wallet specific behavior
      const customAlert = {
        error: (msg: string) => {
          setSelectedHardwareWallet(undefined); // Reset selection on error
          alert.error(msg);
        },
        info: (msg: string) => {
          setSelectedHardwareWallet(undefined); // Reset selection on cancellation
          alert.info(msg);
        },
        warning: (msg: string) => alert.warning(msg),
        success: (msg: string) => alert.success(msg),
      };

      // Handle all errors with centralized handler
      const wasHandledSpecifically = handleTransactionError(
        error,
        customAlert,
        t,
        undefined, // activeAccount not available in hardware wallet creation context
        undefined, // activeNetwork not needed for hardware wallet errors
        undefined, // basicTxValues not available in this context
        undefined // sanitizeErrorMessage not needed for hardware wallet errors
      );

      if (!wasHandledSpecifically) {
        // For any other errors, also reset selection to prevent getting stuck
        setSelectedHardwareWallet(undefined);
        alert.error(t('settings.errorCreatingHardWallet'));
      }
    }
  };

  const ButtonLabel = () => {
    if (
      (isLedger && !ledgerAccounts.length) ||
      (!isLedger && !trezorAccounts.length)
    ) {
      return <p>{t('buttons.connect')}</p>;
    }
    return <p>{t('buttons.addAccount')}</p>;
  };

  const handleHardwalletBuyNow = useCallback(() => {
    window.open(isLedger ? 'https://www.ledger.com/' : 'https://trezor.io/');
  }, [isLedger]);

  // Handle screen size changes for optimal hardware wallet experience
  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth <= 600);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Prevent navigation away from hardware wallet page - ALWAYS LOCKED
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        'Are you sure you want to leave? Your hardware wallet setup will be interrupted.';
      return e.returnValue;
    };

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Immediately push state back to prevent navigation
      window.history.pushState(null, '', window.location.href);
      return false;
    };

    // Prevent navigation through browser controls
    const preventNavigation = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // Add event listeners to prevent navigation
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState, true);
    window.addEventListener('hashchange', preventNavigation, true);

    // Push state once initially to prevent back navigation
    window.history.pushState(null, '', window.location.href);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState, true);
      window.removeEventListener('hashchange', preventNavigation, true);
    };
  }, [navigate]);

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-brand-blue600 overflow-y-auto">
      <div className="w-full max-w-md px-4 min-h-popup flex flex-col py-8">
        <>
          {/* Wallet logged out message */}
          {!isUnlocked && (
            <div className="mx-4 mb-4 p-3 bg-red-500/20 border border-red-500/40 rounded-lg">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-red-400 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm text-red-200 font-medium mb-1">
                    {t('settings.walletLoggedOut')}
                  </p>
                  <p className="text-xs text-red-300">
                    {t('settings.closeAndReopenPali')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Instructions for after setup */}
          {!isLoading && isModalOpen && (
            <div className="mx-4 mb-4 p-3 bg-green-500/20 border border-green-500/40 rounded-lg">
              <div className="flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-green-400 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="text-sm text-green-200 font-medium mb-1">
                    {t('settings.hardwareWalletSuccess')}
                  </p>
                  <p className="text-xs text-green-300">
                    {t('settings.hardwareWalletInstructions')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isSmallScreen && (
            <div className="mx-4 mb-4 p-3 bg-yellow-500/20 border border-yellow-500/40 rounded-lg">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-yellow-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <p className="text-sm text-yellow-200 font-medium">
                  {t('settings.optimalExperience')}
                </p>
              </div>
            </div>
          )}
          <DefaultModal
            show={isModalOpen}
            title={modalTitle}
            description={modalDescription}
            onClose={() => {
              // Give user clear instructions about next steps
              const shouldClose = window.confirm(
                'Hardware wallet setup complete! Close this window and reopen Pali to use your hardware wallet. Your account is saved and will be available when you restart Pali.\n\nClose now?'
              );
              if (shouldClose) {
                // Close the entire browser window/tab
                window.close();
              }
            }}
          />
          <div className="flex flex-col items-center justify-center w-full flex-1">
            <div className="w-16 h-16 relative p-4 mb-6 rounded-[100px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
              <img
                className="absolute left-[30%]"
                src="/assets/all_assets/hardwallet.svg"
              />
            </div>
            <div className="remove-scrollbar px-2 flex-1 text-sm overflow-y-auto w-full max-w-md">
              {selectedHardwareWallet ? (
                <div className="flex flex-col text-center justify-center items-center w-full text-sm">
                  <p>
                    {t('settings.connectYourWalletAndClick', {
                      hardwalletName:
                        selectedHardwareWallet === HardWallets.LEDGER
                          ? 'LEDGER'
                          : 'TREZOR',
                    })}
                  </p>
                  <p className="text-brand-gray200">
                    {t('settings.youCanUseAny', {
                      hardwalletName:
                        selectedHardwareWallet === HardWallets.LEDGER
                          ? 'Ledger'
                          : 'Trezor',
                    })}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center">
                  <p className="text-white text-center text-sm mb-6">
                    {t('settings.selectTheHardware')}{' '}
                  </p>

                  <button
                    className={`${trezorSelectedButtonStyle} mt-6 rounded-full py-2 w-80 mx-auto text-center text-base font-medium mb-[6px] hover:bg-brand-blue400 hover:border-brand-blue400 hover:cursor-pointer`}
                    onClick={() =>
                      setSelectedHardwareWallet(HardWallets.TREZOR)
                    }
                    id="trezor-btn"
                    disabled={!isUnlocked}
                  >
                    Trezor
                  </button>
                  <button
                    className={`${ledgerSelectedButtonStyle} rounded-full py-2 w-80 mx-auto text-center text-base font-medium hover:bg-brand-blue400 hover:border-brand-blue400 hover:cursor-pointer`}
                    onClick={() =>
                      setSelectedHardwareWallet(HardWallets.LEDGER)
                    }
                    id="ledger-btn"
                    disabled={!isUnlocked}
                  >
                    Ledger
                  </button>
                </div>
              )}
            </div>
            <div className="mt-8 w-full max-w-md">
              {selectedHardwareWallet && (
                <div className="w-full gap-3 flex flex-col mb-6 mx-auto p-4 text-brand-white text-xs bg-alpha-whiteAlpha100 border border-dashed border-alpha-whiteAlpha300 rounded-[20px]">
                  <p className="font-medium">{t('settings.dontHaveWallet')}</p>
                  <div className="flex">
                    <p>
                      {isLedger
                        ? t('settings.orderLedger')
                        : t('settings.orderTrezor')}
                      <span
                        className="hover:text-button-primary cursor-pointer pl-1 underline"
                        onClick={handleHardwalletBuyNow}
                      >
                        {t('settings.buyNow')}
                      </span>
                    </p>
                  </div>
                </div>
              )}
              <Button
                type="button"
                onClick={handleCreateHardwareWallet}
                disabled={selectedHardwareWallet === undefined || !isUnlocked}
                loading={isLoading}
                id="connect-btn"
                className={`${
                  selectedHardwareWallet === undefined || !isUnlocked
                    ? 'opacity-60'
                    : 'opacity-100'
                } cursor-pointer bg-white w-full h-10 text-brand-blue200 text-base font-base font-medium rounded-2xl`}
              >
                <ButtonLabel />
              </Button>
            </div>
          </div>
        </>
      </div>
    </div>
  );
};

export default ConnectHardwareWalletView;
