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

import { ellipsis } from '../helpers';
import { getHost } from '../../../scripts/Background/helpers';

import styles from './Confirm.scss';

const SendConfirm = () => {
  const controller = useController();
  const getFiatAmount = useFiat();
  const history = useHistory();

  const { accounts, activeAccountId, currentSenderURL, confirmingTransaction }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const connectedAccount = accounts.find((account: IAccountState) => {
    return account.connectedTo.find((url: any) => {
      return url === getHost(currentSenderURL);
    });
  });
  const { tempTx } = controller.wallet.account.getTransactionItem();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const alert = useAlert();

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
      }).catch((error) => {
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

          setLoading(false);

          
        }
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
      <Header backLink="/send" />
      <section className={styles.subheading}>Confirm</section>
      <section className={styles.txAmount}>
        <div className={styles.iconWrapper}>
          <UpArrowIcon />
        </div>
        {tempTx?.isToken ? `${String(tempTx.amount)} ${String(tempTx.token?.symbol)}` : `${(tempTx?.amount || 0) + (tempTx?.fee || 0)} SYS`}
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
      </section>
      <section className={styles.confirm}>
        <div className={styles.row}>
          <p>Max total</p>
          <span>
            {!tempTx?.isToken ? getFiatAmount(
              Number(tempTx?.amount || 0) + Number(tempTx?.fee || 0),
              8
            ) : `${String(tempTx?.amount)} ${String(tempTx?.token?.symbol)}`}
          </span>
        </div>

        {confirmingTransaction && (
          <p className={styles.confirmTransactionOnSite}>Confirm transaction on {currentSenderURL}?</p>
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
            theme="btn-outline-confirm"
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
