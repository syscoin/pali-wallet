import React, { FC } from 'react';
import { Header, Icon, IconButton, Tooltip } from 'components/index';
import { browser } from 'webextension-polyfill-ts';
import { useNavigate } from 'react-router-dom';

interface ILayout {
  canGoBack?: boolean;
  children: React.ReactNode;
  id?: string;
  title: string;
}

export const Layout: FC<ILayout> = ({
  canGoBack = true,
  children,
  id = '',
  title,
}) => {
  const navigate = useNavigate();

  const url = browser.runtime.getURL('app.html');

  return (
    <div className="relative w-full min-w-popup h-full min-h-popup text-brand-white bg-bkg-2">
      <Header />

      <div className="relative flex items-center justify-center pt-6 w-full text-brand-white bg-bkg-3">
        {url && canGoBack && (
          <Tooltip content="Go to fullscreen">
            <IconButton onClick={() => window.open(url)}>
              <Icon
                className="absolute bottom-1 left-5 text-brand-white sm:hidden"
                name="desktop"
              />
            </IconButton>
          </Tooltip>
        )}

        <p className="w-full text-center text-xl" id={id}>
          {title}
        </p>

        {canGoBack && (
          <IconButton onClick={() => navigate('/home')}>
            <Icon wrapperClassname="absolute bottom-1 right-4" name="close" />
          </IconButton>
        )}
      </div>

      <div className="relative flex items-center justify-center mb-3 pb-3 pt-2 bg-bkg-3">
        <Icon
          size={36}
          name="select-up"
          wrapperClassname="w-8"
          className="fixed top-24 text-bkg-2 md:top-36"
          color="#111E33"
        />
      </div>

      <div className="flex flex-col items-center justify-center mx-auto w-full max-w-xs text-brand-white bg-bkg-2 sm:max-w-full">
        {children}
      </div>
    </div>
  );
};
