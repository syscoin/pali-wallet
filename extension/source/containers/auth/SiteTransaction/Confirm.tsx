import React, { useState, useEffect, FC, useRef } from 'react';
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

import styles from './SiteTransaction.scss';
import { browser } from 'webextension-polyfill-ts';
import { getHost } from '../../../scripts/Background/helpers';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router';

interface IConfirmTransaction {
  transactionItem: any;
  itemStringToClearData: string;
  confirmTransaction: any;
  errorMessage: string;
  layoutTitle: string;
  data: any[];
}

const ConfirmTransaction: FC<IConfirmTransaction> = ({
  transactionItem,
  itemStringToClearData,
  confirmTransaction,
  errorMessage,
  layoutTitle,
  data
}) => {
  const controller = useController();
  const history = useHistory();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const transactionItemData = controller.wallet.account.getTransactionItem()[transactionItem];
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [expandedDetail, setExpandedDetail] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);
  const [dataToRender, setDataToRender] = useState<any[]>([]);
  const advancedOptionsArray = ['notarydetails', 'notaryAddress', 'auxfeedetails', 'payoutAddress', 'capabilityflags', 'contract']
  const alert = useAlert();
  const [advancedOptions, setAdvancedOptions] = useState<any[]>([]);
  // let dataToRender: any[] = [];

  useEffect(() => {
    if (data) {
      Object.entries(data).map(([key, value]) => {
        if (!dataToRender.includes({ label: key, value })) {
          setDataToRender([
            ...dataToRender,
            dataToRender.push({
              label: key,
              value
            }),
          ]);
          // dataToRender.push({
          //   label: key,
          //   value
          // })

          if (advancedOptionsArray.includes(key) && !advancedOptions.includes({ label: key, value })) {
            // const item = {
            //   label: key,
            //   value
            // };


            setAdvancedOptions([
              ...advancedOptions,
              advancedOptions.push({
                label: key,
                value
              })
            ]);

            // advancedOptions.push({ label: key, value })

            // console.log('includes', advancedOptions, dataToRender)

            // console.log(item)

            // if (dataToRender.includes(item)) {
            //   console.log('includes advanced')
            //   const index = dataToRender.indexOf({ label: key, value });

            //   console.log('data to render', dataToRender)

            //   dataToRender.splice(1, index);
            // }

            console.log('data to render and advanced options', dataToRender, advancedOptions)
          }

          return;

        }


      });

      setDataToRender([
        ...dataToRender,
        dataToRender.push({
          label: null,
          value: null
        }),
      ]);

      setAdvancedOptions([
        ...advancedOptions,
        advancedOptions.push({
          label: null,
          value: null
        })
      ]);

      console.log('advanced options ok', advancedOptions)
      // Object.freeze(dataToRender)


      // setDataToRender([
      //   ...dataToRender,
      //   dataToRender.push({
      //     label: 'foo',
      //     value: 'bar'
      //   })
      // ])
    }

    setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === getHost(currentSenderURL);
      })
    }))
  }, [
    data
  ]);

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
      item: itemStringToClearData ? itemStringToClearData : null
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

      confirmTransaction().then((error: any) => {
        if (error) {
          console.log('error', error)
          alert.removeAll();
          alert.error(errorMessage);

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: errorMessage
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
          alert.error(errorMessage);

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      }, 90000);
    }
  }

  const renderAdvancedDetails = (items: any, itemName: string) => {
    console.log('render advanced details', items, itemName)
    // return items.map(({ label, value }) => {
    return (
      <div>
        {/* {itemName == "notarydetails" && (
            <div>
              <p>Notary details:</p>
              
              <div className={styles.flex}>
                <p>Endpoint</p>
                <p>{formatURL(items.endpoint) || 'None'}</p>
              </div>

              <div className={styles.flex}>
                <p>Instant transfers</p>
                <p>{items.instanttransfers || 0}</p>
              </div>

              <div className={styles.flex}>
                <p>HD required</p>
                <p>{items.hdrequired ? 'Yes' : 'No'}</p>
              </div>
            </div>
          )} */}

        {itemName == "notarydetails" && (
          <div className={styles.select}>
            <div
              className={clsx(styles.fullselect, { [styles.expanded]: expandedDetail })}
              onClick={() => setExpandedDetail(!expandedDetail)}
            >
              <span className={styles.selected}>
                Notary details
              <DownArrowIcon className={styles.arrow} />
              </span>
              <ul className={styles.options}>
                <div className={styles.flex}>
                  <p>Endpoint</p>
                  <p>{formatURL(items.endpoint) || 'None'}</p>
                </div>

                <div className={styles.flex}>
                  <p>Instant transfers</p>
                  <p>{items.instanttransfers || 0}</p>
                </div>

                <div className={styles.flex}>
                  <p>HD required</p>
                  <p>{items.hdrequired ? 'Yes' : 'No'}</p>
                </div>
              </ul>
            </div>
          </div>
        )}

        {itemName == "auxfeedetails" && (
          <div>
            <p>Aux fee details:</p>

            <div className={styles.flex}>
              <p>{items.auxfeekeyid}</p>
            </div>

            <div className={styles.flex}>
              <p>Aux fees</p>
              <p>
                {items.auxfees.map((auxfee: any) => {
                  return (
                    <div className={styles.options}>
                      <div className={styles.flex}>
                        <p>Bound</p>
                        <p>{auxfee.bound}</p>
                      </div>

                      <div className={styles.flex}>
                        <p>Bound</p>
                        <p>{auxfee.percent}</p>
                      </div>
                    </div>
                  )
                }) || 0}
              </p>
            </div>
          </div>
        )}
      </div>
    )
    // })
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
      {transactionItemData && (
        <div>
          <Layout title={layoutTitle} showLogo>
            <div className={styles.wrapper}>
              <div>
                <section className={styles.data}>
                  {dataToRender.map((item: any) => {
                    if (item.label) {
                      if (item.label === "receiver") {
                        return (
                          <div key={item.label} className={styles.flex}>
                            <p>{item.label}</p>
                            <p>{ellipsis(item.value)}</p>
                          </div>
                        )
                      }

                      if (item.label === "rbf") {
                        return (
                          <div key={item.label} className={styles.flex}>
                            <p>{item.label}</p>
                            <p>{item.value ? 'Yes' : 'No'}</p>
                          </div>
                        )
                      }

                      if (advancedOptionsArray.includes(item.label)) {
                        return;
                      }

                      if (item.value !== null) {
                        return (
                          <div key={item.label} className={styles.flex}>
                            <p>{item.label}</p>
                            <p>{item.value}</p>
                          </div>
                        )
                      }

                      return null;
                    }
                  })}

                  <div className={styles.flex}>
                    <p>Site</p>
                    <p>{getHost(`${currentSenderURL}`)}</p>
                  </div>

                  <div className={styles.select}>
                    <div
                      className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
                      onClick={() => setExpanded(!expanded)}
                    >
                      <span className={styles.selected}>
                        Advanced options
                      <DownArrowIcon className={styles.arrow} />
                      </span>
                      <ul className={styles.options}>
                        {advancedOptions && (
                          advancedOptions.map(({ label, value }) => {
                            if (label) {
                              if (label && value !== undefined && value !== null && value !== "0" && label !== "notarydetails" && label !== "auxfeedetails") {
                                return (
                                  <div key={label} className={styles.flex}>
                                    <p>{label}</p>
                                    <p>{value}</p>
                                  </div>
                                )
                              }

                              if (label == "notaryAddress" || label == "payoutAddress") {
                                return (
                                  <div key={label} className={styles.flex}>
                                    <p>{label}</p>
                                    <p>{ellipsis(value)}</p>
                                  </div>
                                )
                              }

                              if (label == "notarydetails" || label == "auxfeedetails") {
                                console.log('value label details', value, label)
                                return (
                                  <div>
                                    {renderAdvancedDetails(value, label)}
                                  </div>
                                )
                              }
                            }

                            return null;
                          })
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* {advancedOptions && (
                    advancedOptions.map((option: any) => {
                      console.log('option', option)
                      return (
                        <div key={option.label} className={styles.select}>
                          <p>{option.label}</p>
                          <p>{option.value}</p>
                        </div>
                      )
                    })
                  )} */}



                  {/* <div className={styles.flex}>
                    <p>Asset GUID</p>
                    <p>{transactionItemData?.assetGuid}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Z-DAG</p>
                    <p>{transactionItemData?.rbf ? 'Yes' : 'No'}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Fee</p>
                    <p>{transactionItemData?.fee}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Description</p>
                    <p>{transactionItemData?.description}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Site</p>
                    <p>{getHost(`${currentSenderURL}`)}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Max total</p>
                    <p>{transactionItemData?.fee} SYS</p>
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
                        {transactionItemData?.capabilityflags && (
                          <div className={styles.flex}>
                            <p>Capability</p>
                            <p>{transactionItemData?.capabilityflags}</p>
                          </div>
                        )}

                        {transactionItemData?.notaryAddress && (
                          <div className={styles.flex}>
                            <p>Notary address</p>
                            <p>{ellipsis(transactionItemData?.notaryAddress)}</p>
                          </div>
                        )}

                        {transactionItemData?.payoutAddress && (
                          <div className={styles.flex}>
                            <p>Payout address</p>
                            <p>{ellipsis(transactionItemData?.payoutAddress)}</p>
                          </div>
                        )}

                        {transactionItemData?.notarydetails && (
                          <div>
                            <p>Notary details</p>
                            <div className={styles.flex}>
                              <p>Endpoint</p>
                              <p>{formatURL(transactionItemData?.notarydetails.endpoint) || 'None'}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Instant transfers</p>
                              <p>{transactionItemData?.notarydetails.instanttransfers || 0}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>HD required</p>
                              <p>{transactionItemData?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
                            </div>
                          </div>
                        )}

                        {transactionItemData?.auxfeedeetails && (
                          <div>
                            <p>Aux fee details</p>
                            <div className={styles.flex}>
                              <p>Aux fee key id</p>
                              <p>{transactionItemData?.auxfeedeetails.auxfeekeyid ? transactionItemData?.auxfeedeetails.auxfeekeyid : 'None'}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Bound</p>
                              <p>{transactionItemData?.auxfeedeetails.auxfees[0].bound ? transactionItemData?.auxfeedeetails.auxfees[0].bound : 0}</p>
                            </div>

                            <div className={styles.flex}>
                              <p>Percent</p>
                              <p>{transactionItemData?.auxfeedeetails.auxfees[0].percent ? transactionItemData?.auxfeedeetails.auxfees[0].percent : 0}</p>
                            </div>
                          </div>
                        )}
                      </ul>
                    </div>
                  </div> */}
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

export default ConfirmTransaction;
