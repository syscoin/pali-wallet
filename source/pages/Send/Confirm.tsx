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
import { encryptor } from '@pollum-io/sysweb3-utils';
import { getController } from 'utils/browser';

export const SendConfirm = () => {
  const controller = getController();
  const {
    wallet: { account, web3 },
  } = getController();
  const activeAccount = controller.wallet.account.getActiveAccount();
  const { alert, navigate } = useUtils();
  const { confirmingTransaction, activeNetworkType, activeNetwork } =
    useStore();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const tempTx = account.getTemporaryTransaction('sendAsset');

  const handleConfirm = async () => {
    const recommendedFee = await account.getRecommendFee();

    if ((activeAccount ? activeAccount.balance : -1) > 0) {
      setLoading(true);

      if (activeNetworkType === 'syscoin') {
        try {
          const callback = account.confirmSendAssetTransaction;

          log('asset sent', 'Transaction', tempTx);

          const response = await account.confirmTemporaryTransaction({
            type: 'sendAsset',
            callback,
          });

          if (response) {
            alert.removeAll();
            alert.error("Can't complete transaction. Try again later.");

            if (confirmingTransaction) {
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
              const max = (100 * tempTx.amount) / activeAccount?.balance;

              if (tempTx.amount >= (max * tempTx.amount) / 100) {
                alert.removeAll();
                alert.error(error.message);

                setLoading(false);

                return;
              }

              alert.removeAll();
              alert.error("Can't complete transaction. Try again later.");
            }

            if (confirmingTransaction) {
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
      } else {
        try {
          if (activeNetworkType === 'web3' && activeNetwork === 'rinkeby') {
            web3.changeNetwork(4);
          }
          if (activeNetworkType === 'web3' && activeNetwork === 'mainnet') {
            web3.changeNetwork(1);
          }

          const decryptPrivateKey = encryptor.decrypt(
            String(activeAccount?.web3PrivateKey),
            window.controller.wallet.encryptedPassword
          );

          await web3.sendTransactions(
            decryptPrivateKey,
            tempTx.toAddress,
            Number(tempTx.amount)
          );

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
              const max = (100 * tempTx.amount) / activeAccount?.balance;

              if (tempTx.amount >= (max * tempTx.amount) / 100) {
                alert.removeAll();
                alert.error(error.message);

                setLoading(false);

                return;
              }

              alert.removeAll();
              alert.error("Can't complete transaction. Try again later.");
            }

            if (confirmingTransaction) {
              browser.runtime.sendMessage({
                type: 'WALLET_ERROR',
                target: 'background',
                transactionError: true,
                invalidParams: false,
                message: `TransactionError: ${error}`,
              });

              setTimeout(() => {
                cancelTransaction(browser, 'tempTx');
              }, 4000);
            }

            setLoading(false);
          }
        }
      }

      return (
        <Layout
          title={activeNetworkType === 'syscoin' ? 'SEND SYS' : 'SEND ETH'}
        >
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
                {tempTx.token
                  ? tempTx.token.symbol
                  : activeNetworkType === 'syscoin'
                  ? 'SYS'
                  : 'ETH'}
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
                    {activeNetworkType === 'syscoin' ? 'SYS' : 'ETH'}
                  </span>
                </p>
              </div>

              <div className="absolute bottom-12">
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
    }
  };
};
