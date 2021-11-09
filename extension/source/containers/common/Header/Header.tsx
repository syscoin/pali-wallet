import React, { useState, ChangeEvent } from 'react';
import AccountHeader from './AccountHeader';
import Section from './Section';
import NormalHeader from './NormalHeader';
import { MAIN_VIEW } from 'containers/auth/Settings/views/routes';
import { useHistory } from 'react-router-dom';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { useSelector } from 'react-redux';
import { useController, useSettingsView } from 'hooks/index';

const Header = ({ importSeed = false, backLink = '#', onlySection = false, accountHeader = false, normalHeader = true }) => {
  // const handleBack = () => {
  //   showSettings(false);

  //   if (backLink === '#') {
  //     history.goBack();

  //     return;
  //   }

  //   history.push(backLink);
  // };
  const {
    accounts,
    activeAccountId,
    tabs,
    changingNetwork,
    activeNetwork,
    encriptedMnemonic
  }: IWalletState = useSelector((state: RootState) => state.wallet);

  const controller = useController();
  const history = useHistory();
  const showView = useSettingsView();

  const isUnlocked = !controller.wallet.isLocked();
  const [generalSettingsShowed, showGeneralSettings] = useState<boolean>(false);
  const [accountSettingsShowed, showAccountSettings] = useState<boolean>(false);

  const handleCloseSettings = () => {
    console.log('closing settings')
    showAccountSettings(false);
    showGeneralSettings(false);
    showView(MAIN_VIEW);
  };

  return (
    <div>
      {onlySection && (
        <Section />
      )}

      {normalHeader && (
        <div>
          <NormalHeader
            importSeed={importSeed}
            generalSettingsShowed={generalSettingsShowed}
            handleCloseSettings={handleCloseSettings}
            showSettings={showGeneralSettings}
            isUnlocked={isUnlocked}
            encriptedMnemonic={encriptedMnemonic}
          />

          {accountHeader && (
            <AccountHeader
              encriptedMnemonic={encriptedMnemonic}
              importSeed={importSeed}
              accountSettingsShowed={accountSettingsShowed}
              handleCloseSettings={handleCloseSettings}
              showSettings={showAccountSettings}
              isUnlocked={isUnlocked}
            />
          )}
        </div>
      )}
    </div>
  )
}

export default Header;