import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useQueryData } from 'hooks/useQuery';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { IDecodedTx, IFeeState, ITxState } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { logError } from 'utils/logger';

export const ApproveTransactionComponent = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { navigate, alert } = useUtils();

  const [tx, setTx] = useState<ITxState>();
  const [fee, setFee] = useState<IFeeState>();
  const [customNonce, setCustomNonce] = useState<number>();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { state }: { state: any } = useLocation();

  const { host, ...externalTx } = useQueryData();

  const isExternal = Boolean(externalTx.external);

  const dataTx = isExternal
    ? externalTx.tx
    : state.external
    ? state.tx
    : state.tx;

  const decodedTx: IDecodedTx = isExternal
    ? externalTx.decodedTx
    : state.external
    ? state.decodedTx
    : state.decodedTx;

  const canGoBack = state?.external ? !state.external : !isExternal;

  // console.log('dataTx', dataTx);
  // console.log('decodedTx', decodedTx);

  console.log('hex to number', parseInt(decodedTx.inputs[1].hex, 16));

  const handleConfirmApprove = async () => {
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
          dispatchBackgroundEvent(`txApprove.${host}`, response.hash);
        return response.hash;
      } catch (error: any) {
        logError('error', 'Transaction', error);

        alert.removeAll();
        alert.error("Can't complete approve. Try again later.");

        if (isExternal) setTimeout(window.close, 4000);
        else setLoading(false);
        return error;
      }
    }
  };

  useEffect(() => {
    const abortController = new AbortController();

    const getGasAndFunction = async () => {
      const { feeDetails, formTx, nonce } = await fetchGasAndDecodeFunction(
        dataTx,
        activeNetwork
      );

      setFee(feeDetails);
      setTx(formTx);
      setCustomNonce(nonce);
    };

    getGasAndFunction();

    return () => {
      abortController.abort();
    };
  }, []);

  return (
    <Layout title="Approve" canGoBack={canGoBack}>
      <DefaultModal
        show={confirmed}
        title="Approve successful"
        description="Your approve has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          refresh(false);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />

      {tx?.from ? (
        <>
          <div className="flex flex-col items-center justify-center w-full">
            <p className="flex flex-col items-center justify-center w-full text-center text-brand-white font-poppins font-thin">
              <span className="text-sm font-medium font-thin">{host}</span>
            </p>
          </div>
          <div className="my-8">
            <NeutralButton
              loading={loading}
              onClick={handleConfirmApprove}
              type="button"
              id="confirm-btn"
            >
              Confirm
            </NeutralButton>
          </div>
        </>
      ) : null}
    </Layout>
  );
};
