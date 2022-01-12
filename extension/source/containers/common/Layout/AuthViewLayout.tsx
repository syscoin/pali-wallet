import React, { FC } from 'react';
import { Icon, IconButton, Tooltip } from 'components/index';
import { useUtils, useBrowser } from 'hooks/index';

import { Header } from '../Header';

interface IAuthViewLayout {
  background?: string;
  canGoBack?: boolean;
  children: any;
  title: string;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children,
  background = 'bkg-2',
  canGoBack = true,
}) => {
  const { history } = useUtils();
  const { browser } = useBrowser();

  const url = browser.runtime.getURL('app.html');

  return (
    <div
      className={`bg-${background} w-full h-popup text-brand-white relative`}
    >
      <Header normalHeader />

      <div className="w-full relative flex justify-center items-center text-brand-white pt-6 bg-bkg-3">
        {url && canGoBack && (
          <Tooltip content="Go to fullscreen">
            <IconButton onClick={() => window.open(url)}>
              <Icon
                className="text-brand-white absolute left-5 bottom-1"
                name="desktop"
              />
            </IconButton>
          </Tooltip>
        )}

        <p className="text-xl w-full text-center">{title}</p>

        {canGoBack && (
          <IconButton onClick={() => history.push('/home')}>
            <Icon wrapperClassname="absolute bottom-1 right-4" name="close" />
          </IconButton>
        )}
      </div>

      <div className="bg-bkg-3 pt-2 pb-3 mb-3 flex justify-center items-center relative">
        <Icon
          size={36}
          name="select-down"
          wrapperClassname="w-8"
          className={`text-${background} fixed top-24`}
        />
      </div>

      <div
        className={`bg-${background} text-brand-white flex flex-col justify-center items-center w-full`}
      >
        {children}
      </div>
    </div>
  );
};
