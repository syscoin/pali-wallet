import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { RiShareForward2Line as ShareIcon } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import { IconButton, LoadingComponent } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatCurrency, truncate } from 'utils/index';

//todo: create a loading state
export const SyscoinAssetsList = () => {
  const {
    accounts,
    activeAccount,
    isLoadingAssets,
    activeNetwork: { chainId },
    networkStatus,
  } = useSelector((state: RootState) => state.vault);
  const { assets } = accounts[activeAccount.type][activeAccount.id];
  const { navigate } = useUtils();
  const { t } = useTranslation();

  const isNetworkChanging = networkStatus === 'switching';

  const filteredAssets = assets.syscoin.filter(
    (asset) => asset.chainId === chainId
  );
  return (
    <>
      {isLoadingAssets || isNetworkChanging ? (
        <LoadingComponent />
      ) : (
        <>
          {filteredAssets?.map(
            ({ decimals, balance, symbol, assetGuid, contract }: any) => (
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

                          {contract &&
                            contract !==
                              '0x0000000000000000000000000000000000000000' && (
                              <span
                                className="px-1.5 py-0.5 text-[10px] bg-brand-royalbluemedium/20 text-brand-royalbluemedium rounded"
                                title="Cross-chain SPT with NEVM contract"
                              >
                                NEVM
                              </span>
                            )}

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
