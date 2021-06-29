import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

// import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatURL } from '../helpers';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './UpdateAsset.scss';
import { browser } from 'webextension-polyfill-ts';
import { getHost } from '../../../scripts/Background/helpers';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router';

const UpdateConfirm = () => {
  const controller = useController();
  const history = useHistory();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const updateAsset = controller.wallet.account.getNewUpdateAsset();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);
  const alert = useAlert();

  useEffect(() => {
    setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === getHost(currentSenderURL);
      })
    }))
  }, []);

  const handleClosePopup = () => {
    history.push('/home');
    
    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleCancelTransactionOnSite = () => {
    history.push('/home');
    
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
    let isPending = false;

    if ((acc ? acc.balance : -1) > 0) {
      setLoadingConfirm(true);
      isPending = true;

      controller.wallet.account.confirmUpdateAssetTransaction().then((error: any) => {
        if (error) {
          console.log('error', error)
          alert.removeAll();
          alert.error('Can\'t update token. Try again later.');

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: "Can't update token. Try again later"
          });
          
          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
          
          return;
        }
        
        isPending = false;

        setConfirmed(true);
        setLoading(false);
        setLoadingConfirm(false);
      });
      
      setTimeout(() => {
        if (isPending && !confirmed) {
          alert.removeAll();
          alert.error('Can\'t update token. Please, try again later.');
          
          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      }, 90000);
    }
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
                    <p>{getHost(`${currentSenderURL}`)}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Max total</p>
                    <p>{updateAsset?.fee} SYS</p>
                  </div>


                  <div
                    className={styles.select}
                    id="asset"
                  >
                    <div
                      className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
                      onClick={() => setExpanded(!expanded)}
                    >
                      <span className={styles.selected}>
                        Advanced options
                      <DownArrowIcon className={styles.arrow} />
                      </span>
                      <ul className={styles.options}>
                        {updateAsset?.capabilityflags && (
                          <div className={styles.flex}>
                            <p>Capability</p>
                            <p>{updateAsset?.capabilityflags}</p>
                          </div>
                        )}

                        {updateAsset?.notaryAddress && (
                          <div className={styles.flex}>
                            <p>Notary address</p>
                            <p>{ellipsis(updateAsset?.notaryAddress)}</p>
                          </div>
                        )}

                        {updateAsset?.payoutAddress && (
                          <div className={styles.flex}>
                            <p>Payout address</p>
                            <p>{ellipsis(updateAsset?.payoutAddress)}</p>
                          </div>
                        )}

                        {updateAsset?.notarydetails && (
                          <div>
                            <p>Notary details</p>
                            <div className={styles.flex}>
                              <p>Endpoint</p>
                              <p>{formatURL(updateAsset?.notarydetails.endpoint) || 'None'}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Instant transfers</p>
                              <p>{updateAsset?.notarydetails.instanttransfers || 0}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>HD required</p>
                              <p>{updateAsset?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
                            </div>
                          </div>
                        )}

                        {updateAsset?.auxfeedeetails && (
                          <div>
                            <p>Aux fee details</p>
                            <div className={styles.flex}>
                              <p>Aux fee key id</p>
                              <p>{updateAsset?.auxfeedeetails.auxfeekeyid ? updateAsset?.auxfeedeetails.auxfeekeyid : 'None'}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Bound</p>
                              <p>{updateAsset?.auxfeedeetails.auxfees[0].bound ? updateAsset?.auxfeedeetails.auxfees[0].bound : 0}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Percent</p>
                              <p>{updateAsset?.auxfeedeetails.auxfees[0].percent ? updateAsset?.auxfeedeetails.auxfees[0].percent : 0}</p>
                            </div>
                          </div>
                        )}
                      </ul>
                    </div>
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
                      {loadingConfirm ? <Spinner size={15} className={styles.spinner} /> : 'Confirm'}
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
