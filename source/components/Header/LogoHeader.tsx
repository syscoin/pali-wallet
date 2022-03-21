import React from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';

export const LogoHeader: React.FC = () => {
  const { navigate } = useUtils();

  return (
    <div className="relative">
      <img
        src={`/${LogoImage}`}
        className="max-w-40 mt-4 mx-auto w-40"
        alt="pali"
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
