import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';

import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatCurrency, truncate } from 'utils/index';

export const SyscoinAssetsList = () => {
  const assets = useSelector(
    (state: RootState) => state.vault.activeAccount.assets
  );
  const { navigate } = useUtils();

  return (
    <>
      {assets.map(({ decimals, balance, symbol, assetGuid }: any) => (
        <Fragment key={uniqueId(String(assetGuid))}>
          {balance > 0 && (
            <li className="relative flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
              <p className="font-rubik">
                <span>
                  {truncate(
                    formatCurrency(String(balance / 10 ** decimals), decimals),
                    14
                  )}
                </span>

                <span className="text-button-secondary font-poppins">
                  {`  ${truncate(symbol, 10)}`}
                </span>
              </p>

              <div className="absolute right-20 flex w-20">
                <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
                  <p className="text-blue-300">Asset Guid</p>

                  <p>{ellipsis(assetGuid, 4)}</p>
                </div>
              </div>

              <IconButton
                onClick={() =>
                  navigate('/home/details', {
                    state: { id: assetGuid, hash: null },
                  })
                }
              >
                <Icon name="select" className="w-4 text-brand-white" />
              </IconButton>
            </li>
          )}
        </Fragment>
      ))}
    </>
  );
};
