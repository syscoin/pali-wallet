import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
// import { useSelector } from 'react-redux';

import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
// import CheckIcon from '@material-ui/icons/CheckCircle';

import TextInput from 'components/TextInput';
// import { RootState } from 'state/store';
// import { getHost } from 'scripts/Background/helpers';
// import IWalletState, { IAccountState } from 'state/wallet/types';
// import { useAlert } from 'react-alert';
// import CircularProgress from '@material-ui/core/CircularProgress';

import styles from './UpdateAsset.scss';
import { browser } from 'webextension-polyfill-ts';
import Switch from "react-switch";
import { useHistory } from 'react-router-dom';

const UpdateAsset = () => {
  const controller = useController();
  // const alert = useAlert();
  const history = useHistory()

  // const { accounts, currentSenderURL }: IWalletState = useSelector(
  //   (state: RootState) => state.wallet
  // );

  const updateAsset = controller.wallet.account.getNewUpdateAsset();
  // const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState(0);
  const [rbf, setRbf] = useState(false);
  const [recommend, setRecommend] = useState(0.00001);
  const [updatingAsset, setUpdatingAsset] = useState(false);
  // const [connectedAccountId, setConnectedAccountId] = useState(-1);

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then((response: any) => {
      setRecommend(response);
      setFee(response);
    });
  };

  // useEffect(() => {
  //   setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
  //     return account.connectedTo.filter((url: string) => {
  //       return url === getHost(currentSenderURL);
  //     })
  //   }))
  // }, []);

  // const handleConfirm = () => {
  //   let acc = accounts.find(element => element.id === connectedAccountId)

  //   if ((acc ? acc.balance : -1) > 0) {
  //     controller.wallet.account.confirmUpdateAssetTransaction().then((error: any) => {
  //       if (error) {
  //         alert.removeAll();
  //         alert.error('Can\'t update token. Try again later.'); 
           
  //         browser.runtime.sendMessage({
  //           type: 'WALLET_ERROR',
  //           target: 'background',
  //           transactionError: true,
  //           invalidParams: false,
  //           message: `TransactionError: ${error}`
  //         });

  //         setTimeout(() => {
  //           handleCancelTransactionOnSite();
  //         }, 4000);

  //         return;
  //       }
        
  //       browser.runtime.sendMessage({
  //         type: 'WALLET_ERROR',
  //         target: 'background',
  //         transactionError: false,
  //         invalidParams: false,
  //         message: 'Everything is fine, transaction completed.'
  //       });

  //       setConfirmed(true);
  //       setLoading(false);
  //     });
  //   }
  // }

  const handleMessageToUpdateAsset = () => {
    controller.wallet.account.setDataFromWalletToUpdateAsset({
      fee,
      rbf
    });

    browser.runtime.sendMessage({
      type: 'DATA_FROM_WALLET_TO_UPDATE_TOKEN',
      target: 'background'
    });

    setUpdatingAsset(true);
    setLoading(true);

    history.push('/updateAsset/confirm');
  }

  const handleTypeChanged = useCallback((rbf: boolean) => {
    console.log(rbf)
    setRbf(rbf);
  }, []);

  // const handleClosePopup = () => {
  //   browser.runtime.sendMessage({
  //     type: "CLOSE_POPUP",
  //     target: "background"
  //   });
  // }

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

  return (
    <div>
      <div>
        <div>
          <Layout title="Update Token" showLogo>
            <form className={styles.wrapper}>
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
                    linkTo="/home"
                    onClick={handleCancelTransactionOnSite}
                  >
                    Reject
                  </Button>

                  <Button
                    type="button"
                    theme="btn-outline-primary"
                    variant={styles.button}
                    onClick={handleMessageToUpdateAsset}
                    disabled={!fee}
                    loading={(updatingAsset && loading)}
                  >
                    Next
                  </Button>
                </div>
              </section>
            </form>
          </Layout>
        </div>
      </div>
    </div>
  );
}

export default UpdateAsset;
