import React, { FC } from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';
import IconButton from '@material-ui/core/IconButton';
import CopyIcon from '@material-ui/icons/FileCopy';
import styles from './index.scss';
import { useCopyClipboard } from 'hooks/index';

const AboutView: FC = () => {
  const [isCopied, copyText] = useCopyClipboard();
  const alert = useAlert();
  const handleSupportClick = () => {
    alert.show(
      'You will be redirected to Syscoin Discord, please contact support team at #pali_support',
      {
        timeout: 5000,
        type: 'success',
        onClose: () => {
          window.open('https://discord.gg/8QKeyurHRd');
        },
      }
    );
  };
  const handleDocsClick = () => {
    window.open('https://docs.paliwallet.com/');
  };
  return (
    <div className={styles.about}>
      <span>Pali Wallet Chrome Extension v1.0</span>
      <span>Version: 1.0.26</span>
      <span>
        Support:{' '}
        <a className={styles.link} onClick={handleSupportClick}>
          Pali support
        </a>
      </span>
      <span className="text-white">
        To access the support link, you need to give permission or copy and
        paste the link below{' '}
        <div style={{ paddingTop: '8px ' }}>
          <a className={styles.link}>https://discord.gg/8QKeyurHRd </a>
          <IconButton
            style={{ padding: '0 0 0 6px ' }}
            className={clsx(styles.iconBtn, { [styles.active]: isCopied })}
            onClick={() => copyText('https://discord.gg/8QKeyurHRd')}
          >
            <CopyIcon style={{ color: 'white', fontSize: '1rem' }} />
          </IconButton>
        </div>
      </span>
      <span>
        API Docs
        <a
          className={clsx(styles.link, styles.terms)}
          onClick={handleDocsClick}
        >
          Pali API
        </a>
      </span>
    </div>
  );
};

export default AboutView;
