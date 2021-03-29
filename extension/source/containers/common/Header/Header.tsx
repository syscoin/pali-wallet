import React, { FC, useState } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import IconButton from '@material-ui/core/IconButton';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import Link from 'components/Link';
import Settings from 'containers/auth/Settings';
import { useController, useSettingsView } from 'hooks/index';
import LogoImage from 'assets/images/logo-s.svg';

import styles from './Header.scss';
import { MAIN_VIEW } from 'containers/auth/Settings/views/routes';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';

interface IHeader {
  backLink?: string;
  showLogo?: boolean;
}

const Header: FC<IHeader> = ({ showLogo = false, backLink = '#' }) => {
  const history = useHistory();
  const controller = useController();
  const showView = useSettingsView();
  const isUnlocked = !controller.wallet.isLocked();
  const [showed, showSettings] = useState(false);
  const { keystores, seedKeystoreId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
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

      {/* <span className={styles.title}>Syscoin Wallet</span> */}

      {keystores && seedKeystoreId > -1 && keystores[seedKeystoreId] ? (
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
