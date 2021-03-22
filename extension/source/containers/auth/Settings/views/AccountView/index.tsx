import React, { FC } from 'react';
import Icon from 'components/Icon';
import ExportIcon from '@material-ui/icons/ImportExport';
import LinkIcon from '@material-ui/icons/CallMissedOutgoing';
import DeleteIcon from '@material-ui/icons/Delete';
import { useSettingsView } from 'hooks/index';

import { PRIV_KEY_VIEW, REMOVE_ACCOUNT_VIEW } from '../routes';
import { DAG_EXPLORER_SEARCH } from 'constants/index';

import styles from './index.scss';

interface IAccountView {
  address: {
    [assetId: string]: string;
  };
}

const AccountView: FC<IAccountView> = ({ address }) => {
  const showView = useSettingsView();

  const handleOpenExplorer = () => {
    window.open(`${DAG_EXPLORER_SEARCH}${address.constellation}`, '_blank');
  };

  return (
    <div className={styles.account}>
      <ul>
        <li onClick={() => showView(PRIV_KEY_VIEW)}>
          <Icon Component={ExportIcon} />
          Export private key
        </li>
        <li onClick={handleOpenExplorer}>
          <Icon Component={LinkIcon} />
          View on explorer
        </li>
        <li onClick={() => showView(REMOVE_ACCOUNT_VIEW)}>
          <Icon Component={DeleteIcon} />
          Remove account
        </li>
      </ul>
    </div>
  );
};

export default AccountView;
