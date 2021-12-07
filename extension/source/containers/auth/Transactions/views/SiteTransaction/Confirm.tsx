import React, { useState, useEffect, FC } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { Button, Icon } from 'components/index';;
import { useController } from 'hooks/index';
import { IAccountState } from 'state/wallet/types';
import { browser } from 'webextension-polyfill-ts';

import { useStore, useUtils, useFormat } from 'hooks/index';

interface IConfirmTransaction {
  confirmTransaction: any;
  data: any[];
  errorMessage: string;
  itemStringToClearData: string;
  layoutTitle: string;
  transactingStateItem: boolean;
  transactionItem: any;
}

export const ConfirmTransaction: FC<IConfirmTransaction> = ({
  transactionItem,
  itemStringToClearData,
  confirmTransaction,
  errorMessage,
  layoutTitle,
  data,
  transactingStateItem,
}) => {
  const controller = useController();

  const { getHost, alert, history } = useUtils();
  const { ellipsis, formatURL } = useFormat();
  const { accounts, currentSenderURL } = useStore();

  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const transactionItemData =
    controller.wallet.account.getTransactionItem()[transactionItem];
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);
  const [dataToRender, setDataToRender] = useState<any[]>([]);
  const [advancedOptions, setAdvancedOptions] = useState<any[]>([]); const [recommendedFee, setRecommendedFee] = useState(0.00001);
  const [assetData, setAssetData] = useState<any>({});

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
      console.log('data', data)
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
    }

    setConnectedAccountId(
      accounts.findIndex((account: IAccountState) => {
        return account.connectedTo.filter((url: string) => {
          return url === getHost(currentSenderURL);
        });
      })
    );
  }, [data]);

  useEffect(() => {
    dataToRender.map((data) => {
      if (data.label === 'assetGuid' && itemStringToClearData !== 'newSPT' && itemStringToClearData !== 'mintNFT') {
        controller.wallet.account.getDataAsset(data.value).then((response: any) => {
          setAssetData(response);
        })
      }
    })
  }, [dataToRender]);

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

    handleClosePopup();
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
        });

      setTimeout(() => {
        if (isPending && !confirmed) {
          alert.removeAll();
          
          if (itemStringToClearData === 'mintNFT') {
            alert.show('Waiting for confirmation to create and issue your NFT. You can check this transaction in your history.', {
              timeout: 5000,
              type: 'success'
            });

            setTimeout(() => {
              handleCancelTransactionOnSite();
            }, 4000);

            return;
          }

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
            <div key={label}>
              <p>{label}</p>
              <p>{ellipsis(value)}</p>
            </div>
          );
        }

        if (advancedOptionsArray.includes(label)) {
          return;
        }

        if (label === "assetGuid") {
          return;
        }

        return (
          <div key={label}>
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
            <div key={label}>
              <p>{label}</p>
              <p>{formatURL(value)}</p>
            </div>
          );
        }

        if (label == 'notaryAddress' || label == 'payoutAddress') {
          return (
            <div key={label}>
              <p>{label}</p>
              <p>{ellipsis(value)}</p>
            </div>
          );
        }

        if (label == 'notarydetails' || label == 'auxfeedetails') {
          return <div key={label}>{renderAdvancedDetails(value, label)}</div>;
        }

        return (
          <div key={label}>
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
            <div>
              <p>Endpoint</p>
              <p>{formatURL(items.endpoint)}</p>
            </div>

            <div>
              <p>Instant transfers</p>
              <p>{items.instanttransfers || 0}</p>
            </div>

            <div>
              <p>HD required</p>
              <p>{items.hdrequired ? 'Yes' : 'No'}</p>
            </div>
          </div>
        )}

        {itemName == 'auxfeedetails' && items && (
          <div>
            {items.auxfees.map((auxfee: any, index: number) => {
              return (
                <div key={index} >
                  <div>
                    <p>Bound</p>
                    <p>{auxfee.bound}</p>
                  </div>

                  <div>
                    <p>Percent</p>
                    <p>{auxfee.percent}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return confirmed ? (
    <AuthViewLayout title="Your transaction is underway">
      <div className="body-description">
        You can follow your transaction under activity on your account screen.
      </div>
      <Button
        type="button"
        onClick={handleClosePopup}
      >
        Ok
      </Button>
    </AuthViewLayout>
  ) : (
    <div>
      {transactingStateItem && loading ? (
        <AuthViewLayout title="">
          <div >
            <section>
              <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" />
            </section>
          </div>
        </AuthViewLayout>
      ) : (
        <div>
          {transactionItemData && data && !loading && (
            <div>
              <AuthViewLayout title={layoutTitle}>
                <div >
                  <div>
                    <section >
                      {renderData()}

                      {assetData && itemStringToClearData !== 'newSPT' && itemStringToClearData !== 'mintNFT' && (
                        <div>
                          <div key="symbol">
                            <p>symbol</p>
                            <p>{assetData && assetData.symbol ? atob(String(assetData.symbol)) : 'Not found'}</p>
                          </div>
                          <div key="assetGuid">
                            <p>assetGuid</p>
                            <p>{assetData && assetData.assetGuid ? String(assetData.assetGuid) : 'Not found'}</p>
                          </div>
                        </div>
                      )}

                      <div>
                        <p>Site</p>
                        <p>{getHost(`${currentSenderURL}`)}</p>
                      </div>

                      <div>
                        <div
                        >
                          <span
                            onClick={() => setExpanded(!expanded)}
                          >
                            Advanced options
                            <Icon name="arrow-down" className="w-4 bg-brand-graydark100 text-brand-white" />
                          </span>

                          <ul >{renderOptions()}</ul>
                        </div>
                      </div>
                    </section>

                    <section >
                      <div >
                        <Button
                          type="button"
                          onClick={handleRejectTransaction}
                        >
                          Reject
                        </Button>

                        <Button
                          type="submit"
                          onClick={handleConfirm}
                        >
                          {loadingConfirm ? (
                            <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" />
                          ) : (
                            'Confirm'
                          )}
                        </Button>
                      </div>
                    </section>
                  </div>
                </div>
              </AuthViewLayout>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
