import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { LoadingComponent } from 'components/Loading';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ITokenEthProps } from 'types/tokens';
import { getController } from 'utils/browser';

export const EvmAssetsList = () => {
  const controller = getController();
  const { t } = useTranslation();
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
          {filteredAssets?.map((token: ITokenEthProps) => {
            const btnContainerWidth =
              token?.is1155 === undefined ? 'w-16' : 'w-10';
            return (
              <Fragment key={uniqueId(token.id)}>
                <li className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
                  <div className="flex gap-3 items-center justify-start">
                    {!token.isNft && token.logo && (
                      <div style={{ maxWidth: '25px', maxHeight: '25px' }}>
                        <img src={`${token.logo}`} alt="token logo" />
                      </div>
                    )}
                    {token.isNft && token?.is1155 && (
                      <p className="font-rubik">
                        <span className="text-button-primary font-poppins">
                          {`- ${token.collectionName}`}
                        </span>
                      </p>
                    )}

                    {token?.is1155 === undefined && (
                      <p className="font-rubik">
                        <span className="text-button-primary font-poppins">
                          {`${token.balance}  ${token.tokenSymbol}`}
                        </span>
                      </p>
                    )}
                  </div>

                  <div
                    className={`flex items-center justify-between ${btnContainerWidth}`}
                  >
                    <Tooltip content={t('tooltip.assetDetails')}>
                      <IconButton
                        onClick={() =>
                          navigate('/home/details', {
                            state: { id: token.id, hash: null },
                          })
                        }
                      >
                        <Icon name="select" className="w-4 text-brand-white" />
                      </IconButton>
                    </Tooltip>

                    {token?.is1155 === undefined && (
                      <Tooltip content={t('tooltip.editAsset')}>
                        <IconButton
                          onClick={() =>
                            navigate('/tokens/add', {
                              state: token,
                            })
                          }
                        >
                          <Icon name="edit" className="w-4 text-brand-white" />
                        </IconButton>
                      </Tooltip>
                    )}

                    <Tooltip content={t('tooltip.deleteAsset')}>
                      <IconButton
                        onClick={() =>
                          controller.wallet.account.eth.deleteTokenInfo(
                            token.contractAddress
                          )
                        }
                      >
                        <Icon name="delete" className="w-4 text-brand-white" />
                      </IconButton>
                    </Tooltip>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </>
      )}
    </>
  );
};
