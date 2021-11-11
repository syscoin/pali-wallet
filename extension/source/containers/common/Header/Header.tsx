import React, { useState } from 'react';
import AccountHeader from './AccountHeader';
import Section from './Section';
import NormalHeader from './NormalHeader';
import { useController, useStore } from 'hooks/index';

const Header = ({
  importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = true
}) => {
  const [generalSettingsShowed, showGeneralSettings] = useState<boolean>(false);
  const [accountSettingsShowed, showAccountSettings] = useState<boolean>(false);

  const { encriptedMnemonic } = useStore();

  const controller = useController();

  const isUnlocked = !controller.wallet.isLocked();

  const handleCloseSettings = () => {
    showAccountSettings(false);
    showGeneralSettings(false);
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
