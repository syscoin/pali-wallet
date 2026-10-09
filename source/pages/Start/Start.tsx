import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { ImportWalletWarning } from 'components/Modal/WarningBaseModal';
import GetStarted from 'components/Start/GetStarted';
import Unlock from 'components/Start/Unlock';
import { useAppReady } from 'hooks/useAppReady';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';

export const Start = (props: any) => {
  const [isOpenValidation, setIsOpenValidation] = useState(false);
  // WalletBootstrap has already hydrated the authoritative background snapshot.
  // Re-reading storage/RPC here could stall or misclassify an existing wallet.
  const hasVault = useSelector(
    (state: RootState) => state.vaultGlobal.hasEncryptedVault
  );
  const activeAccount = useSelector(selectActiveAccount);
  const hasAccount = !!activeAccount?.address;
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Check for external route from URL parameters (when redirected from ExternalQueryHandler)
  const urlExternalRoute = searchParams.get('externalRoute');
  const urlData = searchParams.get('data');

  // Determine if this is an external request and what the route should be
  const isExternal = !!urlExternalRoute || props.isExternal;
  const externalRoute = urlExternalRoute
    ? `/external/${urlExternalRoute}${
        urlData ? `?data=${encodeURIComponent(urlData)}` : ''
      }`
    : props.externalRoute;

  const isFirstStep = !hasAccount && !hasVault;

  useAppReady();

  return (
    <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/all_assets/GET_STARTED2.webp')] justify-center min-w-full h-screen login-animated-bg">
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

      <div className="relative z-10 flex flex-col items-center w-full max-w-md px-6">
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
