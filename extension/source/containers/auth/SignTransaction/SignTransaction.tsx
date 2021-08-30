import React, { useState, FC } from 'react';
import clsx from 'clsx';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import IWalletState from 'state/wallet/types';
import Spinner from '@material-ui/core/CircularProgress';
import { RootState } from 'state/store';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import { browser } from 'webextension-polyfill-ts';
import { useSelector } from 'react-redux';
import { useAlert } from 'react-alert';
import { getHost } from 'scripts/Background/helpers';
import CircularProgress from '@material-ui/core/CircularProgress';

import { ellipsis } from '../helpers';

import styles from './SignTransaction.scss';

interface ISignTransaction {
  item: string;
  sendPSBT: boolean;
  transactingStateItem: boolean;
  warning: string;
}

const SignTransaction: FC<ISignTransaction> = ({
  item,
  sendPSBT,
  transactingStateItem,
  warning,
}) => {
  const controller = useController();
  const history = useHistory();
  const alert = useAlert();

  const [loading, setLoading] = useState<boolean>(false);
  const [confirmed, setConfirmed] = useState<boolean>(false);

  const { tabs, accounts }: IWalletState =
    useSelector((state: RootState) => state.wallet);

  const { currentSenderURL } = tabs;

  const psbt = controller.wallet.account.getTransactionItem()[item];

  const handleConfirmSignature = () => {
    setLoading(true);

    const base64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

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
        console.log(error);

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
          {transactingStateItem && psbt && !loading && (
            <div>
              <Layout title="Signature request" showLogo>
                <div className={styles.wrapper}>
                  <p className={styles.description}>{getHost(currentSenderURL)}</p>

                  <div className={styles.account}>
                    <p className={styles.description}>{connectedAccount?.label}</p>
                    <p className={styles.description}>
                      {ellipsis(connectedAccount?.address.main)}
                    </p>
                  </div>

                  <pre className={styles.code}>{`${JSON.stringify(
                    controller.wallet.account.importPsbt(psbt),
                    null,
                    2
                  )}`}</pre>

                  <p
                    className={styles.description}
                    style={{ textAlign: 'center', marginTop: '1rem' }}
                  >
                    { warning }
                  </p>

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
                        type="button"
                        theme="btn-outline-primary"
                        variant={styles.button}
                        onClick={handleConfirmSignature}
                      >
                        {loading ? <Spinner size={15} className={styles.spinner} /> : 'Sign'}
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

export default SignTransaction;
