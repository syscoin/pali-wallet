import * as React from 'react';
import { FC, useCallback, useState } from 'react';
import { Icon, IconButton } from 'components/index';

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
      onScroll={handleScroll}
    >
      {!isShowed ? (
        <div>
          <div>
            <p onClick={handleGoBottom}>
              Learn more
            </p>
          </div>
        </div>
      ) : (
        <div>
          <p>Learn more</p>
          <IconButton type="primary" shape="circle" onClick={handleGoTop}>
            <Icon name="vertical-align" className="w-4 bg-brand-graydark100 text-brand-white" />
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
