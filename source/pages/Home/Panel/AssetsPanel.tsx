import React from 'react';
import { CgImport as ImportIcon } from 'react-icons/cg';
import { useSelector } from 'react-redux';

import { Fullscreen } from 'components/Fullscreen';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';

import { EvmAssetsList, SyscoinAssetsList } from './components/Assets';

export const AssetsPanel = () => {
  const { id, type } = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { assets } = useSelector(
    (state: RootState) => state.vault.accounts[type][id]
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const { chainId } = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const ethTokensValidation =
    assets.ethereum?.filter((token: any) => token.chainId === chainId)
      ?.length === 0;

  const sysAssetsValidation =
    assets.syscoin?.filter((asset) => asset.chainId === chainId)?.length === 0;

  const filterValidation = isBitcoinBased
    ? assets.syscoin?.length === 0 || sysAssetsValidation
    : assets.ethereum?.length === 0 || ethTokensValidation;

  const { navigate } = useUtils();

  const NoAssetsComponent = () => (
    <div className="flex items-center justify-center p-3 text-brand-white text-sm">
      <p>You have no tokens or NFTs.</p>
    </div>
  );

  return (
    <div className="pb-14 w-full">
      {filterValidation ? (
        <NoAssetsComponent />
      ) : (
        <ul className="pt-4 px-4 w-full text-center text-white text-base bg-bkg-3">
          {isBitcoinBased ? <SyscoinAssetsList /> : <EvmAssetsList />}
        </ul>
      )}
      <div className="flex items-center justify-center mb-9 mt-6 w-full hover:text-brand-deepPink100 text-brand-white font-normal cursor-pointer transition-all duration-300">
        <ImportIcon
          size={12}
          color="text-brand-white"
          style={{ marginRight: '6px' }}
        />
        <p
          className="underline text-sm"
          onClick={() => navigate('/tokens/add')}
        >
          Import Token
        </p>
      </div>

      <Fullscreen />
    </div>
  );
};
