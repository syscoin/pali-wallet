import React, { FC } from 'react';
import { Icon, Button, IconButton } from 'components/index';
import { Settings } from 'containers/auth/index';
import { useStore, useAccount } from 'hooks/index';

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
  const { connectedAccount } = useAccount();

  const network = activeNetwork;

  return (
    <div className="flex items-center justify-between bg-brand-navydarker text-gray-300 p-2 w-full">
      {/* <Modal type="connection" open={isOpenModal} onClose={() => setIsOpenModal(false)} connectedAccount={connectedAccount} /> */}

      <Button
        className="w-full ml-2 flex items-center justify-start gap-x-4"
        noStandard
        type="button"
        onClick={() => networkSettingsShowed ? handleCloseSettings() : showNetworkSettings(!networkSettingsShowed)}
      >
        <div
          className={
            connectedAccount ?
              "rounded-full w-4 h-4 border border-brand-lightgreen bg-brand-lightgreen text-brand-white" :
              "rounded-full w-4 h-4 border bg-brand-transparentred border-brand-error text-brand-white"
          }
        ></div>

        <span className="ml-1">
          {network}
        </span>

        <IconButton className="mb-2">
          <Icon name="select-down" className="text-brand-white" />
        </IconButton>
      </Button>

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
  )
}
