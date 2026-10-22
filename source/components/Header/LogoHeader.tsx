import React from 'react';

import paliIcon from 'assets/all_assets/favicon-32.png';
import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';

export const LogoHeader: React.FC = () => {
  const { navigate } = useUtils();

  return (
    <div className="relative w-full max-w-[25rem]">
      <img
        src={paliIcon}
        className="max-w-40 mt-4 mx-auto w-40 h-40"
        alt="Pali Wallet"
      />

      <IconButton
        className="absolute right-6 top-0"
        onClick={() => navigate('/', { replace: true })}
      >
        <Icon name="home" className="text-brand-royalblue opacity-60" />
      </IconButton>
    </div>
  );
};
