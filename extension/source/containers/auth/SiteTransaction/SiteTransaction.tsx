import React, { useState, useCallback, FC } from 'react';
import clsx from 'clsx';

import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import TextInput from 'components/TextInput';

import styles from './SiteTransaction.scss';
import { browser } from 'webextension-polyfill-ts';
import Switch from "react-switch";
import { useHistory } from 'react-router-dom';

interface ISiteTransaction {
  callbackToSetDataFromWallet: any;
  messageToSetDataFromWallet: string;
  confirmRoute: string;
  itemStringToClearData: string;
  layoutTitle: string;
}

const SiteTransaction: FC<ISiteTransaction> = ({
  callbackToSetDataFromWallet,
  messageToSetDataFromWallet,
  confirmRoute,
  itemStringToClearData,
  layoutTitle
}) => {
  const controller = useController();
  const history = useHistory();

  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState(0);
  const [rbf, setRbf] = useState(false);
  const [recommend, setRecommend] = useState(0.00001);
  const [transacting, setTransacting] = useState(false);

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then((response: any) => {
      setRecommend(response);
      setFee(response);
    });
  };
  
  const handleMessageToSetDataFromWallet = () => {
    callbackToSetDataFromWallet({
      fee,
      rbf
    })

    browser.runtime.sendMessage({
      type: messageToSetDataFromWallet,
      target: 'background'
    });

    setTransacting(true);
    setLoading(true);

    history.push(confirmRoute);
  }

  const handleTypeChanged = useCallback((rbf: boolean) => {
    console.log(rbf)
    setRbf(rbf);
  }, []);

  const handleCancelTransactionOnSite = () => {
    history.push('/home');
    
    browser.runtime.sendMessage({
      type: "CANCEL_TRANSACTION",
      target: "background",
      item: transacting ? itemStringToClearData : null
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
          <Layout title={layoutTitle} showLogo>
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
                    onClick={handleMessageToSetDataFromWallet}
                    disabled={!fee}
                    loading={(transacting && loading)}
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

export default SiteTransaction;
