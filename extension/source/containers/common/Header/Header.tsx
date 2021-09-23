import { SYS_NETWORK } from 'constants/index';

import React, { FC, useState , ChangeEvent } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import IconButton from '@material-ui/core/IconButton';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import Link from 'components/Link';
import Settings from 'containers/auth/Settings';
import { useController, useSettingsView } from 'hooks/index';
import LogoImage from 'assets/images/logo-s.svg';
import { MAIN_VIEW } from 'containers/auth/Settings/views/routes';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import Select from 'components/Select';
import { useAlert } from 'react-alert';

import styles from './Header.scss';

interface IHeader {
  backLink?: string;
  showLogo?: boolean;
  showName?: boolean;
  importSeed?: boolean;
}

const Header: FC<IHeader> = ({ showLogo = false, backLink = '#', showName = true, importSeed = false }) => {
  const history = useHistory();
  const controller = useController();
  const showView = useSettingsView();
  const alert = useAlert();
  const isUnlocked = !controller.wallet.isLocked();
  const [showed, showSettings] = useState<boolean>(false);
  const { encriptedMnemonic, networks }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const network = useSelector(
    (state: RootState) => state.wallet!.activeNetwork
  );

  const handleBack = () => {
    showSettings(false);
    if (backLink === '#') {
      history.goBack();
    } else {
      history.push(backLink);
    }
  };

  const handleCloseSettings = () => {
    showSettings(false);
    showView(MAIN_VIEW);
  };
  
  const handleChangeNetwork = (
    event: ChangeEvent<{
      name?: string | undefined;
      value: unknown;
    }>
  ) => {
    controller.wallet.switchNetwork(event.target.value as string).catch((error: any) => {
      alert.removeAll();
      console.log('error')
    });
    controller.wallet.getNewAddress();
  };

  return (
    <div className={styles.header}>
      {showLogo ? (
        <Link to="/app.html" onClick={handleCloseSettings}>
          <img src={`/${LogoImage}`} className={styles.logo} alt="Syscoin" />
        </Link>
      ) : (
        <IconButton
          className={`${styles.button} ${styles.back}`}
          onClick={handleBack}
        >
          <ArrowBackIcon />
        </IconButton>
      )}

      {showName ? (
        <span className={styles.title}>Pali Wallet</span>
      ) : (
        <div className={styles.network}>
          <Select
            showSettings={showSettings}
            value={network || networks.main.id}
            fullWidth
            onChange={handleChangeNetwork}
            options={Object.values(networks)}
          />
        </div>
      )}

      {encriptedMnemonic && !importSeed ? (
        <IconButton
          className={`${styles.button} ${styles.more}`}
          onClick={() =>
            showed ? handleCloseSettings() : showSettings(!showed)
          }
        >
          <MoreVertIcon />
        </IconButton>
      ) : (
        <i style={{ width: '70px' }} />
      )}
      <Settings open={showed && isUnlocked} onClose={handleCloseSettings} />
    </div>
  );
};

export default Header;
