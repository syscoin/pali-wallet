import React, { FC } from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { Icon, IconButton } from 'components/index';
import Settings from 'containers/auth/Settings';

interface IAccountHeader {
  encriptedMnemonic: string;
  importSeed: boolean;
  accountSettingsShowed: boolean;
  handleCloseSettings: any;
  showSettings: any;
  isUnlocked: boolean;
}

const AccountHeader: FC <IAccountHeader> = ({
  encriptedMnemonic,
  importSeed,
  accountSettingsShowed,
  handleCloseSettings,
  showSettings,
  isUnlocked
}) => {
  return (
    <div className="flex justify-between items-center bg-brand-gold">
      <div className="flex justify-between items-center">
        <img src={`/${LogoImage}`} className="mx-auto w-14 rounded-full" alt="Syscoin" />

        <div className="flex justify-start flex-col text-brand-white">
          <p>Account 1</p>
          <small>0x0000....0000000000000</small>
        </div>
      </div>


      {encriptedMnemonic && !importSeed ? (
        <IconButton
          type="primary"
          shape="circle"
          onClick={() => {
            console.log('accountSettingsShowed', accountSettingsShowed)
            accountSettingsShowed ? handleCloseSettings() : showSettings(!accountSettingsShowed)
          }
          }
        >
          <Icon name="dots" className="w-4 bg-brand-graydark100 text-brand-white" />
        </IconButton>
      ) : (
        null
      )}

      <Settings
        accountSettings
        generalSettings={false}
        open={accountSettingsShowed && isUnlocked}
        onClose={handleCloseSettings}
      />
    </div>
  )
}

export default AccountHeader;