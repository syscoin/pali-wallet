import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FiTrash as DeleteIcon,
  RiEditLine as EditIcon,
  RiShareForward2Line as DetailsIcon,
} from 'react-icons/all';
import { useSelector } from 'react-redux';

import { LoadingComponent } from 'components/Loading';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ITokenEthProps } from 'types/tokens';
import { getController } from 'utils/browser';
import { truncate, formatCurrency } from 'utils/index';

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
                <li className="flex items-center justify-between py-2 text-xs border-b border-dashed border-bkg-white200">
                  <div className="flex gap-3 items-center justify-start">
                    {!token.isNft && token.logo && (
                      <div style={{ maxWidth: '25px', maxHeight: '25px' }}>
                        <img src={`${token.logo}`} alt={`${token.name} Logo`} />
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
                      <p className="flex items-center gap-x-2">
                        <span className="text-brand-white">
                          {truncate(
                            formatCurrency(
                              String(
                                token.balance / 10 ** Number(token.decimals)
                              ),
                              Number(token.decimals)
                            ),
                            5,
                            false
                          )}
                        </span>

                        <span className="text-brand-royalbluemedium">
                          {`  ${truncate(token.tokenSymbol, 10).toUpperCase()}`}
                        </span>
                      </p>
                    )}
                  </div>

                  <div
                    className={`flex items-center justify-between ${btnContainerWidth}`}
                  >
                    <Tooltip content={t('tooltip.assetDetails')}>
                      <DetailsIcon
                        className="cursor-pointer hover:text-fields-input-borderfocus"
                        color="text-brand-white"
                        size={16}
                        onClick={() =>
                          navigate('/home/details', {
                            state: { id: token.id, hash: null },
                          })
                        }
                      />
                    </Tooltip>

                    {token?.is1155 === undefined && (
                      <Tooltip content={t('tooltip.editAsset')}>
                        <EditIcon
                          className="cursor-pointer hover:text-fields-input-borderfocus"
                          color="text-brand-white"
                          size={16}
                          onClick={() =>
                            navigate('/tokens/add', {
                              state: token,
                            })
                          }
                        />
                      </Tooltip>
                    )}

                    <Tooltip content={t('tooltip.deleteAsset')}>
                      <DeleteIcon
                        className="cursor-pointer hover:text-fields-input-borderfocus"
                        color="text-brand-white"
                        size={16}
                        onClick={() =>
                          controller.wallet.account.eth.deleteTokenInfo(
                            token.contractAddress
                          )
                        }
                      />
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
