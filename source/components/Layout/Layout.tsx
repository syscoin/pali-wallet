import React, { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { browser } from 'webextension-polyfill-ts';

import { Header, Icon, IconButton } from 'components/index';

interface ILayout {
  canGoBack?: boolean;
  children: React.ReactNode;
  id?: string;
  title: string;
  titleOnly?: boolean;
}

export const Layout: FC<ILayout> = ({
  canGoBack = true,
  children,
  id = '',
  title,
  titleOnly,
}) => {
  const navigate = useNavigate();

  const url = browser.runtime.getURL('app.html');

  const isConnectPage = title === 'CONNECT WITH';

  return (
    <div className="relative w-full min-w-popup min-h-popup text-brand-white bg-bkg-2">
      {!titleOnly && canGoBack && <Header />}

      <div className="relative flex items-center justify-center px-5 w-full h-20 text-brand-white bg-bkg-3">
        {!titleOnly && url && canGoBack && (
          <IconButton onClick={() => window.open(url)}>
            <Icon className="text-brand-white sm:hidden" name="desktop" />
          </IconButton>
        )}

        <p className="mt-2 w-full text-center text-xl" id={id}>
          {title}
        </p>

        {!titleOnly && canGoBack && (
          <IconButton onClick={() => navigate('/home')}>
            <Icon name="close" />
          </IconButton>
        )}

        <Icon
          size={36}
          name="select-up"
          wrapperClassname="absolute -bottom-3 text-center text-bkg-2"
          color="#111E33"
        />
      </div>

      <div
        className={`flex flex-col items-center justify-center mx-auto pt-8 px-4 w-full ${
          isConnectPage ? '' : 'max-w-sm'
        } text-brand-white bg-bkg-2 sm:max-w-full`}
      >
        {children}
      </div>
    </div>
  );
};
