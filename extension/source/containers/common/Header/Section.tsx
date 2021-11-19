import React from 'react';
import LogoImage from 'assets/images/logo-s.svg';
import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';

export const Section = () => {
  const { history } = useUtils();

  return (
    <div className="relative">
      <img
        src={`/${LogoImage}`}
        className="w-40 max-w-40 mx-auto mt-4"
        alt="pali"
      />

      <IconButton className="absolute top-0 -right-24" onClick={() => history.goBack()}>
        <Icon name="home" className="text-brand-white" />
      </IconButton>
    </div>

  )
}
