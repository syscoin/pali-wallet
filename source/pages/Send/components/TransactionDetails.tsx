import { Input } from 'antd';
import React from 'react';
import { useSelector } from 'react-redux';

import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/format';
import removeScientificNotation from 'utils/removeScientificNotation';

export const TransactionDetailsComponent = (props: any) => {
  const { tx, dataTx, decodedTx, setCustomNonce, fee } = props;

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { navigate } = useUtils();

  return (
    <>
      <div className="flex flex-col gap-3 items-start justify-center w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
        <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
          From
          <span className="text-brand-royalblue text-xs">
            {ellipsis(tx.from, 7, 15)}
          </span>
        </p>

        <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
          To
          <span className="text-brand-royalblue text-xs">
            {ellipsis(tx.to, 7, 15)}
          </span>
        </p>

        <div className="flex flex-row items-center justify-between w-full">
          <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
            Estimated GasFee
            <span className="text-brand-royalblue text-xs">
              Max Fee: {removeScientificNotation(fee.maxFeePerGas)}{' '}
              {activeNetwork.currency?.toUpperCase()}
            </span>
          </p>
          <span
            className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
            onClick={() =>
              navigate('edit/priority', {
                state: {
                  tx: dataTx,
                  decodedTx: decodedTx,
                  external: true,
                  fee,
                },
              })
            }
          >
            EDIT
          </span>
        </div>

        <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
          Custom Nonce
          <span className="text-brand-royalblue text-xs">
            <Input
              type="number"
              className="input-medium outline-0 w-10 bg-bkg-2 rounded-sm focus:outline-none focus-visible:outline-none"
              placeholder={tx.nonce}
              defaultValue={tx.nonce}
              onChange={(e) => setCustomNonce(Number(e.target.value))}
            />
          </span>
        </p>

        <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
          Total (Amount + gas fee)
          <span className="text-brand-royalblue text-xs">
            {Number(tx.value) / 10 ** 18 + fee.maxFeePerGas}
          </span>
        </p>
      </div>
    </>
  );
};
