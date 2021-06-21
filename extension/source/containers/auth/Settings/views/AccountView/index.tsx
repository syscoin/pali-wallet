import * as React from 'react';
import  { FC } from 'react';
import Icon from 'components/Icon';
import ExportIcon from '@material-ui/icons/ImportExport';
import LinkIcon from '@material-ui/icons/CallMissedOutgoing';
import { useSettingsView, useController } from 'hooks/index';
import { useSelector } from 'react-redux';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { PRIV_KEY_VIEW } from '../routes';

import styles from './index.scss';

interface IAccountView {
  id: number;
}

const AccountView: FC<IAccountView> = ({ id }) => {
  const controller = useController();
  const showView = useSettingsView();
  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const sysExplorer = controller.wallet.account.getSysExplorerSearch();
  const handleOpenExplorer = () => {
    window.open(sysExplorer + '/xpub/' + accounts[id].xpub);
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
      </ul>
    </div>
  );
};

export default AccountView;
