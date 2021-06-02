import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import CheckIcon from '@material-ui/icons/CheckCircle';

import TextInput from 'components/TextInput';
import { RootState } from 'state/store';
import { ellipsis } from '../helpers';
import IWalletState from 'state/wallet/types';
import { useAlert } from 'react-alert';
import CircularProgress from '@material-ui/core/CircularProgress';

import styles from './IssueAsset.scss';
import { browser } from 'webextension-polyfill-ts';
import ReactTooltip from 'react-tooltip';
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import Switch from "react-switch";

const IssueAsset = () => {
  const controller = useController();
  const alert = useAlert();

  const { accounts, activeAccountId, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const mintSPT = controller.wallet.account.getIssueSPT();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState(0);
  const [recommend, setRecommend] = useState(0.00001);
  const [rbf, setRbf] = useState(false);
  const [issuingSPT, setIssuingSPT] = useState(false);

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then(response => {
      setRecommend(response);
      setFee(response);
    })
  };

  const handleConfirm = () => {
    if (accounts[activeAccountId].balance > 0) {
      try {
        controller.wallet.account.confirmIssueSPT();

        setConfirmed(true);
        setLoading(false);
      } catch (error) {
        alert.removeAll();
        alert.error('Sorry, an error has occurred.');
        handleCancelTransactionOnSite();
      }
    }
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
      target: "background"
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleMessageToMintSPT = () => {
    controller.wallet.account.setDataFromWalletToMintSPT({
      fee,
      rbf
    });

    browser.runtime.sendMessage({
      type: 'DATA_FROM_WALLET_TO_MINT_TOKEN',
      target: 'background'
    });

    setIssuingSPT(true);
    setLoading(true);
  }

  const handleTypeChanged = useCallback((rbf: boolean) => {
    setRbf(rbf);
  }, []);

  return confirmed ? (
    <Layout title="Your transaction is underway" showLogo>
      <CheckIcon className={styles.checked} />

      <div
        className="body-description"
      >
        Your Tokens is in minting process, you can check the transaction under your history.
      </div>

      <Button
        type="button"
        theme="btn-gradient-primary"
        variant={ styles.next }
        linkTo="/home"
        onClick={ handleClosePopup }
      >
        Ok
      </Button>
    </Layout>
  ) : (
    <div>
      {mintSPT ? (
        <Layout title="Issue Token" showLogo>
          <div className={styles.wrapper}>
            <div>
              <section className={styles.data}>
                <div className={styles.flex}>
                  <p>Amount</p>
                  <p>{mintSPT?.amount}</p>
                </div>

                <div className={styles.flex}>
                  <p>RBF</p>
                  <p>{rbf ? 'Yes' : 'No'}</p>
                </div>

                <div className={styles.flex}>
                  <p>Receiver</p>
                  <p>{ellipsis(mintSPT?.receiver)}</p>
                </div>

                <div className={styles.flex}>
                  <p>Fee</p>
                  <p>{fee}</p>
                </div>

                <div className={styles.flex}>
                  <p>Asset guid</p>
                  <p>{mintSPT?.assetGuid}</p>
                </div>

                <div className={styles.flex}>
                  <p>Site</p>
                  <p>{currentSenderURL}</p>
                </div>

                <div className={styles.flex}>
                  <p>Max total</p>
                  <p>{fee}</p>
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
                    Confirm
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </Layout>
      ) : (
        <div>
          {issuingSPT && loading ? (
            <Layout title="" showLogo>
              <div className={styles.wrapper}>
                <section className={clsx(styles.mask)}>
                  <CircularProgress className={styles.loader} />
                </section>
              </div>
            </Layout>
          ) : (
            <div>
              <Layout title="Mint token" showLogo>
                <div className={styles.wrapper}>
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

                  <p>With current network conditions, we recommend a fee of {recommend} SYS.</p>

                  <label htmlFor="rbf">RBF:</label>
                  <Switch
                    checked={rbf}
                    onChange={handleTypeChanged}
                  ></Switch>

                  <li className={styles.item}>
                    <div className={styles.zDag}>
                      <label htmlFor="rbf">Z-DAG</label>

                      <div className={styles.tooltip}>
                        <HelpOutlineIcon
                          style={{ width: '17px', height: '17px' }}
                          data-tip
                          data-for="zdag_info"
                        />
                        <ReactTooltip id="zdag_info"
                            getContent={() =>
                              <div style={{ backgroundColor: 'white' }}>
                                <small style={{ fontWeight: 'bold' }}>
                                  OFF for Replace-by-fee (RBF) and ON for Z-DAG <br/> Z-DAG: a exclusive Syscoin feature. <br/> To know more: <br/>
                                  <span
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => {
                                      window.open("https://syscoin.org/news/what-is-z-dag");
                                    }}
                                  >
                                    What is Z-DAG?
                                  </span>
                                </small>
                              </div>
                            }
                            backgroundColor="white"
                            textColor="black"
                            borderColor="#4d76b8"
                            effect='solid'
                            delayHide={300}
                            delayShow={300}
                            delayUpdate={300}
                            place={'top'}
                            border={true}
                            type={'info'}
                            multiline={true}
                          />
                      </div>
                    </div>
                    
                    <Switch
                      offColor="#333f52"
                      height={20}
                      width={60}
                      checked={rbf}
                      onChange={handleTypeChanged}
                    ></Switch>
                  </li>

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
                        onClick={handleMessageToMintSPT}
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

export default IssueAsset;