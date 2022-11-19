import { Input } from 'antd';
import React from 'react';
import { useSelector } from 'react-redux';

import { NeutralButton } from 'components/index';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { ellipsis } from 'utils/format';
import { logError } from 'utils/logger';
import removeScientificNotation from 'utils/removeScientificNotation';

export const TransactionDetailsComponent = (props: any) => {
  const {
    tx,
    dataTx,
    customNonce,
    setCustomNonce,
    loading,
    setLoading,
    setTx,
    fee,
    isExternal,
    setConfirmed,
    host,
  } = props;

  const {
    wallet: { account },
  } = getController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { alert, navigate } = useUtils();

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      const txs = account.eth.tx;
      setTx({
        ...tx,
        nonce: customNonce,
        maxPriorityFeePerGas: txs.toBigNumber(
          fee.maxPriorityFeePerGas * 10 ** 18
        ),
        maxFeePerGas: txs.toBigNumber(fee.maxFeePerGas * 10 ** 18),
        gasLimit: txs.toBigNumber(fee.gasLimit),
      });
      try {
        const response = await txs.sendFormattedTransaction(tx);
        setConfirmed(true);
        setLoading(false);

        if (isExternal)
          dispatchBackgroundEvent(`txSend.${host}`, response.hash);
        return response.hash;
      } catch (error: any) {
        logError('error', 'Transaction', error);

        alert.removeAll();
        alert.error("Can't complete transaction. Try again later.");

        if (isExternal) setTimeout(window.close, 4000);
        else setLoading(false);
        return error;
      }
    }
  };

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
                state: { tx: dataTx, external: true, fee },
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

      <div className="my-8">
        <NeutralButton
          loading={loading}
          onClick={handleConfirm}
          type="button"
          id="confirm-btn"
        >
          Confirm
        </NeutralButton>
      </div>
    </>
  );
};
