import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useStore, useUtils } from 'hooks/index';

export const EvmAssetsList = () => {
  const {
    activeAccount: { assets },
  } = useStore();
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

      {/* <p
          className="mb-8 mt-4 text-center hover:text-brand-royalbluemedium cursor-pointer"
          onClick={() => navigate('/tokens/add/import')}
        >
          Import token
        </p> */}
    </>
  );
};
