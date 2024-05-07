import React from 'react';
import { useTranslation } from 'react-i18next';

import rolluxLogo from 'assets/images/rolluxChain.png';
import sysLogo from 'assets/images/sysChain.svg';
import { useUtils } from 'hooks/useUtils';
import { useHandleNetworkTokenNames } from 'pages/Faucet/Utils/NetworksInfos';

export const FaucetAccessModal = () => {
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const { tokenSymbol, networkName } = useHandleNetworkTokenNames();

  return (
    <div
      onClick={() => navigate('/faucet')}
      className="cursor-pointer z-[88] py-2 justify-center absolute left-[4.3%] top-[8rem] w-[364px] flex items-center rounded-b-[8px] bg-brand-blue400 opacity-100 hover:opacity-55"
    >
      <div className="relative flex items-center">
        <img className="relative z-20 w-4" src={rolluxLogo} />
        <img className="relative left-[-6px] z-10 w-4" src={sysLogo} />
      </div>
      <h1 className="text-xs text-white max-w-[80%]">
        {t('faucet.grabTextTwo', {
          token: tokenSymbol,
          rpcName: networkName,
        })}
      </h1>
    </div>
  );
};
