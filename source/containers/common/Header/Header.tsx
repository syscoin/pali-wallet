import React from 'react';
import { useController, useStore } from 'hooks/index';
import { Icon } from 'components/Icon';

import { AccountHeader, NormalHeader, Section } from './index';

type HeaderType = {
  accountHeader?: boolean;
  importSeed?: boolean;
  normalHeader?: boolean;
  onlySection?: boolean;
};

export const Header = ({
  importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = true,
}: HeaderType) => {
  const { changingNetwork } = useStore();

  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();

  const onlySectionStyle = onlySection ? '' : 'pb-12';

  const headerStyle =
    normalHeader && accountHeader ? 'pb-32' : onlySectionStyle;

  return (
    <div className={headerStyle}>
      {changingNetwork && (
        <div className="bg-brand-black bg-opacity-50 z-20 flex justify-center items-center fixed w-full min-h-popup min-w-popup h-full">
          <Icon name="loading" className="w-4 ml-2 text-brand-white" />
        </div>
      )}

      {onlySection && <Section />}

      <div className="fixed w-full z-10 md:max-w-2xl">
        {normalHeader && (
          <>
            <NormalHeader importSeed={importSeed} isUnlocked={isUnlocked} />

            {accountHeader && (
              <AccountHeader importSeed={importSeed} isUnlocked={isUnlocked} />
            )}
          </>
        )}
      </div>
    </div>
  );
};
