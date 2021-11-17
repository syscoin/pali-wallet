import React, { useState, FC } from 'react';
import {Layout} from 'containers/common/Layout';
import { Button, Icon } from 'components/index';
import { useController, useUtils, useFormat, useStore, useBrowser } from 'hooks/index';

interface ISignTransaction {
  item: string;
  sendPSBT: boolean;
  transactingStateItem: boolean;
  warning: string;
}

export const SignTransaction: FC<ISignTransaction> = ({
  item,
  sendPSBT,
  transactingStateItem,
  warning,
}) => {
  const controller = useController();
  const { alert, getHost, history } = useUtils();
  const { ellipsis } = useFormat();
  const { browser } = useBrowser();

  const [loading, setLoading] = useState<boolean>(false);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const base64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

  const { currentSenderURL, accounts } = useStore();

  const psbt = controller.wallet.account.getTransactionItem()[item];

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
      item: transactingStateItem ? item : null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  }


  const handleConfirmSignature = () => {
    setLoading(true);

    if (!base64.test(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.removeAll();
      alert.error(`PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.`);

      setTimeout(() => {
        handleCancelTransactionOnSite();
      }, 10000);

      return;
    }

    controller.wallet.account
      .confirmSignature(sendPSBT)
      .then((response: any) => {
        if (response) {
          setConfirmed(true);
          setLoading(false);

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);

          browser.runtime.sendMessage({
            type: 'TRANSACTION_RESPONSE',
            target: 'background',
            response,
          });
        }
      })
      .catch((error: any) => {
        if (error) {
          alert.removeAll();
          alert.error("Can't sign transaction. Try again later.");

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: "Can't sign transaction. Try again later.",
          });

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      });
  };

  const handleCancelTransactionOnSite = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: 'CANCEL_TRANSACTION',
      target: 'background',
      item: transactingStateItem ? item : null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

  const handleClosePopup = () => {
    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

  const connectedAccount = accounts.find((account) => {
    return account.connectedTo.find((url: any) => {
      return url == getHost(currentSenderURL);
    });
  });

  return confirmed ? (
    <Layout title="Your transaction is underway">
      <div className="body-description">
        You can follow your transaction under activity on your account screen.
      </div>
      <Button
        type="button"
        onClick={handleClosePopup}
      >
        Ok
      </Button>
    </Layout>
  ) : (
    <div>
      {transactingStateItem && loading ? (
        <Layout title="">
          <div >
            <section>
            <Icon name="loading"  className="w-4 bg-brand-graydark100 text-brand-white"/>
            </section>
          </div>
        </Layout>
      ) : (
        <div>
          {transactingStateItem && psbt && !loading && (
            <div>
              <Layout title="Signature request">
                <div >
                  <p>{getHost(currentSenderURL)}</p>

                  <div >
                    <p>{connectedAccount?.label}</p>
                    <p>
                      {connectedAccount?.address.main && ellipsis(connectedAccount?.address.main)}
                    </p>
                  </div>

                  <pre>{`${JSON.stringify(
                    controller.wallet.account.importPsbt(psbt),
                    null,
                    2
                  )}`}</pre>

                  <p
                  
                    style={{ textAlign: 'center', marginTop: '1rem' }}
                  >
                    { warning }
                  </p>

                  <section >
                    <div >
                      <Button
                        type="button"
                        onClick={handleRejectTransaction}
                      >
                        Reject
                      </Button>

                      <Button
                        type="button"
                        onClick={handleConfirmSignature}
                      >
                        {loading ? <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" /> : 'Sign'}
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
};
