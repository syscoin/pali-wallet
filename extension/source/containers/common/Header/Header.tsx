import React from 'react';
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
  const { changingNetwork } = useStore();

  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();

  return (
    <div
      className={normalHeader && accountHeader ?
        "pb-32" :
        onlySection ? "" : "pb-12"
      }
    >
      {changingNetwork && (
        <div className="bg-brand-black bg-opacity-50 z-20 flex justify-center items-center fixed w-full h-full">
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
              isUnlocked={isUnlocked}
            />

            {accountHeader && (
              <AccountHeader
                importSeed={importSeed}
                isUnlocked={isUnlocked}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
