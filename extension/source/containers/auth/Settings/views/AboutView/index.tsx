import React, { FC } from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';

import styles from './index.scss';

const AboutView: FC = () => {
  const alert = useAlert();
  const handleSupportClick = () => {
    alert.show('You will be redirected to Syscoin Discord, please contact support team at #pali_support', {
      timeout: 6000, // custom timeout just for this one alert
      type: 'success',
      onClose: () => {
        window.open('https://discord.gg/6rKsX9SqUr')
      } // callback that will be executed after this alert is removed
    });
    
  };
  const handleDocsClick = () => {
    window.open('https://pali-docs.vercel.app/');
  };
  return (
    <div className={styles.about}>
      <span>Pali Wallet Chrome Extension v1.0</span>
      <span>Version: 1.0.5</span>
      <span>
        Support:{' '}
        <a
          className={styles.link}
          // href="#"
          // target="_blank"
          onClick={handleSupportClick}
        >
          pali support
        </a>
      </span>
      <span>
        API Docs
        <a
          className={clsx(styles.link, styles.terms)}
          // href="#"
          // target="_blank"
          onClick={handleDocsClick}
        >
          pali API
        </a>
      </span>
    </div>
  );
};

export default AboutView;
