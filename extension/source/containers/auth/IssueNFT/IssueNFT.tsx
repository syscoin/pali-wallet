import React, { useState, useCallback, useEffect } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';

import TextInput from 'components/TextInput';
import { RootState } from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './IssueNFT.scss';
import { browser } from 'webextension-polyfill-ts';
import { getHost } from '../../../scripts/Background/helpers';
import { ellipsis, formatURL } from '../helpers';
import Switch from "react-switch";
import CircularProgress from '@material-ui/core/CircularProgress';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router-dom';

const IssueNFT = () => {
  const controller = useController();
  const alert = useAlert();
  const history = useHistory();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const mintNFT = controller.wallet.account.getTransactionItem().mintNFT;
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState(0);
  const [recommend, setRecommend] = useState(0.00001);
  const [rbf, setRbf] = useState(false);
  const [issuingNFT, setIssuingNFT] = useState(false);
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then(response => {
      setRecommend(response);
      setFee(response);
    })
  };

  useEffect(() => {
    setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === getHost(currentSenderURL);
      });
    }));
  }, []);

  const handleConfirm = () => {
    let acc = accounts.find(element => element.id === connectedAccountId);
    let isPending = false;

    if ((acc ? acc.balance : -1) > 0) {
      setLoadingConfirm(true);
      isPending = true;
      
      controller.wallet.account.confirmIssueNFT().then((error: any) => {
        if (error) {
          alert.removeAll();
          alert.error('Can\'t issue token. Try again later.');

          console.log('error', error)

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: "Can't create and issue NFT. Try again later"
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
          alert.error('Can\'t create and issue NFT. Please, try again later.');
          
          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      }, 360000);
    }
  }
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
      item: mintNFT ? 'mintNFT' : null
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleMessageToMintNFT = () => {
    controller.wallet.account.setDataFromWalletToMintNFT({
      fee,
      rbf
    });

    browser.runtime.sendMessage({
      type: 'DATA_FROM_WALLET_TO_MINT_NFT',
      target: 'background'
    });

    setIssuingNFT(true);
    setLoading(true);
  }

  const handleTypeChanged = useCallback((rbf: boolean) => {
    setRbf(rbf);
  }, []);

  return confirmed ? (
    <Layout title="Your transaction is underway" showLogo>
      <div
        className="body-description"
      >
        Your token is in creating and minting process, you can check the transaction under your history.
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
      {mintNFT ? (
        <Layout title="Create and issue NFT" showLogo>
          <div className={styles.wrapper}>
            <div>
              <section className={styles.data}>
                <div className={styles.flex}>
                  <p>Z-DAG</p>
                  <p>{rbf ? 'Yes' : 'No'}</p>
                </div>

                <div className={styles.flex}>
                  <p>Fee</p>
                  <p>{fee}</p>
                </div>

                <div className={styles.flex}>
                  <p>Symbol</p>
                  <p>{mintNFT?.symbol}</p>
                </div>

                <div className={styles.flex}>
                  <p>Issuer</p>
                  <p>{ellipsis(mintNFT?.issuer)}</p>
                </div>

                <div className={styles.flex}>
                  <p>Site</p>
                  <p>{getHost(`${currentSenderURL}`)}</p>
                </div>

                <div className={styles.flex}>
                  <p>Max total</p>
                  <p>{fee}</p>
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
                      {mintNFT?.capabilityflags && (
                        <div className={styles.flex}>
                          <p>Capability</p>
                          <p>{mintNFT?.capabilityflags}</p>
                        </div>
                      )}

                      {mintNFT?.notaryAddress && (
                        <div className={styles.flex}>
                          <p>Notary address</p>
                          <p>{ellipsis(mintNFT?.notaryAddress)}</p>
                        </div>
                      )}

                      {mintNFT?.payoutAddress && (
                        <div className={styles.flex}>
                          <p>Payout address</p>
                          <p>{ellipsis(mintNFT?.payoutAddress)}</p>
                        </div>
                      )}

                      {mintNFT?.notarydetails && (
                        <div>
                          <p>Notary details</p>
                          <div className={styles.flex}>
                            <p>Endpoint</p>
                            <p>{formatURL(mintNFT?.notarydetails.endpoint) || 'None'}</p>
                          </div>

                          <div className={styles.flex}>
                            <p>Instant transfers</p>
                            <p>{mintNFT?.notarydetails.instanttransfers || 0}</p>
                          </div>

                          <div className={styles.flex}>
                            <p>HD required</p>
                            <p>{mintNFT?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
                          </div>
                        </div>
                      )}

                      {mintNFT?.auxfeedeetails && (
                        <div>
                          <p>Aux fee details</p>
                          <div className={styles.flex}>
                            <p>Aux fee key id</p>
                            <p>{mintNFT?.auxfeedeetails.auxfeekeyid ? mintNFT?.auxfeedeetails.auxfeekeyid : 'None'}</p>
                          </div>

                          <div className={styles.flex}>
                            <p>Bound</p>
                            <p>{mintNFT?.auxfeedeetails.auxfees[0].bound ? mintNFT?.auxfeedeetails.auxfees[0].bound : 0}</p>
                          </div>

                          <div className={styles.flex}>
                            <p>Percent</p>
                            <p>{mintNFT?.auxfeedeetails.auxfees[0].percent ? mintNFT?.auxfeedeetails.auxfees[0].percent : 0}</p>
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
                    onClick={handleCancelTransactionOnSite}
                  >
                    Reject
                </Button>

                  <Button
                    type="submit"
                    theme="btn-outline-primary"
                    variant={styles.button}
                    onClick={handleConfirm}
                  >
                       {loadingConfirm ? <Spinner size={15} className={styles.spinner} /> : 'Confirm'}
                </Button>
                </div>
              </section>
            </div>
          </div>
        </Layout>
      ) : (
        <div>
          {issuingNFT && loading ? (
            <Layout title="" showLogo>
              <div className={styles.wrapper}>
                <section className={clsx(styles.mask)}>
                  <CircularProgress className={styles.loader} />
                </section>
              </div>
            </Layout>
          ) : (
            <div>
              <Layout title="Create and issue NFT" showLogo>
                <div className={styles.wrapper}>
                  <label htmlFor="fee">Fee</label>

                  <section className={styles.fee}>
                    <TextInput
                      type="number"
                      placeholder="Enter fee"
                      fullWidth
                      name="fee"
                      value={fee}
                      onChange={(event) => setFee(Number(event.target.value))}
                    />
                    <Button
                      type="button"
                      variant={styles.textBtn}
                      onClick={handleGetFee}
                    >
                      Recommend
                  </Button>
                  </section>

                  <p className={styles.description}>With current network conditions, we recommend a fee of {recommend} SYS.</p>

                  <div className={styles.rbf}>
                    <label htmlFor="rbf">Z-DAG</label>

                    <Switch
                      offColor="#333f52"
                      height={20}
                      width={60}
                      checked={rbf}
                      onChange={handleTypeChanged}
                    />
                  </div>

                  <section className={styles.confirm}>
                    <div className={styles.actions}>
                      <Button
                        type="button"
                        theme="btn-outline-secondary"
                        variant={clsx(styles.button, styles.close)}
                        onClick={handleCancelTransactionOnSite}
                      >
                        Reject
                    </Button>

                      <Button
                        type="submit"
                        theme="btn-outline-primary"
                        variant={styles.button}
                        onClick={handleMessageToMintNFT}
                        disabled={!fee}
                      >
                        Next
                    </Button>
                    </div>
                  </section>
                </div>
              </Layout>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IssueNFT;