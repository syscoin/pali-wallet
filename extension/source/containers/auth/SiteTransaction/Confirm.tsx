import React, { useState, useEffect, FC } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';
import { browser } from 'webextension-polyfill-ts';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router';
import CircularProgress from '@material-ui/core/CircularProgress';

import { getHost } from '../../../scripts/Background/helpers';
import { ellipsis, formatURL } from '../helpers';

import styles from './SiteTransaction.scss';

interface IConfirmTransaction {
  confirmTransaction: any;
  data: any[];
  errorMessage: string;
  itemStringToClearData: string;
  layoutTitle: string;
  transactingStateItem: boolean;
  transactionItem: any;
}

const ConfirmTransaction: FC<IConfirmTransaction> = ({
  transactionItem,
  itemStringToClearData,
  confirmTransaction,
  errorMessage,
  layoutTitle,
  data,
  transactingStateItem,
}) => {
  const controller = useController();
  const history = useHistory();
  const alert = useAlert();

  const { accounts, tabs }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const { currentSenderURL } = tabs;

  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const transactionItemData =
    controller.wallet.account.getTransactionItem()[transactionItem];
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);
  const [dataToRender, setDataToRender] = useState<any[]>([]);
  const [advancedOptions, setAdvancedOptions] = useState<any[]>([]);  const [recommendedFee, setRecommendedFee] = useState(0.00001);

  const advancedOptionsArray = [
    'notarydetails',
    'notaryAddress',
    'auxfeedetails',
    'payoutAddress',
    'capabilityflags',
    'contract',
  ];

  useEffect(() => {
    controller.wallet.account.getRecommendFee().then((response: any) => {
      setRecommendedFee(response);
    })
  }, []);

  useEffect(() => {
    if (data) {
      let newData: any = {};
      let newAdvancedOptions: any = {};

      Object.entries(data).map(([key, value]) => {
        if (!newData[key]) {
          newData[key] = {
            label: key,
            value,
          };
        }

        if (advancedOptionsArray.includes(key) && !newAdvancedOptions[key]) {
          newAdvancedOptions[key] = {
            label: key,
            value,
          };;
        }
      });

      setDataToRender(Object.values(newData))
      setAdvancedOptions(Object.values(newAdvancedOptions))

      console.log(newData, dataToRender, advancedOptions)
    }

    setConnectedAccountId(
      accounts.findIndex((account: IAccountState) => {
        return account.connectedTo.filter((url: string) => {
          return url === getHost(currentSenderURL);
        });
      })
    );
  }, [data]);

  const handleRejectTransaction = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: 'WALLET_ERROR',
      target: 'background',
      transactionError: true,
      invalidParams: false,
      message: "Transaction rejected.",
    });

    browser.runtime.sendMessage({
      type: 'CANCEL_TRANSACTION',
      target: 'background',
      item: itemStringToClearData || null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  }

  const handleClosePopup = () => {
    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });

    history.push('/home');
  };

  const handleCancelTransactionOnSite = () => {
    browser.runtime.sendMessage({
      type: 'CANCEL_TRANSACTION',
      target: 'background',
      item: itemStringToClearData || null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });

    history.push('/home');
  };

  const handleConfirm = () => {
    const acc = accounts.find((element) => element.id === connectedAccountId);
    let isPending = false;

    if ((acc ? acc.balance : -1) > 0) {
      setLoadingConfirm(true);
      setLoading(true);
      isPending = true;

      confirmTransaction()
        .then((response: any) => {
          isPending = false;

          setConfirmed(true);
          setLoading(false);
          setLoadingConfirm(false);

          if (response) {
            browser.runtime.sendMessage({
              type: 'TRANSACTION_RESPONSE',
              target: 'background',
              response,
            });
          }
        })
        .catch((error: any) => {
          if (error && transactionItemData.fee > recommendedFee) {
            alert.removeAll();
            alert.error(`${formatURL(String(error.message), 166)} Please, reduce fees to send transaction.`);
          }
  
          if (error && transactionItemData < recommendedFee) {
            alert.removeAll();
            alert.error(errorMessage);
          }

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: errorMessage
          });

          alert.removeAll();
          alert.error(errorMessage);

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);

          console.log(error);
        });

      setTimeout(() => {
        if (isPending && !confirmed) {
          alert.removeAll();
          alert.error(errorMessage);

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      }, 8 * 60 * 1000);
    }
  };

  const renderData = () => {
    return dataToRender.map(({ label, value }) => {
      if (label) {
        if (
          label === 'receiver' ||
          label === 'issuer' ||
          label === 'newOwner' ||
          label === 'description'
        ) {
          return (
            <div key={label} className={styles.flex}>
              <p>{label}</p>
              <p>{ellipsis(value)}</p>
            </div>
          );
        }

        if (advancedOptionsArray.includes(label)) {
          return;
        }

        return (
          <div key={label} className={styles.flex}>
            <p>{label}</p>
            <p>{value}</p>
          </div>
        );
      }

      return null;
    });
  };

  const renderOptions = () => {
    return advancedOptions.map(({ label, value }) => {
      if (label && value) {
        if (label == 'contract') {
          return (
            <div key={label} className={styles.flex}>
              <p>{label}</p>
              <p>{formatURL(value)}</p>
            </div>
          );
        }

        if (label == 'notaryAddress' || label == 'payoutAddress') {
          return (
            <div key={label} className={styles.flex}>
              <p>{label}</p>
              <p>{ellipsis(value)}</p>
            </div>
          );
        }

        if (label == 'notarydetails' || label == 'auxfeedetails') {
          return <div key={label}>{renderAdvancedDetails(value, label)}</div>;
        }

        return (
          <div key={label} className={styles.flex}>
            <p>{label}</p>
            <p>{value}</p>
          </div>
        );
      }

      return null;
    });
  };

  const renderAdvancedDetails = (items: any, itemName: string) => {
    return (
      <div>
        {itemName == 'notarydetails' && items && items.endpoint !== '' && (
          <div>
            <div className={styles.flex}>
              <p>Endpoint</p>
              <p>{formatURL(items.endpoint)}</p>
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

        {itemName == 'auxfeedetails' && items && (
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
              );
            }) || 0}
          </div>
        )}
      </div>
    );
  };

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
          {transactionItemData && data && !loading && (
            <div>
              <Layout title={layoutTitle} showLogo>
                <div className={styles.wrapper}>
                  <div>
                    <section className={styles.data}>
                      {renderData()}

                      <div className={styles.flex}>
                        <p>Site</p>
                        <p>{getHost(`${currentSenderURL}`)}</p>
                      </div>

                      <div className={styles.select}>
                        <div
                          className={clsx(styles.fullselect, {
                            [styles.expanded]: expanded,
                          })}
                        >
                          <span
                            onClick={() => setExpanded(!expanded)}
                            className={styles.selected}
                          >
                            Advanced options
                            <DownArrowIcon className={styles.arrow} />
                          </span>

                          <ul className={styles.options}>{renderOptions()}</ul>
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
                          onClick={handleRejectTransaction}
                        >
                          Reject
                        </Button>

                        <Button
                          type="submit"
                          theme="btn-outline-primary"
                          variant={styles.button}
                          onClick={handleConfirm}
                          loading={loading}
                          disabled={!transactionItemData}
                        >
                          {loadingConfirm ? (
                            <Spinner size={15} className={styles.spinner} />
                          ) : (
                            'Confirm'
                          )}
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
