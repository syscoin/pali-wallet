import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { truncate, logError, ellipsis } from 'utils/index';

export const SendTransaction = () => {
  const {
    refresh,
    wallet: { account },
  } = getController();

  const { alert, navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { host, ...externalTx } = useQueryData();
  const isExternal = Boolean(externalTx.from);
  const datatx = isExternal ? externalTx : state.tx;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [tx, setTx] = useState<any>();
  const [fee, setFee] = useState<any>();

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
  useEffect(() => {
    const fetchGasAndDecodeFunction = async () => {
      const txs = account.eth.tx;
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await txs.getFeeDataWithDynamicMaxPriorityFeePerGas(); // this details maxFeePerGas and maxPriorityFeePerGas need to be passed as an option
      const nonce = await txs.getRecommendedNonce(datatx.from); // This also need possibility for customization
      const formTx = {
        data: datatx.data,
        from: datatx.from,
        to: datatx.to,
        value: datatx?.value ? datatx.value : 0,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        maxFeePerGas: maxFeePerGas,
        nonce: nonce,
        chainId: activeNetwork.chainId,
        gasLimit: txs.toBigNumber(0),
      };
      formTx.gasLimit = await txs.getTxGasLimit(formTx);
      const feeDetails = {
        maxFeePerGas: maxFeePerGas.toNumber() / 10 ** 18,
        baseFee: maxFeePerGas.sub(maxPriorityFeePerGas).toNumber() / 10 ** 18,
        maxPriorityFeePerGas: maxPriorityFeePerGas.toNumber() / 10 ** 18,
        gasLimit: formTx.gasLimit.toNumber(),
      };
      setFee(feeDetails);
      setTx(formTx);
    };
    fetchGasAndDecodeFunction().catch(console.error);
  }, []); // TODO: add timer
  return (
    <Layout title="Transaction" canGoBack={!isExternal}>
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
      {tx?.from && (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>

            <span>{` ${'From: '} ${ellipsis(
              tx.from,
              7,
              20
            )} ${' --> '} ${' To: '} ${ellipsis(tx.to, 7, 20)}`}</span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              EstimatedGasFee
              <span className="text-brand-royalblue text-xs">`EDIT`</span>
              <span className="text-brand-royalblue text-xs">
                `Max Fee: ${fee.maxFeePerGas} $
                {activeNetwork.currency?.toUpperCase()}`
              </span>
              <span className="text-brand-royalblue text-xs">
                `${fee.maxFeePerGas * 0.15} USD`
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Value
              <span className="text-brand-royalblue text-xs">
                {` ${'Amount: '} ${Number(tx.value) / 10 ** 18} `}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Custom Nonce
              <span className="text-brand-royalblue text-xs">
                `${tx.nonce}`
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Total
              <span className="text-brand-royalblue text-xs">
                {` ${'Amount + gas fee'} ${
                  Number(tx.value) / 10 ** 18 + fee.maxFeePerGas
                } `}
              </span>
            </p>
          </div>

          <div className="absolute bottom-12 md:static md:mt-10">
            <NeutralButton
              loading={loading}
              onClick={handleConfirm}
              type="button"
              id="confirm-btn"
            >
              Confirm
            </NeutralButton>
          </div>
          {/* Rejection button must be added <div className="absolute bottom-12 md:static md:mt-10">
            <NeutralButton
              loading={loading}
              onClick={handleReject}
              type="button"
              id="confirm-btn"
            >
              Reject
            </NeutralButton>
          </div> */}
        </div>
      )}
    </Layout>
  );
};
