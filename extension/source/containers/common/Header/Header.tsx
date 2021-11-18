import React, { useState } from 'react';
import AccountHeader from './AccountHeader';
import Section from './Section';
import NormalHeader from './NormalHeader';
import { useController, useStore, useUtils } from 'hooks/index';
import { HomeOutlined } from '@ant-design/icons';

const Header = ({
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
        <div className="grid grid-cols-6 gap-4">
          <div className="col-start-2 col-span-4">
            <Section />
          </div>
          <div className="col-end-7">
            <button className="pl-6" onClick={() => history.goBack()}><HomeOutlined style={{color: '#4ca1cf'}} /></button>
          </div>
        </div>
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
