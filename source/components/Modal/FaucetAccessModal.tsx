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
    <button
      type="button"
      onClick={() => navigate('/faucet')}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white z-[10] mx-4 px-4 pt-6 pb-3 absolute left-0 right-0 top-0 max-w-[calc(100%-2rem)] flex items-center rounded-b-[12px] bg-brand-blue400 hover:bg-brand-blue500 transition-all duration-300 shadow-md hover:shadow-lg hover:scale-[1.02]"
    >
      <span className="flex items-center justify-center gap-3 w-full">
        <ChainIcon
          chainId={chainId}
          size={20}
          className="flex-shrink-0"
          networkKind={kind}
        />
        <span className="text-sm text-white font-medium">
          {t('faucet.grabTextTwo', {
            token: currentNetworkData?.token,
          })}
        </span>
      </span>
    </button>
  );
};
