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
    activeNetwork: { chainId, kind },
  } = useSelector((state: RootState) => state.vault);

  const currentNetworkData = faucetNetworkData?.[chainId];

  return (
    <div
      onClick={() => navigate('/faucet')}
      className="cursor-pointer z-[10] mx-4 px-4 pt-6 pb-3 absolute left-0 right-0 top-[7.2rem] max-w-[calc(100%-2rem)] flex items-center rounded-b-[12px] bg-brand-blue400 hover:bg-brand-blue500 transition-all duration-300 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] hover:scale-[1.02]"
    >
      <div className="flex items-center justify-center gap-3 w-full">
        <ChainIcon
          chainId={chainId}
          size={20}
          className="flex-shrink-0"
          networkKind={kind}
        />
        <p className="text-sm text-white font-medium">
          {t('faucet.grabTextTwo', {
            token: currentNetworkData?.token,
          })}
        </p>
      </div>
    </div>
  );
};
