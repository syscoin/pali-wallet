import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

// import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
// import { useFiat } from 'hooks/usePrice';
// import { useHistory } from 'react-router-dom';
import CheckIcon from '@material-ui/icons/CheckCircle';
// import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import { RootState } from 'state/store';
// import { ellipsis } from '../helpers';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './UpdateAsset.scss';
import { browser } from 'webextension-polyfill-ts';
import { getHost } from '../../../scripts/Background/helpers';

const UpdateConfirm = () => {
  const controller = useController();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const updateAsset = controller.wallet.account.getNewUpdateAsset();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const alert = useAlert();

  useEffect(() => {
    setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === getHost(currentSenderURL);
      })
    }))
  }, []);

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
      item: updateAsset ? 'updateAssetItem' : null
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleConfirm = () => {
    let acc = accounts.find(element => element.id === connectedAccountId)

    if ((acc ? acc.balance : -1) > 0) {
      controller.wallet.account.confirmUpdateAssetTransaction().then((error: any) => {
        if (error) {
          alert.removeAll();
          alert.error('Can\'t update token. Try again later.');
            
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
      });
    }
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
        onClick={handleClosePopup}
      >
        Ok
      </Button>
    </Layout>
  ) : (
    <div>
      {updateAsset && (
        <div>
          <Layout title="Update Token" showLogo>
            <div className={styles.wrapper}>
              <div>
                <section className={styles.data}>
                  <div className={styles.flex}>
                    <p>Asset GUID</p>
                    <p>{updateAsset?.assetGuid}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Z-DAG</p>
                    <p>{updateAsset?.rbf ? 'Yes' : 'No'}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Fee</p>
                    <p>{updateAsset?.fee}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Description</p>
                    <p>{updateAsset?.description}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Site</p>
                    <p>{currentSenderURL}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Max total</p>
                    <p>{updateAsset?.fee} SYS</p>
                  </div>
                </section>

                <section className={styles.confirm}>
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      theme="btn-outline-secondary"
                      variant={clsx(styles.button, styles.close)}
                      linkTo="/home"
                      onClick={handleCancelTransactionOnSite}
                    >
                      Reject
                     </Button>

                    <Button
                      type="submit"
                      theme="btn-outline-primary"
                      variant={styles.button}
                      onClick={handleConfirm}
                      loading={loading}
                    >
                      Confirm
                     </Button>
                  </div>
                </section>
              </div>
            </div>
          </Layout>
        </div>
      )}
    </div>
  );
};

export default UpdateConfirm;
