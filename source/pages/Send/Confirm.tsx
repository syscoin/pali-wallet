import React, { useState } from 'react';
import { Layout, SecondaryButton, DefaultModal } from 'components/index';
import { useStore, useUtils } from 'hooks/index';
import { browser } from 'webextension-polyfill-ts';
import {
  log,
  logError,
  ellipsis,
  formatUrl,
  cancelTransaction,
} from 'utils/index';
import { getController } from 'utils/browser';

export const SendConfirm = () => {
  const controller = getController();
  const activeAccount = controller.wallet.account.getActiveAccount();
  const { alert, navigate } = useUtils();
  const {
    temporaryTransactionState: { executing, type },
  } = useStore();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const tempTx = controller.wallet.account.getTemporaryTransaction('sendAsset');

  const handleConfirm = async () => {
    const recommendedFee = await controller.wallet.account.getRecommendFee();

    if ((activeAccount ? activeAccount.balances.syscoin : -1) > 0) {
      setLoading(true);

      try {
        const callback = controller.wallet.account.confirmSendAssetTransaction;

        log('asset sent', 'Transaction', tempTx);

        const response =
          await controller.wallet.account.confirmTemporaryTransaction({
            type: 'sendAsset',
            callback,
          });

        if (response) {
          alert.removeAll();
          alert.error("Can't complete transaction. Try again later.");

          if (executing && type === 'sendAsset') {
            browser.runtime.sendMessage({
              type: 'WALLET_ERROR',
              target: 'background',
              transactionError: true,
              invalidParams: false,
              message: `TransactionError: ${response}`,
            });

            setTimeout(() => {
              cancelTransaction(browser, 'tempTx');
            }, 4000);
          }

          return;
        }

        browser.runtime.sendMessage({
          type: 'WALLET_ERROR',
          target: 'background',
          transactionError: false,
          invalidParams: false,
          message: 'Everything is fine, transaction completed.',
        });

        setConfirmed(true);
        setLoading(false);
      } catch (error: any) {
        logError('error', 'Transaction', error);

        if (activeAccount) {
          if (error && tempTx.fee > recommendedFee) {
            alert.removeAll();
            alert.error(
              `${formatUrl(
                String(error.message),
                166
              )} Please, reduce fees to send transaction.`
            );
          }

          if (error && tempTx.fee <= recommendedFee) {
            const max = (100 * tempTx.amount) / activeAccount?.balances.syscoin;

            if (tempTx.amount >= (max * tempTx.amount) / 100) {
              alert.removeAll();
              alert.error(error.message);

              setLoading(false);

              return;
            }

            alert.removeAll();
            alert.error("Can't complete transaction. Try again later.");
          }

          if (executing && type === 'sendAsset') {
            browser.runtime.sendMessage({
              type: 'WALLET_ERROR',
              target: 'background',
              transactionError: true,
              invalidParams: false,
              message: `TransactionError: ${error}`,
            });

            setTimeout(() => {
              cancelTransaction(browser, tempTx);
            }, 4000);
          }

          setLoading(false);
        }
      }
    }
  };

  return (
    <Layout title="SEND SYS">
      <DefaultModal
        show={confirmed}
        title="Transaction successful"
        description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
        onClose={() => navigate('/home')}
      />

      {tempTx && (
        <div className="flex flex-col items-center justify-center mt-4 w-full">
          <p className="flex flex-col items-center justify-center text-center font-rubik">
            <span className="text-brand-royalblue font-poppins font-thin">
              Send
            </span>
            {tempTx.amount}
            {tempTx.token ? tempTx.token.symbol : 'SYS'}
          </p>

          <div className="flex flex-col gap-3 items-start justify-center mt-4 px-4 py-2 w-full text-left text-sm divide-bkg-3 divide-dashed divide-y">
            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              From
              <span className="text-brand-white">
                {ellipsis(tempTx.fromAddress, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              To
              <span className="text-brand-white">
                {ellipsis(tempTx.toAddress, 7, 15)}
              </span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              Fee
              <span className="text-brand-white">{tempTx.fee}</span>
            </p>

            <p className="flex flex-col pt-2 w-full text-brand-royalblue font-poppins font-thin">
              Max total
              <span className="text-brand-white">
                {Number(tempTx.fee) + Number(tempTx.amount)}
                SYS
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
