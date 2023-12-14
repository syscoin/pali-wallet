import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { RiShareForward2Line as ShareIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { IconButton, LoadingComponent } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatCurrency, truncate } from 'utils/index';

export const SyscoinAssetsList = () => {
  const {
    accounts,
    activeAccount,
    isLoadingAssets,
    activeNetwork: { chainId },
  } = useSelector((state: RootState) => state.vault);
  const { assets } = accounts[activeAccount.type][activeAccount.id];
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const filteredAssets = assets.syscoin.filter(
    (asset) => asset.chainId === chainId
  );

  return (
    <>
      {isLoadingAssets ? (
        <LoadingComponent />
      ) : (
        <>
          {filteredAssets?.map(
            ({ decimals, balance, symbol, assetGuid }: any) => (
              <Fragment key={uniqueId(String(assetGuid))}>
                <li className="flex items-center py-2 text-xs border-b border-dashed border-bkg-white200">
                  <table className="table-auto w-full">
                    <tbody>
                      <tr className="flex items-center justify-between font-poppins font-normal">
                        <td className="flex items-center gap-x-2">
                          <span className="text-brand-white">
                            {truncate(
                              formatCurrency(
                                String(balance / 10 ** decimals),
                                decimals
                              ),
                              5,
                              false
                            )}
                          </span>

                          <span className="text-brand-royalbluemedium">
                            {`  ${truncate(symbol, 10).toUpperCase()}`}
                          </span>

                          <span
                            className="w-full text-brand-gray300 font-poppins text-xs font-normal"
                            style={{
                              width: 'fit-content',
                            }}
                          >
                            {t('send.assetGuid')}
                          </span>
                        </td>

                        <td className="flex items-center max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis gap-x-2.5">
                          <span className="w-full text-brand-white">
                            {ellipsis(assetGuid, 4)}
                          </span>

                          <IconButton
                            onClick={() =>
                              navigate('/home/details', {
                                state: { id: assetGuid, hash: null },
                              })
                            }
                          >
                            <ShareIcon size={16} color="text-brand-white" />
                          </IconButton>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </li>
              </Fragment>
            )
          )}
        </>
      )}
    </>
  );
};
