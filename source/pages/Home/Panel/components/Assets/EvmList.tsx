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
      {assets.map(({ tokenSymbol, id, balance }: any) => (
        <Fragment key={uniqueId(id)}>
          <li className="flex items-center justify-between py-3 text-xs border-b border-dashed border-dashed-dark">
            <p className="font-rubik">
              <span className="text-button-secondary font-poppins">
                {`${balance}  ${tokenSymbol}`}
              </span>
            </p>

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

      <p
        className="my-4 hover:text-brand-royalblue text-brand-royalbluemedium text-xs cursor-pointer"
        onClick={() => navigate('/tokens/add')}
      >
        Import token
      </p>
    </>
  );
};
