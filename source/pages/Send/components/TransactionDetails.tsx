import { Input } from 'antd';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { EditPriorityModal } from '../EditPriorityModal';
import { RootState } from 'state/store';
import { IDecodedTx, IFeeState, ITxState } from 'types/transactions';
import { ellipsis } from 'utils/format';
import removeScientificNotation from 'utils/removeScientificNotation';

interface ITransactionDetailsProps {
  customFee: {
    gasLimit: number;
    isCustom: boolean;
    maxFeePerGas: number;
    maxPriorityFeePerGas: number;
  };
  decodedTx: IDecodedTx;
  fee: IFeeState;
  setCustomFee: React.Dispatch<
    React.SetStateAction<{
      gasLimit: number;
      isCustom: boolean;
      maxFeePerGas: number;
      maxPriorityFeePerGas: number;
    }>
  >;
  setCustomNonce: React.Dispatch<React.SetStateAction<number>>;
  setFee: React.Dispatch<React.SetStateAction<IFeeState>>;
  tx: ITxState;
}

export const TransactionDetailsComponent = (
  props: ITransactionDetailsProps
) => {
  const { tx, setCustomNonce, fee, setFee, setCustomFee, customFee } = props;
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  return (
    <>
      <EditPriorityModal
        showModal={isOpen}
        setIsOpen={setIsOpen}
        setFee={setFee}
        customFee={customFee}
        setCustomFee={setCustomFee}
        fee={fee}
      />
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
              Max Fee:{' '}
              {removeScientificNotation(
                customFee.isCustom ? customFee.maxFeePerGas : fee.maxFeePerGas
              )}{' '}
              {activeNetwork.currency?.toUpperCase()}
            </span>
          </p>
          <span
            className="w-fit relative bottom-1 hover:text-brand-deepPink100 text-brand-royalblue text-xs cursor-pointer"
            onClick={() => setIsOpen(true)}
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
              placeholder={String(tx.nonce)}
              defaultValue={tx.nonce}
              onChange={(e) => setCustomNonce(Number(e.target.value))}
            />
          </span>
        </p>

        <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
          Total (Amount + gas fee)
          <span className="text-brand-royalblue text-xs">
            {Number(tx.value) / 10 ** 18 +
              (customFee.isCustom ? customFee.maxFeePerGas : fee.maxFeePerGas)}
          </span>
        </p>
      </div>
    </>
  );
};
