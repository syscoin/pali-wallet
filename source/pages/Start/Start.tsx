import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation, useSearchParams } from 'react-router-dom';

import { ImportWalletWarning } from 'components/Modal/WarningBaseModal';
import GetStarted from 'components/Start/GetStarted';
import Unlock from 'components/Start/Unlock';
import { useAppReady } from 'hooks/useAppReady';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';

export const Start = (props: any) => {
  const [isOpenValidation, setIsOpenValidation] = useState(false);
  // Keep the confirmation mounted while background deletion clears the vault.
  // Only its acknowledged completion reloads into ordinary onboarding.
  const [isFreshStartOpen, setIsFreshStartOpen] = useState(false);
  // WalletBootstrap has already hydrated the authoritative background snapshot.
  // Re-reading storage/RPC here could stall or misclassify an existing wallet.
  const hasVault = useSelector(
    (state: RootState) => state.vaultGlobal.hasEncryptedVault
  );
  const activeAccount = useSelector(selectActiveAccount);
  const hasAccount = !!activeAccount?.address;
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();

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

  const isFirstStep = !hasAccount && !hasVault && !isFreshStartOpen;

  useAppReady();

  return (
    <div className="bg-no-repeat bg-[url('../../../source/assets/all_assets/GET_STARTED2.webp')] min-w-full h-screen !overflow-y-auto overscroll-y-contain login-animated-bg">
      {/* Subtle twinkling particles */}
      {[1, 2, 3, 4, 5, 6].map((number) => (
        <div key={number} className={`particle-${number}`} />
      ))}

      <ImportWalletWarning
        title={t('settings.recoveryTitle')}
        phraseOne={t('settings.recoveryIntro')}
        phraseTwo={t('settings.recoverySeedHelp')}
        phraseThree={t('settings.recoveryLimitations')}
        onClose={setIsOpenValidation}
        show={isOpenValidation}
      />

      <div className="flex min-h-full w-full flex-col items-center justify-center pb-6">
        <p className="relative z-10 pt-[14rem] login-welcome-spacing mb-2 text-center text-white text-opacity-92 font-poppins text-sm font-light leading-normal tracking-[0.175rem]">
          {t('start.welcomeTo')}
        </p>

        <div className="relative z-10 flex flex-row gap-3 mb-6">
          {['Pali', 'Wallet'].map((word, index) => (
            <h1
              key={word}
              className={`text-[#4DA2CF] ${
                index ? '' : 'text-justify '
              }font-poppins text-[37.87px] ${
                index ? 'font-light' : 'font-bold'
              } leading-[37.87px] tracking-[0.379px]`}
            >
              {word}
            </h1>
          ))}
        </div>

        <div className="relative z-10 flex flex-col items-center w-full max-w-md px-6">
          {isFirstStep ? (
            <GetStarted />
          ) : (
            <Unlock
              onFreshStartOpenChange={setIsFreshStartOpen}
              allowFreshStart={
                !isExternal &&
                !externalRoute &&
                !searchParams.has('route') &&
                !searchParams.has('data') &&
                !searchParams.has('externalRoute') &&
                !location.pathname.startsWith('/external')
              }
              setIsOpenValidation={setIsOpenValidation}
              isExternal={isExternal}
              externalRoute={externalRoute}
            />
          )}
        </div>
      </div>
    </div>
  );
};
