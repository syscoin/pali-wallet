import React, { FC } from 'react';

import clsx from 'clsx';
import styles from './index.scss';

const AboutView: FC = () => {
  return (
    <div className={styles.about}>
      <span>Syscoin Wallet Chrome Extension v1.2</span>
      <span>Version: 1.2.1</span>
      <span>
        Support:{' '}
        <a
          className={styles.link}
          href="#"
          target="_blank"
        >
          support syscoin
        </a>
      </span>
      <span>
        Terms and Conditions:
        <a
          className={clsx(styles.link, styles.terms)}
          href="#"
          target="_blank"
        >
          syscoin terms
        </a>
      </span>
    </div>
  );
};

export default AboutView;
