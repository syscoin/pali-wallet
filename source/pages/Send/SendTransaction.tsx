import React, { useState } from 'react';
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
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const { host, ...externalTx } = useQueryData();
  const isExternal = Boolean(externalTx.value);
  const tx = isExternal ? externalTx : state.tx;
  console.log('Check tx', tx);
  console.log('Check account', account.eth);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const handleConfirm = async () => {
    const {
      balances: { ethereum },
    } = activeAccount;

    const balance = ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      const txs = account.eth.tx;

      try {
        console.log('Checking tx', tx);
        const { maxFeePerGas, maxPriorityFeePerGas } =
          await txs.getFeeDataWithDynamicMaxPriorityFeePerGas();
        console.log('Just checking fees', maxFeePerGas, maxPriorityFeePerGas);
        const formTx = {
          data: tx.data,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          maxFeePerGas: maxFeePerGas,
        };
        const response = await txs.sendFormattedTransaction(formTx);
        console.log('tx resp', response);
        setConfirmed(true);
        setLoading(false);

        if (isExternal) dispatchBackgroundEvent(`txSend.${host}`, response);
        // return false;
        return response;
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
      {tx && (
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>

            <span>
              {`${tx.value} ${' '} ${activeNetwork.currency?.toUpperCase()}`}
            </span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
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
              Fee
              <span className="text-brand-royalblue text-xs">
                `${tx.gas * 10 ** 9} GWEI`
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-white font-poppins font-thin">
              Max total
              <span className="text-brand-royalblue text-xs">
                {Number(tx.gas) + Number(tx.value)}
                {`${activeNetwork.currency?.toUpperCase()}`}
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
        </div>
      )}
    </Layout>
  );
};
