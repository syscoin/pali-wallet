import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
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
      className="cursor-pointer z-[49] px-4 py-3 absolute left-[4.3%] top-[8rem] w-[364px] flex items-center rounded-[8px] bg-brand-blue400 hover:bg-brand-blue500 transition-all duration-200 shadow-md hover:shadow-lg"
    >
      <div className="flex items-center gap-3 w-full">
        <ChainIcon chainId={chainId} size={20} className="flex-shrink-0" />
        <p className="text-sm text-white flex-1">
          {t('faucet.grabTextTwo', {
            token: currentNetworkData?.token,
            rpcName: currentNetworkData?.network,
          })}
        </p>
      </div>
    </div>
  );
};
