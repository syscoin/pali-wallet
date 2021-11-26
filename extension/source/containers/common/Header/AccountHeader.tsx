import React, { FC } from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { Settings } from 'containers/auth/index';
import { Button } from 'antd';
import { Icon } from 'components/Icon';

interface IAccountHeader {
  encriptedMnemonic: string;
  importSeed: boolean;
  accountSettingsShowed: boolean;
  handleCloseSettings: any;
  showSettings: any;
  isUnlocked: boolean;
}

export const AccountHeader: FC <IAccountHeader> = ({
  encriptedMnemonic,
  importSeed,
  accountSettingsShowed,
  handleCloseSettings,
  showSettings,
  isUnlocked
}) => {
  return (
    <div className="flex items-center bg-brand-navyborder p-1">
      <div className="flex items-center pr-12 mr-1 text-brand-white ">
        <div>
          <img src={`/${LogoImage}`} className="mx-auto w-14 rounded-full" alt="Syscoin" />
        </div>
        <div className="text-brand-white pl-1 justify-center items-center pr-1">
          <p className="text-base">Account 1</p>
          <p className="text-xs">0x0000....0000000000000  </p>
        </div>
        <div>
          <Button className="w-1 pt-4 pl-1"><Icon name="copy" className="inline-flex self-center text-xs" /></Button>
        </div>
      </div>


      {encriptedMnemonic && !importSeed ? (
        <div className="pl-20  text-brand-white">
          <Button
             type="primary"
             shape="circle"
             className="bg-brand-navyborder"
             onClick={() => {
               console.log('accountSettingsShowed', accountSettingsShowed)
               accountSettingsShowed ? handleCloseSettings() : showSettings(!accountSettingsShowed)
             }
           }>
            <Icon name="dots" className="inline-flex self-center text-lg" maxWidth={"1"} />
          </Button>
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
