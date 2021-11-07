import React, { useState, ChangeEvent } from 'react';
import AccountHeader from './AccountHeader';
import Section from './Section';
import { RootState } from 'state/store';
import { useController, useSettingsView } from 'hooks/index';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import IWalletState from 'state/wallet/types';
import { MAIN_VIEW } from 'containers/auth/Settings/views/routes';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import Link from 'components/Link';
import LogoImage from 'assets/images/logo-s.svg';
import NormalHeader from './NormalHeader';

const Header = ({ importSeed = false, backLink = '#', onlySection = false, accountHeader = false, normalHeader = true }) => {
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

      return;
    }

    history.push(backLink);
  };

  const handleCloseSettings = () => {
    console.log('closing settings')
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
      <div>
        {/* {showLogo ? (
          <Link to="/app.html" onClick={handleCloseSettings}>
            <img src={`/${LogoImage}`} className="w-24 h-24" alt="Syscoin" />
          </Link>
        ) : (
          <IconButton
            onClick={handleBack}
          >
            <ArrowBackIcon />
          </IconButton>
        )} */}

        {/* <Link to="/app.html" onClick={handleCloseSettings}>
          <img src={`/${LogoImage}`} className="w-24 h-24" alt="Syscoin" />
        </Link> */}

        {/* {showName ? (
          <span>Pali Wallet</span>
        ) : (
          <div>
            select
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
        )} */}



      </div>

      {onlySection && (
        <Section />
      )}

      {normalHeader && (
        <div>
          <NormalHeader
            encriptedMnemonic={encriptedMnemonic}
            importSeed={importSeed}
            showed={showed}
            showSettings={showSettings}
            isUnlocked={isUnlocked}
            handleChangeNetwork={handleChangeNetwork}
            handleCloseSettings={handleCloseSettings}
          />

          {accountHeader && (
            <AccountHeader />
          )}
        </div>
      )}
    </div>
  )
}

export default Header;