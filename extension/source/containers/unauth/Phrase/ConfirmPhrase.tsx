import React, { useState, /* useMemo */ } from 'react';
import Button from 'components/Button';
import CheckIcon from '@material-ui/icons/CheckCircle';
import { useHistory } from 'react-router-dom';
import shuffle from 'lodash/shuffle';
// import isEqual from 'lodash/isEqual';
import { useController } from 'hooks/index';

import Layout from '../../common/Layout';

import styles from './index.scss';

const ConfirmPhrase = () => {
  const history = useHistory();
  const controller = useController();
  const phrases = controller.wallet.generatePhrase();
  const [orgList, setOrgList] = useState<Array<string>>(
    shuffle((phrases || '').split(' '))
  );
  const [newList, setNewList] = useState<Array<string>>([]);
  const [passed, setPassed] = useState(false);
  const title = passed
    ? `Your Wallet is ready`
    : `Verify your recovery\nphrase`;

  // const isNotEqualArrays = useMemo((): boolean => {
  //   if (!phrases) return true;
  //   return !isEqual(phrases.split(' '), newList);
  // }, [phrases, newList]);

  const handleOrgPhrase = (idx: number) => {
    const tempList = [...orgList];
    setNewList([...newList, orgList[idx]]);
    tempList.splice(idx, 1);
    setOrgList([...tempList]);
  };

  const handleNewPhrase = (idx: number) => {
    const tempList = [...newList];
    setOrgList([...orgList, newList[idx]]);
    tempList.splice(idx, 1);
    setNewList([...tempList]);
  };

  const handleConfirm = () => {
    if (!passed) {
      setPassed(true);
    } else {
      controller.wallet.createWallet();
      console.log('Checking variable',passed)
      history.push('/app.html');
    }
  };

  return (
    <Layout title={title} linkTo="/create/phrase/generated">
      {passed && <CheckIcon className={styles.checked} />}
      <div className="body-description">
        {passed
          ? 'You should now have your recovery phrase and your wallet password written down for future reference.'
          : 'Select the words in the correct order.'}
      </div>
      {!passed && (
        <>
          <section className={styles.topzone}>
            {newList.map((phrase, idx) => (
              <Button
                key={idx}
                type="button"
                variant={`${styles.phrase} ${styles.selected}`}
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <section className={styles.bottomzone}>
            {orgList.map((phrase, idx) => (
              <Button
                key={idx}
                type="button"
                variant={styles.phrase}
                onClick={() => handleOrgPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
        </>
      )}
      <Button
        type="button"
        variant={passed ? styles.start : styles.validate}
        // disabled={isNotEqualArrays}
        onClick={handleConfirm}
      >
        {passed ? 'Next' : 'Validate'}
      </Button>
    </Layout>
  );
};

export default ConfirmPhrase;
