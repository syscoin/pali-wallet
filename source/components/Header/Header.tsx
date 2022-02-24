import React from 'react';
import { useController, useStore } from 'hooks/index';
import { Icon } from 'components/Icon';

import { AccountHeader, NormalHeader, LogoHeader } from './index';

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
        <div className="fixed z-20 flex items-center justify-center w-full min-w-popup h-full min-h-popup bg-brand-black bg-opacity-50">
          <Icon name="loading" className="ml-2 w-4 text-brand-white" />
        </div>
      )}

      {onlySection && <LogoHeader />}

      <div className="fixed z-10 w-full md:max-w-2xl">
        {normalHeader && (
          <>
            <NormalHeader importSeed={importSeed} isUnlocked={isUnlocked} />

            {accountHeader && <AccountHeader />}
          </>
        )}
      </div>
    </div>
  );
};
