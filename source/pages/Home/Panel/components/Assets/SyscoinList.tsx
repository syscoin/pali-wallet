import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';

import { Fullscreen, IconButton, Icon } from 'components/index';
import { useStore, useUtils } from 'hooks/index';
import { formatCurrency } from 'utils/index';

export const SyscoinAssetsList = () => {
  const {
    activeAccount: { assets },
  } = useStore();
  const { navigate } = useUtils();

  return (
    <>
      <ul className="pb-24 md:pb-8">
        {assets.map(({ decimals, balance, symbol, assetGuid }: any) => (
          <Fragment key={uniqueId(String(assetGuid))}>
            {balance > 0 && (
              <li className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
                <p className="font-rubik">
                  {formatCurrency(String(balance / 10 ** decimals), decimals)}

                  <span className="text-button-secondary font-poppins">
                    {`  ${symbol}`}
                  </span>
                </p>

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
      </ul>

      <Fullscreen />
    </>
  );
};
