import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useController , useCopyClipboard } from 'hooks/index';
import clsx from 'clsx';
import QRCode from 'qrcode.react';
import IconButton from '@material-ui/core/IconButton';
import CopyIcon from '@material-ui/icons/FileCopy';
import Header from 'containers/common/Header';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import Spinner from '@material-ui/core/CircularProgress';

import styles from './Receive.scss';

const WalletReceive = () => {
  const [isCopied, copyText] = useCopyClipboard();
  const controller = useController();
  const [loaded, setLoaded] = useState<boolean>(false);
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  useEffect(() => {
    if (controller.wallet.getNewAddress()) {
      setLoaded(true);
    }
  }, []);

  return (
    <div className={styles.wrapper}>
      <Header backLink="/home" showName={false}/>
      <section className={styles.subheading}>Receive SYS</section>
      <section className={styles.content}>
        {loaded ? (
          <div>
            <div className={styles.address}>
              <QRCode
                value={accounts.find(element => element.id === activeAccountId)!.address.main}
                bgColor="#fff"
                fgColor="#000"
                className={styles.qrcode}
                size={180}
              />
              {accounts.find(element => element.id === activeAccountId)!.address.main}
            </div>
            <div className={styles.copy}>
              <IconButton
                className={clsx(styles.iconBtn, { [styles.active]: isCopied })}
                onClick={() =>
                  copyText(accounts.find(element => element.id === activeAccountId)!.address.main)
                }
              >
                <CopyIcon className={styles.icon} />
              </IconButton>
              <span className={clsx({ [styles.active]: isCopied })}>
                {isCopied ? 'Copied address' : 'Copy'}
              </span>
            </div>
          </div>
        ) : <Spinner classes={{ root: styles.spinner }} />}

      </section>
    </div>
  );
};

export default WalletReceive;
