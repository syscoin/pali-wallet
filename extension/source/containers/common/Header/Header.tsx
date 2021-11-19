import React, { useState } from 'react';
import {
  AccountHeader,
  NormalHeader,
  Section
} from './index';
import {
  useController,
  useStore,
  useUtils
} from 'hooks/index';
import {
  Icon,
  IconButton
} from 'components/index';

export const Header = ({
  importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = true
}) => {
  const [generalSettingsShowed, showGeneralSettings] = useState<boolean>(false);
  const [accountSettingsShowed, showAccountSettings] = useState<boolean>(false);

  const { encriptedMnemonic } = useStore();
  const { history } = useUtils();

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
        <>
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
        </>
      )}
    </div>
  )
}
