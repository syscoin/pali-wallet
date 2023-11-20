import React, { FC } from 'react';
import {
  IoIosArrowBack as BackIcon,
  IoMdClose as CloseIcon,
} from 'react-icons/io';
import { useNavigate } from 'react-router-dom';

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

  // const url = browser.runtime.getURL('app.html');

  const isSwitchChainPage =
    title === 'Switch Chain' || title === 'Cambiar Cadena';
  const bgHeader = isSwitchChainPage ? 'bg-gradient' : 'bg-bkg-3';

  const isConnectPage =
    title === 'CONNECT ACCOUNT' || title === 'CONECTAR CUENTA';

  const isHardwareWalletPage =
    title === 'HARDWARE WALLET' || title === 'MONEDERO HARDWARE';

  const isTokenPage = title === 'IMPORT TOKEN' || 'ASSET DETAILS';

  return (
    <div
      className={`scrollbar-styled relative w-full min-w-popup max-h-popup min-h-popup text-brand-white bg-bkg-2 ${
        isSwitchChainPage ? '' : 'overflow-y-scroll'
      }`}
    >
      {!titleOnly && canGoBack && !isHardwareWalletPage && <Header />}

      <div
        className={`relative flex items-center justify-center px-5 w-full ${
          isTokenPage ? 'h-tokenHeader' : 'h-20'
        } text-brand-white ${isTokenPage ? 'bg-token-gradient' : bgHeader}`}
        style={{ borderRadius: `${isTokenPage ? '0px 0px 20px 20px' : ''}` }}
      >
        {/* {!titleOnly && url && canGoBack && (
          <Tooltip content="Fullscreen mode">
            <IconButton onClick={() => window.open(url)}>
              <Icon className="text-brand-white sm:hidden" name="desktop" />
            </IconButton>
          </Tooltip>
        )} */}

        {!titleOnly && canGoBack && !isHardwareWalletPage && (
          <IconButton onClick={() => navigate('/home')}>
            <BackIcon color="text-brand-white" size={24} />
          </IconButton>
        )}

        <p className="w-full text-center text-xl" id={id}>
          {title}
        </p>

        {!titleOnly && canGoBack && !isHardwareWalletPage && (
          <IconButton onClick={() => navigate('/home')}>
            <CloseIcon color="text-brand-white" size={24} />
          </IconButton>
        )}

        <Icon
          size={36}
          name="select-up"
          wrapperClassname="absolute -bottom-4 text-center text-bkg-2"
          color="#111E33"
        />
      </div>

      <div
        className={`flex flex-col items-center justify-center md:mx-auto pt-8 px-4 w-full ${
          isConnectPage ? '' : 'md:max-w-sm'
        } text-brand-white bg-bkg-2 sm:max-w-full`}
      >
        {children}
      </div>
    </div>
  );
};
