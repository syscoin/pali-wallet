import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { LoadingComponent } from 'components/Loading';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const EvmAssetsList = () => {
  const controller = getController();

  const {
    accounts,
    activeAccount,
    isLoadingAssets,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);

  const assets = accounts[activeAccount.type][activeAccount.id].assets;

  const filteredAssets = assets.ethereum?.filter(
    (token) => token.chainId === chainId
  );

  const { navigate } = useUtils();

  return (
    <>
      {isLoadingAssets ? (
        <LoadingComponent />
      ) : (
        <>
          {filteredAssets?.map(
            ({
              tokenSymbol,
              id,
              balance,
              logo,
              isNft,
              contractAddress,
            }: any) => (
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

                  <div className="flex items-center justify-between w-16">
                    <Tooltip content="Asset Details">
                      <IconButton
                        onClick={() =>
                          navigate('/home/details', {
                            state: { id, hash: null },
                          })
                        }
                      >
                        <Icon name="select" className="w-4 text-brand-white" />
                      </IconButton>
                    </Tooltip>

                    <Tooltip content="Edit Asset">
                      <IconButton>
                        <Icon name="edit" className="w-4 text-brand-white" />
                      </IconButton>
                    </Tooltip>

                    <Tooltip content="Delete Asset">
                      <IconButton
                        onClick={() =>
                          controller.wallet.account.eth.deleteTokenInfo(
                            contractAddress
                          )
                        }
                      >
                        <Icon name="delete" className="w-4 text-brand-white" />
                      </IconButton>
                    </Tooltip>
                  </div>
                </li>
              </Fragment>
            )
          )}
        </>
      )}
    </>
  );
};
