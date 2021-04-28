import * as React from 'react';
import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import GoTopIcon from '@material-ui/icons/VerticalAlignTop';
import IconButton from '@material-ui/core/IconButton';

import styles from './index.scss';

const TutorialPanel: FC = () => {
  // const controller = useController();
  const [isShowed, setShowed] = useState<boolean>(false);
  const [scrollArea, setScrollArea] = useState<HTMLElement>();
  const [learnMore, setLearnMore] = useState<boolean>(false)
 
  const handleScroll = useCallback((event) => {
    event.persist();
    if (event.target.scrollTop) {
      setShowed(true);
      setLearnMore(true);
    }
    setScrollArea(event.target);
    const scrollOffset = event.target.scrollHeight - event.target.scrollTop;
    if (scrollOffset === event.target.clientHeight) {
      console.log('ola')
    }
  }, []);

  const handleGoTop = () => {
    scrollArea!.scrollTo({ top: 0, behavior: 'smooth' });
    setLearnMore(false)
    setShowed(false);
  };

  return (
    <section
      className={clsx(styles.activity, { [styles.expanded]: isShowed })}
      onScroll={handleScroll}
    >
      {!!(!isShowed) ?
        <div className={styles.wrapper}>
          <div className={styles.heading}>
            <p style={{ cursor: "pointer" }} onClick={() => setLearnMore(!learnMore)}>Learn more</p>
          </div>
        </div>
        :
        <div className={styles.heading}>
          <p>Learn more</p>
          <IconButton className={styles.goTop} onClick={handleGoTop}>
            <GoTopIcon />
          </IconButton>
        </div>
      }

      {learnMore && (
        <div>
          <ol>
            <li>
              <h2>Connect hardware wallet</h2>
              <small>Connect your hardware wallet directly to your computer.</small>
            </li>

            <li>
              <h2>Select an account</h2>
              <small>Select the account you want to view. You can only choose one at a time.</small>
            </li>

            <li>
              <h2>Start using web3 sites and more!</h2>
              <small>Use your hardware account like you would with any Ethereum account. Connect to web3 sites, send ETH, buy and store ERC20 tokens and non-fungible tokens like CryptoKitties.</small>
            </li>
          </ol>
        </div>
      )}

    </section>
  );
};

export default TutorialPanel;