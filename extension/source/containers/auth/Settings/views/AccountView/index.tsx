import * as React from 'react';
import  { FC } from 'react';
import Icon from 'components/Icon';
import ExportIcon from '@material-ui/icons/ImportExport';
import LinkIcon from '@material-ui/icons/CallMissedOutgoing';
// import DeleteIcon from '@material-ui/icons/Delete';
import { useSettingsView } from 'hooks/index';
import { useSelector } from 'react-redux';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';

// import { PRIV_KEY_VIEW, REMOVE_ACCOUNT_VIEW } from '../routes';
import { PRIV_KEY_VIEW } from '../routes';
import { SYS_EXPLORER_SEARCH } from 'constants/index';

import styles from './index.scss';

interface IAccountView {
  id: number;
}

const AccountView: FC<IAccountView> = ({ id }) => {
  const showView = useSettingsView();
  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const handleOpenExplorer = () => {
    window.open(SYS_EXPLORER_SEARCH + '/xpub/' + accounts[id].xpub);

  };

  return (
    <div className={styles.account}>
      <ul>
        <li onClick={() => showView(PRIV_KEY_VIEW)}>
          <Icon Component={ExportIcon} />
          Export account keys
        </li>
        <li onClick={handleOpenExplorer}>
          <Icon Component={LinkIcon} />
          View on explorer
        </li>
        {/* <li onClick={() => showView(REMOVE_ACCOUNT_VIEW)}>
          <Icon Component={DeleteIcon} />
          Remove account
        </li> */}
      </ul>
    </div>
  );
};

export default AccountView;
