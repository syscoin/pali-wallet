import React, { FC } from 'react';

import clsx from 'clsx';
import styles from './index.scss';

const AboutView: FC = () => {
  return (
    <div className={styles.about}>
      <span>Stargazer Wallet Chrome Extension v1.2</span>
      <span>Version: 1.2.1</span>
      <span>
        Support:{' '}
        <a
          className={styles.link}
          href="https://t.me/StardustSupport"
          target="_blank"
        >
          https://t.me/StardustSupport
        </a>
      </span>
      <span>
        Terms and Conditions:
        <a
          className={clsx(styles.link, styles.terms)}
          href="https://www.stargazer.network/assets/static/terms.html"
          target="_blank"
        >
          https://www.stargazer.network/.../terms.html
        </a>
      </span>
    </div>
  );
};

export default AboutView;
