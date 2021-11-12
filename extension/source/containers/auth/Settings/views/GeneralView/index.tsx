import * as React from 'react';
import ListIcon from '@material-ui/icons/ListAltRounded';
import InfoIcon from '@material-ui/icons/InfoRounded';
import DeleteIcon from '@material-ui/icons/Delete';
import Icon from 'components/Icon';
import { useSettingsView } from 'hooks/index';

import { ABOUT_VIEW, DELETE_WALLET_VIEW, PHRASE_VIEW } from '../routes';

import styles from './index.scss';

const GeneralView = () => {
  const showView = useSettingsView();

  return (
    <div className={styles.general}>
      <ul>
        <li onClick={() => showView(PHRASE_VIEW)}>
          <Icon Component={ListIcon} />
          Wallet seed phrase
        </li>
        <li onClick={() => showView(ABOUT_VIEW)}>
          <Icon Component={InfoIcon} />
          About
        </li>
        <li onClick={() => showView(DELETE_WALLET_VIEW)}>
          <Icon Component={DeleteIcon} />
          Delete wallet
        </li>
      </ul>
    </div>
  );
};

export default GeneralView;
