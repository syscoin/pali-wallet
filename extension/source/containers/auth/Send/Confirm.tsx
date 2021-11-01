import React, { useState } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import Spinner from '@material-ui/core/CircularProgress';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import { useHistory } from 'react-router-dom';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import { RootState } from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';
import { browser } from 'webextension-polyfill-ts';

import { ellipsis, formatURL } from '../helpers';
import { getHost } from '../../../scripts/Background/helpers';

import styles from './Confirm.scss';
import { useEffect } from 'react';
import { Assets } from 'scripts/types';

const SendConfirm = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const history = useHistory();
  const alert = useAlert();

  const { accounts, activeAccountId, tabs, confirmingTransaction }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const { currentSenderURL } = tabs;
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
        if (error && tempTx.fee > recommendedFee) {
          alert.removeAll();
          alert.error(`${formatURL(String(error.message), 166)} Please, reduce fees to send transaction.`);
        }

        if (error && tempTx.fee <= recommendedFee) {
          const max = 100 * tempTx.amount / accounts[activeAccountId].balance;

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
    <Layout title="Your transaction is underway" linkTo="/remind" showLogo>
      <div className="body-description">
        You can follow your transaction under activity on your account screen.
      </div>
      <Button
        type="button"
        theme="btn-gradient-primary"
        variant={styles.next}
        linkTo="/home"
        onClick={confirmingTransaction ? handleClosePopup : goHome}
      >
        Next
      </Button>
    </Layout>
  ) : (
    <div className={styles.wrapper}>
      <Header/>
      <section className={styles.subheading}>Confirm</section>
      <section className={styles.txAmount}>
        <div className={styles.iconWrapper}>
          <UpArrowIcon />
        </div>
        {tempTx?.isToken && tokenData && tokenData?.symbol ? `${String(tempTx.amount)} ${String(tokenData?.symbol)}` : `${(tempTx?.amount || 0) + (tempTx?.fee || 0)} SYS`}
      </section>
      <section className={styles.transaction}>
        <div className={styles.row}>
          <p>From</p>
          <span>
            {confirmingTransaction && connectedAccount ? connectedAccount?.label : accounts.find(element => element.id === activeAccountId)!.label || ''} (
            {ellipsis(tempTx!.fromAddress)})
          </span>
        </div>
        <div className={styles.row}>
          <p>To</p>
          <span>{tempTx!.toAddress}</span>
        </div>
        <div className={styles.row}>
          <p>Transaction fee</p>
          <span>
            {tempTx!.fee} SYS (≈ {getFiatAmount(tempTx?.fee || 0, 8)})
          </span>
        </div>
        {tempTx?.isToken && tokenData && (
          <div>
            <div className={styles.row}>
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
      <section className={styles.confirm}>
        <div className={styles.row}>
          <p>Max total</p>
          <span>
            {!tempTx?.isToken ? getFiatAmount(
              Number(tempTx?.amount || 0) + Number(tempTx?.fee || 0),
              8
            ) : `${String(tempTx?.amount)} ${tokenData?.symbol ? String(tokenData?.symbol) : 'SYS'}`}
          </span>
        </div>

        {confirmingTransaction && (
          <div className={styles.row}>
            <span style={{ fontSize: '14px', margin: '0px' }}>Confirm transaction on {currentSenderURL}?</span>
          </div>
        )}

        <div className={styles.actions}>
          <Button
            type="button"
            theme="btn-outline-secondary"
            variant={clsx(styles.button, styles.close)}
            onClick={confirmingTransaction ? handleCancelTransactionOnSite : handleCancel}
            linkTo="/home"
          >
            Cancel
          </Button>

          <Button
            type="submit"
            theme="btn-outline-primary"
            variant={styles.button}
            onClick={handleConfirm}
          >
            {loading ? <Spinner size={15} className={styles.spinner} /> : 'Confirm'}
          </Button>
        </div>
      </section>
    </div>
  );
};

export default SendConfirm;
