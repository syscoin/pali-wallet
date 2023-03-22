import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { LoadingComponent } from 'components/Loading';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';

export const EvmAssetsList = () => {
  const {
    accounts,
    activeAccount: accountId,
    isLoadingAssets,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const assets = accounts[accountId].assets;

  const filteredAssets = assets.ethereum?.filter(
    (token: any) => token.chainId === chainId
  );

  const { navigate } = useUtils();

  return (
    <>
      {isLoadingAssets ? (
        <LoadingComponent />
      ) : (
        <>
          {filteredAssets?.map(
            ({ tokenSymbol, id, balance, logo, isNft }: any) => (
              <Fragment key={uniqueId(id)}>
                <li className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
                  <div className="flex gap-3 items-center justify-start">
                    {!isNft && logo && (
                      <div style={{ maxWidth: '25px', maxHeight: '25px' }}>
                        <img src={`${logo}`} alt="token logo" />
                      </div>
                    )}

                    <p className="font-rubik">
                      <span className="text-button-primary font-poppins">
                        {`${balance}  ${tokenSymbol}`}
                      </span>
                    </p>
                  </div>

                  <IconButton
                    onClick={() =>
                      navigate('/home/details', {
                        state: { id, hash: null },
                      })
                    }
                  >
                    <Icon name="select" className="w-4 text-brand-white" />
                  </IconButton>
                </li>
              </Fragment>
            )
          )}
        </>
      )}
    </>
  );
};
