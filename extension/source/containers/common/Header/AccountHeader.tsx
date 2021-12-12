import React, { FC, useEffect } from 'react';
import { Settings } from 'containers/auth/index';
import { IconButton, Icon } from 'components/index';
import { useFormat, useAccount } from 'hooks/index';
import { toSvg } from 'jdenticon';

interface IAccountHeader {
  encriptedMnemonic: string;
  importSeed: boolean;
  accountSettingsShowed: boolean;
  handleCloseSettings: any;
  showSettings: any;
  isUnlocked: boolean;
}

export const AccountHeader: FC<IAccountHeader> = ({
  encriptedMnemonic,
  importSeed,
  accountSettingsShowed,
  handleCloseSettings,
  showSettings,
  isUnlocked
}) => {
  const { activeAccount } = useAccount();
  const { ellipsis } = useFormat();

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');

    placeholder!.innerHTML += toSvg(activeAccount?.address.main, 50, {
      backColor: '#fff',
      padding: 1
    });
  }, [activeAccount?.address.main]);

  return (
    <div>
      <div className="flex items-center justify-between bg-brand-navyborder p-1">
        <div className="flex items-center w-full text-brand-white">
          <div className="add-identicon mr-2 ml-1 my-2"></div>

          <div className="text-brand-white px-1 justify-center items-center">
            <p className="text-base">{activeAccount!.label}</p>
            <p className="text-xs">{ellipsis(activeAccount!.address.main, 6, 14)}</p>
          </div>

          <IconButton
            type="primary"
            shape="circle"
            className="mt-3"
          >
            <Icon name="copy" className="text-xs" />
          </IconButton>
        </div>


        {encriptedMnemonic && !importSeed ? (
          <IconButton
            type="primary"
            shape="circle"
            className="mb-2 mr-2"
            onClick={() => accountSettingsShowed ? handleCloseSettings() : showSettings(!accountSettingsShowed)}
          >
            <Icon name="dots" className="text-brand-white" />
          </IconButton>
        ) : (
          null
        )}
      </div>

      <Settings
        accountSettings
        generalSettings={false}
        open={accountSettingsShowed && isUnlocked}
        onClose={handleCloseSettings}
      />
    </div>
  )
}
