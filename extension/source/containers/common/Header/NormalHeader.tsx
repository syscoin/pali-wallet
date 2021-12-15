import React, { FC } from 'react';
import { Icon, IconButton } from 'components/index';
import { Settings } from 'containers/auth/index';
import { useStore, useAccount, useUtils } from 'hooks/index';

interface INormalHeader {
  importSeed: boolean;
  generalSettingsShowed: boolean;
  handleCloseSettings: any;
  showSettings: any;
  isUnlocked: boolean;
  encriptedMnemonic: string;
  networkSettingsShowed: boolean;
  showNetworkSettings: any;
}

export const NormalHeader: FC<INormalHeader> = ({
  importSeed,
  generalSettingsShowed,
  handleCloseSettings,
  showSettings,
  isUnlocked,
  encriptedMnemonic,
  networkSettingsShowed,
  showNetworkSettings
}) => {
  const { activeNetwork } = useStore();
  const { handleRefresh } = useUtils();
  const { connectedAccount } = useAccount();

  const network = activeNetwork;

  return (
    <div className="flex items-center justify-between bg-brand-navydarker text-gray-300 p-2 w-full">
      {/* <Modal type="connection" open={isOpenModal} onClose={() => setIsOpenModal(false)} connectedAccount={connectedAccount} /> */}

      <div
        className="cursor-pointer w-full ml-2 flex items-center justify-start gap-x-2"
        onClick={() => networkSettingsShowed ? handleCloseSettings() : showNetworkSettings(!networkSettingsShowed)}
      >
        <div
          className={
            connectedAccount ?
              "rounded-full text-xs w-28 h-5 flex justify-center items-center border border-brand-lightgreen bg-brand-lightgreen text-brand-white" :
              "rounded-full text-xs w-28 h-5 flex justify-center items-center border bg-brand-transparentred border-brand-error text-brand-white"
          }
        >
          {connectedAccount ? 'connected' : 'not connected'}
        </div>

        <span>
          {network}
        </span>

        <IconButton className="mb-2">
          <Icon name="select-down" className="text-brand-white" />
        </IconButton>
      </div>

      <IconButton
        onClick={handleRefresh}
        className="text-brand-white"
      >
        <Icon
          name="reload"
          wrapperClassname="mb-2 mr-2"
        />
      </IconButton>

      {encriptedMnemonic && !importSeed ? (
        <IconButton
          type="primary"
          shape="circle"
          className="mb-2 mr-0.8"
          onClick={() => generalSettingsShowed ? handleCloseSettings() : showSettings(!generalSettingsShowed)}
        >
          <Icon name="settings" className="text-brand-white" />
        </IconButton>
      ) : (
        null
      )}

      <Settings
        accountSettings={false}
        generalSettings={generalSettingsShowed}
        networkSettings={networkSettingsShowed}
        open={generalSettingsShowed && isUnlocked || networkSettingsShowed && isUnlocked}
        onClose={handleCloseSettings}
      />
    </div>
  );
};
