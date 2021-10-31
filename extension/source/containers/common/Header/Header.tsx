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
  const isUnlocked = !controller.wallet.isLocked();
  const [showed, showSettings] = useState<boolean>(false);
  const { encriptedMnemonic }: IWalletState = useSelector(
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
    controller.wallet.switchNetwork(event.target.value as string);
    controller.wallet.getNewAddress();
  };

  return (
    <div>
      {showLogo ? (
        <Link to="/app.html" onClick={handleCloseSettings}>
          <img src={`/${LogoImage}`} alt="Syscoin" />
        </Link>
      ) : (
        <IconButton
          onClick={handleBack}
        >
          <ArrowBackIcon />
        </IconButton>
      )}

      {showName ? (
        <span>Pali Wallet</span>
      ) : (
        <div>
          <Select
            value={network || SYS_NETWORK.main.id}
            fullWidth
            onChange={handleChangeNetwork}
            options={[
              { [SYS_NETWORK.main.id]: SYS_NETWORK.main.label },
              { [SYS_NETWORK.testnet.id]: SYS_NETWORK.testnet.label },
            ]}
          />
        </div>
      )}

      {encriptedMnemonic && !importSeed ? (
        <IconButton
          onClick={() =>
            showed ? handleCloseSettings() : showSettings(!showed)
          }
        >
          <MoreVertIcon />
        </IconButton>
      ) : (
        <i />
      )}
      <Settings open={showed && isUnlocked} onClose={handleCloseSettings} />
    </div>
  );
};

export default Header;
