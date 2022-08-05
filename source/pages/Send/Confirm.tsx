import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
// import sys from 'syscoinjs-lib';

import { Layout, SecondaryButton, DefaultModal } from 'components/index';
import { useQueryData, useStore, useUtils } from 'hooks/index';
import { getController } from 'utils/browser';
import { formatUrl, logError, ellipsis } from 'utils/index';

export const SendConfirm = () => {
  const controller = getController();
  const { activeAccount, networks, activeNetwork } = useStore();
  const { alert, navigate, handleRefresh } = useUtils();

  // when using the default routing, state will have the tx data
  // when using createPopup (DApps), the data comes from route params
  const { state }: { state: any } = useLocation();
  const externalTx = useQueryData();
  const tx = state ? state.tx : externalTx;

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const isSyscoinChain =
    networks.syscoin[activeNetwork.chainId] &&
    activeNetwork.url.includes('blockbook');

  const handleConfirm = async () => {
    const balance = isSyscoinChain
      ? activeAccount.balances.syscoin
      : activeAccount.balances.ethereum;

    if (activeAccount && balance > 0) {
      setLoading(true);

      try {
        if (isSyscoinChain) {
          const response =
            await controller.wallet.account.sys.tx.sendTransaction(tx);

          setConfirmed(true);
          setLoading(false);

          return response;
        }

        await controller.wallet.account.eth.tx.sendAndSaveTransaction({
          ...tx,
          amount: Number(tx.amount),
          chainId: activeNetwork.chainId,
        });

        setConfirmed(true);
        setLoading(false);
      } catch (error: any) {
        logError('error', 'Transaction', error);

        if (activeAccount) {
          if (isSyscoinChain && error && tx.fee > 0.00001) {
            alert.removeAll();
            alert.error(
              `${formatUrl(
                String(error.message),
                166
              )} Please, reduce fees to send transaction.`
            );
          }

          alert.removeAll();
          alert.error("Can't complete transaction. Try again later.");

          setLoading(false);
        }
      }
    }
  };

  return (
    <Layout title="SEND">
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => {
          navigate('/home');
          handleRefresh(false);
        }}
      />
      {tx && (
        <div className="flex flex-col items-center justify-center mt-4 w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>

            <span>
              {`${tx.amount} ${' '} ${
                tx.token
                  ? tx.token.symbol
                  : activeNetwork.currency?.toUpperCase()
              }`}
            </span>
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              From
              <span className="text-brand-white">
                {ellipsis(tx.sender, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              To
              <span className="text-brand-white">
                {ellipsis(tx.receivingAddress, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              Fee
              <span className="text-brand-white">
                {!isSyscoinChain ? tx.fee * 10 ** 9 : tx.fee}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              Max total
              <span className="text-brand-white">
                {Number(tx.fee) + Number(tx.amount)}
                {`${activeNetwork.currency?.toUpperCase()}`}
              </span>
            </p>
          </div>

          <div className="absolute bottom-12 md:static md:mt-10">
            <SecondaryButton
              loading={loading}
              onClick={handleConfirm}
              type="button"
              id="confirm-btn"
            >
              Confirm
            </SecondaryButton>
          </div>
        </div>
      )}
    </Layout>
  );
};
