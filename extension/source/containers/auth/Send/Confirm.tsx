import React, { useState } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import CheckIcon from '@material-ui/icons/CheckCircle';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import { RootState } from 'state/store';
import { ellipsis } from '../helpers';
import IWalletState from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './Confirm.scss';
import { browser } from 'webextension-polyfill-ts';

const SendConfirm = () => {
  const controller = useController();
  const getFiatAmount = useFiat();

  const { accounts, activeAccountId, currentSenderURL, confirmingTransaction }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const tempTx = controller.wallet.account.getTempTx();
  const [confirmed, setConfirmed] = useState(false);
  const alert = useAlert();

  const handleConfirm = () => {
    if (accounts[activeAccountId].balance > 0) {
      controller.wallet.account.confirmTempTx().then(result => {
        if (result) {
          alert.removeAll();
          alert.error(result.message);
  
          return;
        }
        
        setConfirmed(true);
      });

      return;
    }

    return;
  };

  const handleClosePopup = () => {
    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleCancelConfirmOnSite = () => {
    browser.runtime.sendMessage({
      type: "CANCEL_TRANSACTION",
      target: "background"
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  return confirmed ? (
    <Layout title="Your transaction is underway" linkTo="/remind" showLogo>
      <CheckIcon className={styles.checked} />
      <div className="body-description">
        You can follow your transaction under activity on your account screen.
      </div>
      <Button
        type="button"
        theme="btn-gradient-primary"
        variant={styles.next} 
        linkTo="/home"
        onClick={confirmingTransaction ? handleClosePopup : undefined}
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
        {tempTx?.isToken ? String(tempTx.amount) + " " + String(tempTx.token?.symbol) : ((tempTx?.amount || 0) + (tempTx?.fee || 0)) + " SYS"}
      </section>
      <section className={styles.transaction}>
        <div className={styles.row}>
          From
          <span>
            {accounts[activeAccountId]?.label || ''} (
            {ellipsis(tempTx!.fromAddress)})
          </span>
        </div>
        <div className={styles.row}>
          To
          <span>{tempTx!.toAddress}</span>
        </div>
        <div className={styles.row}>
          Transaction Fee
          <span>
            {tempTx!.fee} SYS (≈ {getFiatAmount(tempTx?.fee || 0, 8)})
          </span>
        </div>
      </section>
      <section className={styles.confirm}>
        <div className={styles.row}>
          Max Total
          <span>
            {!tempTx?.isToken ? getFiatAmount(
              Number(tempTx?.amount || 0) + Number(tempTx?.fee || 0),
              8
            ) : String(tempTx?.amount) + " " + String(tempTx?.token?.symbol)}
          </span>
        </div>

        {confirmingTransaction && (
          <p className={styles.confirmTransactionOnSite}>Confirm transaction on {currentSenderURL}?</p>
        )}

        <div className={styles.actions}>
          <Button
            type="button"
            theme="secondary"
            variant={clsx(styles.button, styles.close)}
            onClick={confirmingTransaction ? handleCancelConfirmOnSite : undefined}
          >
            Cancel
          </Button>

          <Button type="submit" variant={styles.button} onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </section>
    </div>
  );
};

export default SendConfirm;
