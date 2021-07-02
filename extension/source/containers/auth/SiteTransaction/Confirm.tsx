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
import CircularProgress from '@material-ui/core/CircularProgress';

interface IConfirmTransaction {
  transactionItem: any;
  itemStringToClearData: string;
  confirmTransaction: any;
  errorMessage: string;
  layoutTitle: string;
  data: any[];
  transactingStateItem: boolean;
}

const ConfirmTransaction: FC<IConfirmTransaction> = ({
  transactionItem,
  itemStringToClearData,
  confirmTransaction,
  errorMessage,
  layoutTitle,
  data,
  transactingStateItem
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
      
      console.log('error message', errorMessage)

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
          }, 9000);

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
    return (
      <div>
        {itemName == "notarydetails" && items && (
          <div>
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
        )}

        {itemName == "auxfeedetails" && items && (
          <div>
            {items.auxfees.map((auxfee: any, index: number) => {
              return (
                <div key={index} className={styles.options}>
                  <div className={styles.flex}>
                    <p>Bound</p>
                    <p>{auxfee.bound}</p>
                  </div>

                  <div className={styles.flex}>
                    <p>Percent</p>
                    <p>{auxfee.percent}</p>
                  </div>
                </div>
              )
            }) || 0}
          </div>
        )}
      </div>
    )
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
      {transactingStateItem && loading ? (
        <Layout title="" showLogo>
          <div className={styles.wrapper}>
            <section className={clsx(styles.mask)}>
              <CircularProgress className={styles.loader} />
            </section>
          </div>
        </Layout>
      ) : (
        <div>
          {transactionItemData && data && (
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
                        >
                          <span onClick={() => setExpanded(!expanded)} className={styles.selected}>
                            Advanced options
                      <DownArrowIcon className={styles.arrow} />
                          </span>
                          <ul className={styles.options}>
                            {advancedOptions && (
                              advancedOptions.map(({ label, value }) => {
                                console.log('advanced options', advancedOptions, label === "notaryAddress")
                                if (label && value !== undefined && value !== null) {
                                  if (label && value !== undefined && value !== null && value !== "0" && label !== "notarydetails" && label !== "auxfeedetails" && label !== "notaryAddress" && label !== "payoutAdress") {
                                    return (
                                      <div key={label} className={styles.flex}>
                                        <p>{label}</p>
                                        <p>{value}</p>
                                      </div>
                                    )
                                  }
                                  
                                  if (label == "contract") {
                                    return (
                                      <div key={label} className={styles.flex}>
                                        <p>{label}</p>
                                        <p>{formatURL(value)}</p>
                                      </div>
                                    )
                                  }
                                  
                                  if (label == "notaryAddress" || label == "payoutAddress") {
                                    console.log('ellipsis', ellipsis(value), value)
                                    return (
                                      <div key={label} className={styles.flex}>
                                        <p>{label}</p>
                                        <p>{ellipsis(value)}</p>
                                      </div>
                                    )
                                  }

                                  if (label == "notarydetails" || label == "auxfeedetails" && value !== null && value !== undefined) {
                                    return (
                                      <div key={label}>
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
      )}
    </div>
  );
};

export default ConfirmTransaction;
