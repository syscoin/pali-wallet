import React, { FC } from 'react';
import { Icon, IconButton, Tooltip } from 'components/index';
import { useUtils, useBrowser } from 'hooks/index';

import { Header } from '../Header';

interface IAuthViewLayout {
  background?: string;
  canGoBack?: boolean;
  children: any;
  id?: string;
  title: string;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  id = '',
  children,
  background = 'bkg-2',
  canGoBack = true,
}) => {
  const { navigate } = useUtils();
  const { browser } = useBrowser();

  const url = browser.runtime.getURL('app.html');

  return (
    <div
      className={`bg-${background} w-full min-h-popup min-w-popup h-full text-brand-white relative`}
    >
      <Header normalHeader />

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
          className={`text-${background} fixed top-24`}
          color="#111E33"
        />
      </div>

      <div
        className={`bg-${background} text-brand-white flex flex-col justify-center items-center w-full xl:h-full`}
      >
        {children}
      </div>
    </div>
  );
};
