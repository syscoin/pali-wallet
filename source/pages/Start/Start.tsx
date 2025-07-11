import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { ImportWalletWarning } from 'components/Modal/WarningBaseModal';
import GetStarted from 'components/Start/GetStarted';
import Unlock from 'components/Start/Unlock';
import { useAppReady } from 'hooks/useAppReady';
import { useController } from 'hooks/useController';
import { chromeStorage } from 'utils/storageAPI';

export const Start = (props: any) => {
  const [isOpenValidation, setIsOpenValidation] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const [hasVault, setHasVault] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Check for external route from URL parameters (when redirected from ExternalQueryHandler)
  const urlExternalRoute = searchParams.get('externalRoute');
  const urlData = searchParams.get('data');

  // Determine if this is an external request and what the route should be
  const isExternal = !!urlExternalRoute || props.isExternal;
  const externalRoute = urlExternalRoute
    ? `/external/${urlExternalRoute}${urlData ? `?data=${urlData}` : ''}`
    : props.externalRoute;

  const isFirstStep = !hasAccount && !hasVault;

  useEffect(() => {
    const checkVaultAndAccounts = async () => {
      try {
        // Check for vault in Chrome storage
        const vault = await chromeStorage.getItem('sysweb3-vault');
        setHasVault(!!vault);

        // Check for active account
        const result: any = await controllerEmitter([
          'wallet',
          'getActiveAccount',
        ]);
        setHasAccount(!!result.activeAccount.address);
      } catch (error: any) {
        // Only log non-connection errors
        if (
          !error?.message?.includes('Could not establish connection') &&
          !error?.message?.includes('Receiving end does not exist') &&
          !error?.message?.includes('Network request timed out')
        ) {
          console.error('Error checking vault/accounts:', error);
        }
        // For connection errors, we'll just use the default state (no account/vault)
      } finally {
        setIsInitialLoading(false);
      }
    };

    checkVaultAndAccounts();
  }, []);

  // Signal app is ready when we have content to show
  useAppReady(!isInitialLoading);

  // Don't render anything while loading - the HTML loader is showing
  if (isInitialLoading) {
    return null;
  }
  return (
    <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/all_assets/GET_STARTED2.png')] justify-center min-w-full h-screen login-animated-bg">
      {/* Subtle twinkling particles */}
      <div className="particle-1"></div>
      <div className="particle-2"></div>
      <div className="particle-3"></div>
      <div className="particle-4"></div>
      <div className="particle-5"></div>
      <div className="particle-6"></div>

      <ImportWalletWarning
        title={t('settings.importWalletWarning')}
        phraseOne={t('settings.thisActionErases')}
        phraseTwo={t('settings.toRestoreThis')}
        phraseThree={t('settings.allYourSettings')}
        onClose={setIsOpenValidation}
        show={isOpenValidation}
      />

      <p className="relative z-10 pt-[14rem] mb-2 text-center text-white text-opacity-92 font-poppins text-sm font-light leading-normal tracking-[0.175rem]">
        {t('start.welcomeTo')}
      </p>

      <div className="relative z-10 flex flex-row gap-3 mb-6">
        <h1 className="text-[#4DA2CF] text-justify font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
          Pali
        </h1>
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
          Wallet
        </h1>
      </div>

      <div className="relative z-10">
        {isFirstStep ? (
          <GetStarted />
        ) : (
          <Unlock
            setIsOpenValidation={setIsOpenValidation}
            isExternal={isExternal}
            externalRoute={externalRoute}
          />
        )}
      </div>
    </div>
  );
};
