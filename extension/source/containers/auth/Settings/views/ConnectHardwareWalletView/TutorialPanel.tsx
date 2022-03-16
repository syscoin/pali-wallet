import * as React from 'react';
import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import GoTopIcon from '@material-ui/icons/VerticalAlignTop';
import IconButton from '@material-ui/core/IconButton';

import styles from './index.scss';

const TutorialPanel: FC = () => {
  const [isShowed, setShowed] = useState<boolean>(false);
  const [learnMore, setLearnMore] = useState<boolean>(false);

  const handleScroll = useCallback((event) => {
    event.persist();
    if (event.target.scrollTop) {
      setShowed(true);
      setLearnMore(true);
    }
  }, []);

  const handleGoTop = () => {
    setShowed(false);
    setLearnMore(false);
  };

  const handleGoBottom = () => {
    setLearnMore(true);
    setShowed(true);
  };

  return (
    <section
      className={clsx(styles.activity, { [styles.expanded]: isShowed })}
      onScroll={handleScroll}
    >
      {!isShowed ? (
        <div className={styles.wrapper}>
          <div className={styles.heading}>
            <p style={{ cursor: 'pointer' }} onClick={handleGoBottom}>
              Learn more
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.heading}>
          <p>Learn more</p>
          <IconButton className={styles.goTop} onClick={handleGoTop}>
            <GoTopIcon />
          </IconButton>
        </div>
      )}

      {learnMore && (
        <div>
          <ol>
            <li>
              <h2>Connect a hardware wallet</h2>
              <small>
                Connect your hardware wallet directly to your computer.
              </small>
            </li>

            <li>
              <h2>Start using sys powered sites and more!</h2>
              <small>
                Use your hardware account like you would with any SYS account.
                Connect to SYS web3 sites, send SYS, buy and store SPT tokens.
              </small>
            </li>
          </ol>
        </div>
      )}
    </section>
  );
};

export default TutorialPanel;
