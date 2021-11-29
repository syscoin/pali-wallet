import React, { useState } from 'react';
import { Header } from 'containers/common/Header';
import { Layout } from 'containers/common/Layout';
import { Button, Icon } from 'components/index';;
import { useController, useFiat, useStore, useUtils, useFormat } from 'hooks/index';
import { IAccountState } from 'state/wallet/types';
import { browser } from 'webextension-polyfill-ts';

import { useEffect } from 'react';
import { Assets } from 'scripts/types';

export const SendConfirm = () => {
  const controller = useController();
  const getFiatAmount = useFiat();

  const { alert, getHost, history } = useUtils();
  const { ellipsis, formatURL } = useFormat();
  const { accounts, activeAccountId, currentSenderURL, confirmingTransaction } = useStore();

  const connectedAccount = accounts.find((account: IAccountState) => {
    return account.connectedTo.find((url: any) => {
      return url === getHost(currentSenderURL);
    });
  });
  
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const { tempTx } = controller.wallet.account.getTransactionItem();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [recommendedFee, setRecommendedFee] = useState(0.00001);
  const [tokenData, setTokenData] = useState<any>({});

  useEffect(() => {
    if (tempTx?.token) {
      const selectedAsset = accounts.find(element => element.id === activeAccountId)!.assets.filter((asset: Assets) => asset.assetGuid == tempTx?.token);

      setTokenData(selectedAsset[0]);
    }

    controller.wallet.account.getRecommendFee().then((response: any) => {
      setRecommendedFee(response);
    })
  }, []);

  const handleConfirm = () => {
    const acc = accounts.find(element => element.id === activeAccountId)

    if ((acc ? acc.balance : -1) > 0) {
      setLoading(true);

      controller.wallet.account.confirmTempTx().then((error: any) => {
        if (error) {
          alert.removeAll();
          alert.error('Can\'t complete transaction. Try again later.');

          if (confirmingTransaction) {
            browser.runtime.sendMessage({
              type: 'WALLET_ERROR',
              target: 'background',
              transactionError: true,
              invalidParams: false,
              message: `TransactionError: ${error}`
            });

            setTimeout(() => {
              handleCancelTransactionOnSite();
            }, 4000);
          }

          return;
        }

        browser.runtime.sendMessage({
          type: 'WALLET_ERROR',
          target: 'background',
          transactionError: false,
          invalidParams: false,
          message: 'Everything is fine, transaction completed.'
        });

        setConfirmed(true);
        setLoading(false);
      }).catch((error: any) => {
        console.log('error', error)

        if (error && tempTx.fee > recommendedFee) {
          alert.removeAll();
          alert.error(`${formatURL(String(error.message), 166)} Please, reduce fees to send transaction.`);
        }

        if (error && tempTx.fee <= recommendedFee) {
          const currentAccountIndex = accounts.findIndex((account: any) => account.id === activeAccountId);

          const max = 100 * tempTx.amount / accounts[currentAccountIndex].balance;

          if (tempTx.amount >= (max * tempTx.amount / 100)) {
            alert.removeAll();
            alert.error(error.message);

            setLoading(false);

            return;
          }

          alert.removeAll();
          alert.error('Can\'t complete transaction. Try again later.');
        }

        if (confirmingTransaction) {
          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: `TransactionError: ${error}`
          });

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }

        setLoading(false);
      });
    }
  };

  const handleCancel = () => {
    history.push("/home");
  }

  const handleClosePopup = () => {
    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleCancelTransactionOnSite = () => {
    browser.runtime.sendMessage({
      type: "CANCEL_TRANSACTION",
      target: "background",
      item: tempTx ? 'tempTx' : null
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const goHome = () => {
    return history.push('/home');
  }

  return confirmed ? (
    <Layout title="Your transaction is underway">
      <div className="body-description">
        You can follow your transaction under activity on your account screen.
      </div>
      <Button
        type="button"
        onClick={confirmingTransaction ? handleClosePopup : goHome}
      >
        Next
      </Button>
    </Layout>
  ) : (
    <div >
      <Header/>
      <section >Confirm</section>
      <section >
        <div >
          <Icon name="arrow-up" className="w-4 bg-brand-graydark100 text-brand-white" />
        </div>
        {tempTx?.isToken && tokenData && tokenData?.symbol ? `${String(tempTx.amount)} ${String(tokenData?.symbol)}` : `${(tempTx?.amount || 0) + (tempTx?.fee || 0)} SYS`}
      </section>
      <section >
        <div>
          <p>From</p>
          <span>
            {confirmingTransaction && connectedAccount ? connectedAccount?.label : accounts.find(element => element.id === activeAccountId)!.label || ''} (
            {ellipsis(tempTx!.fromAddress)})
          </span>
        </div>
        <div>
          <p>To</p>
          <span>{tempTx!.toAddress}</span>
        </div>
        <div>
          <p>Transaction fee</p>
          <span>
            {tempTx!.fee} SYS (≈ {getFiatAmount(tempTx?.fee || 0, 8)})
          </span>
        </div>
        {tempTx?.isToken && tokenData && (
          <div>
            <div>
              <p>Token being sent</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>
                  {tokenData?.symbol ? `${String(tokenData?.symbol)}` : null}
                </span>
                <span style={{ cursor: 'pointer' }} onClick={() => window.open(`${sysExplorer}/asset/${tokenData.assetGuid}`)}>See on SYS block explorer</span>
              </div>
            </div>

          </div>
        )}
      </section>
      <section>
        <div>
          <p>Max total</p>
          <span>
            {!tempTx?.isToken ? getFiatAmount(
              Number(tempTx?.amount || 0) + Number(tempTx?.fee || 0),
              8
            ) : `${String(tempTx?.amount)} ${tokenData?.symbol ? String(tokenData?.symbol) : 'SYS'}`}
          </span>
        </div>

        {confirmingTransaction && (
          <div>
            <span style={{ fontSize: '14px', margin: '0px' }}>Confirm transaction on {currentSenderURL}?</span>
          </div>
        )}

        <div>
          <Button
            type="button"
            onClick={confirmingTransaction ? handleCancelTransactionOnSite : handleCancel}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            onClick={handleConfirm}
          >
            {loading ? <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" /> : 'Confirm'}
          </Button>
        </div>
      </section>
    </div>
  );
};
