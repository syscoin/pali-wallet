import React, { useEffect, useState } from 'react';
import {
  AccountHeader,
  NormalHeader,
  Section
} from './index';
import {
  useController,
  useStore,
} from 'hooks/index';
import { Icon } from 'components/Icon';

export const Header = ({
  importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = true
}) => {
  const [generalSettingsShowed, showGeneralSettings] = useState<boolean>(false);
  const [accountSettingsShowed, showAccountSettings] = useState<boolean>(false);
  const [networkSettingsShowed, showNetworkSettings] = useState<boolean>(false);

  const { encriptedMnemonic, changingNetwork } = useStore();

  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();

  const handleCloseSettings = () => {
    showAccountSettings(false);
    showGeneralSettings(false);
    showNetworkSettings(false);
  };

  useEffect(() => {
    handleCloseSettings();
  }, [changingNetwork]);

  return (
    <div className={normalHeader && accountHeader ? "pb-32" : onlySection ? "" : "pb-12 mb-1"}>
      {changingNetwork && (
        <div className="bg-brand-darktransparent z-20 flex justify-center items-center fixed w-full h-full">
          <Icon name="loading" className="w-4 ml-2 text-brand-white" />
        </div>
      )}

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
