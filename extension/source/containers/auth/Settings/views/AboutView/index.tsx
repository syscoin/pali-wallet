import React, { FC } from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';

import styles from './index.scss';

const AboutView: FC = () => {
  const alert = useAlert();
  const handleSupportClick = () => {
    alert.show('You will be redirected to Syscoin Discord, please contact support team at #pali_support', {
      timeout: 5000,
      type: 'success',
      onClose: () => {
        window.open('https://discord.gg/8QKeyurHRd')
      }
    });

  };
  const handleDocsClick = () => {
    window.open('https://docs.paliwallet.com/');
  };
  return (
    <div className={styles.about}>
      <span>Pali Wallet Chrome Extension v1.0</span>
      <span>Version: 1.0.20</span>
      <span>
        Support:{' '}
        <a
          className={styles.link}
          onClick={handleSupportClick}
        >
          Pali support
        </a>
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
