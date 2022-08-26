import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';

export const EvmAssetsList = () => {
  const assets = useSelector(
    (state: RootState) => state.vault.activeAccount.assets
  );
  const { navigate } = useUtils();

  return (
    <>
      {assets.map(({ tokenSymbol, id, balance, logo, isNft }: any) => (
        <Fragment key={uniqueId(id)}>
          <li className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
            <div className="flex gap-3 items-center justify-start">
              {!isNft && logo && <img src={`${logo}`} alt="token logo" />}

              <p className="font-rubik">
                <span className="text-button-secondary font-poppins">
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
      ))}
    </>
  );
};
