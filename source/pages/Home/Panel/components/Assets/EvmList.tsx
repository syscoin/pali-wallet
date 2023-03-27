import { uniqueId } from 'lodash';
import React, { Fragment } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';

export const EvmAssetsList = () => {
  const accountId = useSelector(
    (state: RootState) => state.vault.activeAccountId
  );
  const assets = useSelector(
    (state: RootState) => state.vault.accounts[accountId].assets
  );
  const { chainId } = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const filteredAssets = assets.ethereum?.filter(
    (token: any) => token.chainId === chainId
  );
  const { navigate } = useUtils();

  return (
    <>
      {filteredAssets?.map(({ tokenSymbol, id, balance, logo, isNft }: any) => (
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
