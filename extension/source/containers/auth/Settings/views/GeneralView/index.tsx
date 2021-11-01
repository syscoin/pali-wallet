import * as React from 'react';
import ListIcon from '@material-ui/icons/ListAltRounded';
import TimeIcon from '@material-ui/icons/AccessTime';
import InfoIcon from '@material-ui/icons/InfoRounded';
import DeleteIcon from '@material-ui/icons/Delete';
import Icon from 'components/Icon';
import { useSettingsView } from 'hooks/index';

import { AUTOLOCK_VIEW, ABOUT_VIEW, DELETE_WALLET_VIEW, PHRASE_VIEW } from '../routes';

const GeneralView = () => {
  const showView = useSettingsView();

  return (
    <div>
      <ul>
        <li onClick={() => showView(AUTOLOCK_VIEW)}>
          <Icon Component={TimeIcon} />
          Auto lock timer
        </li>
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
