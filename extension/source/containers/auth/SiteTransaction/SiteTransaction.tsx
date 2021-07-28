import React, { useState, FC } from 'react';
import clsx from 'clsx';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import TextInput from 'components/TextInput';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import { browser } from 'webextension-polyfill-ts';

import styles from './SiteTransaction.scss';

interface ISiteTransaction {
  callbackToSetDataFromWallet: any;
  confirmRoute: string;
  itemStringToClearData: string;
  layoutTitle: string;
  messageToSetDataFromWallet: string;
}

const SiteTransaction: FC<ISiteTransaction> = ({
  callbackToSetDataFromWallet,
  messageToSetDataFromWallet,
  confirmRoute,
  itemStringToClearData,
  layoutTitle,
}) => {
  const controller = useController();
  const history = useHistory();

  const [loading, setLoading] = useState<boolean>(false);
  const [fee, setFee] = useState(0);
  const [recommend, setRecommend] = useState(0.00001);
  const [transacting, setTransacting] = useState(false);

  const handleGetFee = async () => {
    const recommendFee = await controller.wallet.account.getRecommendFee();

    setRecommend(recommendFee);
    setFee(recommendFee);
  };

  const handleMessageToSetDataFromWallet = () => {
    callbackToSetDataFromWallet({
      fee,
    });

    browser.runtime.sendMessage({
      type: messageToSetDataFromWallet,
      target: 'background',
    });

    setTransacting(true);
    setLoading(true);

    history.push(confirmRoute);
  };

  const handleCancelTransactionOnSite = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: 'CANCEL_TRANSACTION',
      target: 'background',
      item: transacting ? itemStringToClearData : null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

 

  return (
    <div>
      <Layout title={layoutTitle} showLogo>
        <form className={styles.wrapper}>
          <label htmlFor="fee">Fee</label>

          <section className={styles.fee}>
            <TextInput
              type="text"
              placeholder="Enter fee"
              fullWidth
              name="fee"
              value={fee}
              onChange={(event) => setFee(Number(event.target.value.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1')))}
            />

            <Button
              type="button"
              variant={styles.textBtn}
              onClick={handleGetFee}
            >
              Recommend
            </Button>
          </section>

          <p className={styles.description}>
            With current network conditions, we recommend a fee of {recommend}{' '}
            SYS.
          </p>

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
                loading={transacting && loading}
              >
                Next
              </Button>
            </div>
          </section>
        </form>
      </Layout>
    </div>
  );
};

export default SiteTransaction;
