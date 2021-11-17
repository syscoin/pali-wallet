import React, { FC } from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { Icon, IconButton } from 'components/index';
import { Settings } from 'containers/auth/index';
import { CopyOutlined } from '@ant-design/icons';

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
    <div className="flex items-center bg-brand-navyborder p-1">
      <div className="flex items-center pr-14">
        <img src={`/${LogoImage}`} className="mx-auto w-14 rounded-full" alt="Syscoin" />

        <div className="flex flex-col text-brand-white pl-1">
          <p className="text-base">Account 1</p>
          <small className="text-xs">0x0000....0000000000000  </small>
          <button className="w-1"> <CopyOutlined style={{fontSize: '12px'}}/> </button>
        </div>
      </div>


      {encriptedMnemonic && !importSeed ? (
        <div className="pl-24 mr-1">
          <IconButton
            type="primary"
            shape="circle"
            className="bg-brand-navyborder"
            onClick={() => {
              console.log('accountSettingsShowed', accountSettingsShowed)
              accountSettingsShowed ? handleCloseSettings() : showSettings(!accountSettingsShowed)
            }
          }
          >
            <Icon name="dots" className="w-4 text-brand-white" />
          </IconButton>
        </div>
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