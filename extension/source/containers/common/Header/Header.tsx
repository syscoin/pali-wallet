import React, { useState } from 'react';
import {
  AccountHeader,
  NormalHeader,
  Section
} from './index';
import {
  useController,
  useStore,
} from 'hooks/index';

export const Header = ({
  importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = true
}) => {
  const [generalSettingsShowed, showGeneralSettings] = useState<boolean>(false);
  const [accountSettingsShowed, showAccountSettings] = useState<boolean>(false);
  const [networkSettingsShowed, showNetworkSettings] = useState<boolean>(false);

  const { encriptedMnemonic } = useStore();

  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();

  const handleCloseSettings = () => {
    showAccountSettings(false);
    showGeneralSettings(false);
    showNetworkSettings(false);
  };

  return (
    <div>
      {onlySection && (
        <Section />
      )}

      <div className="fixed w-full z-10">
        {normalHeader && (
          <>
            <NormalHeader
              importSeed={importSeed}
              generalSettingsShowed={generalSettingsShowed}
              handleCloseSettings={handleCloseSettings}
              showSettings={showGeneralSettings}
              showNetworkSettings={showNetworkSettings}
              isUnlocked={isUnlocked}
              encriptedMnemonic={encriptedMnemonic}
              networkSettingsShowed={networkSettingsShowed}
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
    </div>
  )
}
