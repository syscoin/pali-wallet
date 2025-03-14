import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ImportWalletWarning } from 'components/Modal/WarningBaseModal';
import GetStarted from 'components/Start/GetStarted';
import Unlock from 'components/Start/Unlock';
import { useController } from 'hooks/useController';

export const Start = (props: any) => {
  const [isOpenValidation, setIsOpenValidation] = useState(false);
  const [hasAccount, setHasAccount] = useState(false);
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { isExternal, externalRoute } = props;
  const hasVault = !!JSON.parse(localStorage.getItem('sysweb3-vault'));
  const isFirstStep = !hasAccount && !hasVault;

  useEffect(() => {
    const checkAccounts = async () => {
      const result: any = await controllerEmitter([
        'wallet',
        'getActiveAccount',
      ]);

      setHasAccount(!!result.activeAccount.address);
    };

    checkAccounts();

    return () => {
      checkAccounts();
    };
  }, []);

  return (
    <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/images/GET_STARTED2.png')] justify-center min-w-full h-screen">
      <ImportWalletWarning
        title={t('settings.importWalletWarning')}
        phraseOne={t('settings.thisActionErases')}
        phraseTwo={t('settings.toRestoreThis')}
        phraseThree={t('settings.allYourSettings')}
        onClose={setIsOpenValidation}
        show={isOpenValidation}
      />
      <p className=" pt-[14rem] mb-2 text-center text-white text-opacity-92 font-poppins text-sm font-light leading-normal tracking-[0.175rem]">
        {t('start.welcomeTo')}
      </p>

      <div className="flex flex-row gap-3 mb-6">
        <h1 className="text-[#4DA2CF] text-justify font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
          Pali
        </h1>
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
          Wallet
        </h1>
      </div>
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
  );
};
