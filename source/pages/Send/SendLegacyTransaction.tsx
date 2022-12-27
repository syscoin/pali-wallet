import { ethers } from 'ethers';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  Layout,
  DefaultModal,
  NeutralButton,
  Button,
  Icon,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IFeeState } from 'types/transactions';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { fetchGasAndDecodeFunction } from 'utils/fetchGasAndDecodeFunction';
import { logError, ellipsis, removeScientificNotation } from 'utils/index';

export const SendLegacyTransaction = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const txs = account.eth.tx;

  const { alert, navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { host, ...externalTx } = useQueryData();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState<IFeeState>();

  const isExternal = Boolean(externalTx.external);

  const tx = externalTx.tx;

  const isLegacyTransaction = Boolean(tx.type);

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      try {
        if (isLegacyTransaction) {
          const response = await txs.sendFormattedTransaction(tx);

          setConfirmed(true);
          setLoading(false);

          if (isExternal)
            dispatchBackgroundEvent(`legacyTxSend.${host}`, response);

          return response;
        } else {
          const response = await txs.sendFormattedTransaction({
            ...tx,
            maxPriorityFeePerGas: ethers.utils.parseUnits(
              String(fee.maxPriorityFeePerGas.toFixed(9)),
              9
            ),
            maxFeePerGas: ethers.utils.parseUnits(
              String(fee.maxFeePerGas.toFixed(9)),
              9
            ),
            gasLimit: txs.toBigNumber(fee.gasLimit),
          });

          setConfirmed(true);
          setLoading(false);

          if (isExternal)
            dispatchBackgroundEvent(`legacyTxSend.${host}`, response);

          return response;
        }
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

  useEffect(() => {
    const abortController = new AbortController();

    const getFeeRecomendation = async () => {
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await txs.getFeeDataWithDynamicMaxPriorityFeePerGas();

      const feeDetails = {
        maxFeePerGas: maxFeePerGas.toNumber() / 10 ** 9,
        baseFee: maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 9,
        maxPriorityFeePerGas: maxPriorityFeePerGas.toNumber() / 10 ** 9,
        gasLimit: txs.toBigNumber(0).toNumber(),
      };

      setFee(feeDetails);
    };

    getFeeRecomendation();

    return () => {
      abortController.abort();
    };
  }, [tx]);

  console.log('fee', fee);

  return (
    <Layout title="SEND" canGoBack={!isExternal}>
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          refresh(false);
          if (isExternal) window.close();
          else navigate('/home');
        }}
      />
      <div className="flex flex-col items-center justify-center w-full">
        <p className="flex flex-col items-center justify-center text-center font-rubik">
          <span className="text-brand-royalblue font-poppins font-thin">
            Send
          </span>

          <span>
            {`${
              Number(tx.value) / 10 ** 18
            } ${' '} ${activeNetwork.currency?.toUpperCase()}`}
          </span>
        </p>
        {fee ? (
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

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Estimated GasFee
                <span className="text-brand-royalblue text-xs">
                  Max Fee: {removeScientificNotation(fee?.maxFeePerGas)}{' '}
                  {activeNetwork.currency?.toUpperCase()}
                </span>
              </p>

              <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
                Total (Amount + gas fee)
                <span className="text-brand-royalblue text-xs">
                  {`${
                    Number(tx.value) / 10 ** 18 + fee?.maxFeePerGas
                  } ${activeNetwork.currency?.toLocaleUpperCase()}`}
                </span>
              </p>
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-around py-8 w-full">
          <Button
            type="button"
            className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-secondary hover:bg-button-secondaryhover border border-button-secondary rounded-full transition-all duration-300 xl:flex-none"
            id="send-btn"
            onClick={() => {
              refresh(false);
              if (isExternal) window.close();
              else navigate('/home');
            }}
          >
            <Icon
              name="arrow-up"
              className="w-4"
              wrapperClassname="mb-2 mr-2"
              rotate={45}
            />
            Cancel
          </Button>

          <Button
            type="button"
            className="xl:p-18 flex items-center justify-center text-brand-white text-base bg-button-primary hover:bg-button-primaryhover border border-button-primary rounded-full transition-all duration-300 xl:flex-none"
            id="receive-btn"
            loading={loading}
            onClick={handleConfirm}
          >
            <Icon
              name="arrow-down"
              className="w-4"
              wrapperClassname="mb-2 mr-2"
            />
            Confirm
          </Button>
        </div>
      </div>
    </Layout>
  );
};
