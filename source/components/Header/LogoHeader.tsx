import React from 'react';

import favicon128 from 'assets/all_assets/favicon-128.png';
import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';

export const LogoHeader: React.FC = () => {
  const { navigate } = useUtils();

  return (
    <div className="relative">
      <img
        src={favicon128}
        className="max-w-40 mt-4 mx-auto w-40 h-40"
        alt="Pali Wallet"
      />

      <IconButton
        className="absolute -right-24 top-0"
        onClick={() => navigate(-1)}
      >
        <Icon name="home" className="text-brand-royalblue opacity-60" />
      </IconButton>
    </div>
  );
};
