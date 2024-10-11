import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import rolluxLogo from 'assets/images/rolluxChain.png';
import sysLogo from 'assets/images/sysChain.svg';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { faucetNetworkData } from 'utils/constants';

export const FaucetAccessModal = () => {
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const {
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const currentNetworkData = faucetNetworkData?.[chainId];

  return (
    <div
      onClick={() => navigate('/faucet')}
      className="cursor-pointer z-[49] py-2 justify-center absolute left-[4.3%] top-[8rem] w-[364px] flex items-center rounded-b-[8px] bg-brand-blue400 opacity-100 hover:opacity-55"
    >
      <div className="relative flex items-center">
        <img className="relative z-20 w-4" src={rolluxLogo} />
        <img className="relative left-[-6px] z-10 w-4" src={sysLogo} />
      </div>
      <h1 className="text-xs text-white max-w-[80%]">
        {t('faucet.grabTextTwo', {
          token: currentNetworkData?.token,
          rpcName: currentNetworkData?.network,
        })}
      </h1>
    </div>
  );
};
