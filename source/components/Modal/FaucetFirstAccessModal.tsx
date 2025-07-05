import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import closeIcon from 'assets/all_assets/close.svg';
import { ChainIcon } from 'components/ChainIcon';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { faucetNetworkData } from 'utils/constants';

export const FaucetFirstAccessModal = ({
  onClose,
}: {
  onClose: () => void;
}) => {
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const {
    activeNetwork: { chainId, kind },
  } = useSelector((state: RootState) => state.vault);

  const currentNetworkData = faucetNetworkData?.[chainId];

  return (
    <div className="fixed z-[999] inset-0 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" />
      <div className="relative w-[364px] p-6 bg-brand-blue600 rounded-[20px] shadow-lg">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 hover:opacity-60"
        >
          <img src={closeIcon} alt="Close" className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center gap-4">
          <ChainIcon
            chainId={chainId}
            size={80}
            className=""
            networkKind={kind}
          />

          <h2 className="text-lg font-medium text-white">
            {t('faucet.firstAccessTitle', {
              token: currentNetworkData?.token,
              network: currentNetworkData?.network,
            })}
          </h2>

          <p className="text-sm text-center text-white/80">
            {t('faucet.firstAccessDescription', {
              token: currentNetworkData?.token,
            })}
          </p>

          <button
            onClick={() => {
              navigate('/faucet');
              onClose();
            }}
            className="w-full py-3 mt-2 text-brand-blue600 bg-white rounded-full hover:opacity-90 transition-opacity"
          >
            {t('faucet.grabTokens')}
          </button>
        </div>
      </div>
    </div>
  );
};
