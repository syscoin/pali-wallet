import React, { FC } from 'react';
import { useNavigate } from 'react-router-dom';

import dotsImage from 'assets/images/dotsHeader.svg';
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

  const isSwitchChainPage =
    title === 'Switch Chain' || title === 'Cambiar Cadena';
  const bgHeader = isSwitchChainPage
    ? 'bg-gradient'
    : 'bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]';

  const isConnectPage =
    title === 'CONNECT ACCOUNT' || title === 'CONECTAR CUENTA';

  const isHardwareWalletPage =
    title === 'HARDWARE WALLET' || title === 'MONEDERO HARDWARE';

  return (
    <div
      className={`scrollbar-styled relative w-full min-w-popup max-h-popup min-h-popup text-brand-white bg-brand-blue700  ${
        isSwitchChainPage ? '' : 'overflow-y-scroll'
      }`}
    >
      {!titleOnly && canGoBack && !isHardwareWalletPage && <Header />}
      <div
        className={`relative flex rounded-b-[20px] items-center justify-center px-[18px] py-5 w-full h-[4.25rem] text-brand-white ${bgHeader}`}
      >
        <img
          src={dotsImage}
          alt="Image description"
          className="absolute object-cover bg-repeat-x w-full h-full"
        />

        {!titleOnly && canGoBack && !isHardwareWalletPage && (
          <IconButton
            className="z-50 cursor-pointer"
            onClick={() => navigate('/home')}
          >
            <Icon isSvg={true} name="ArrowLeft" />
          </IconButton>
        )}

        <p className="w-full text-center text-base" id={id}>
          {title}
        </p>

        {!titleOnly && canGoBack && !isHardwareWalletPage && (
          <IconButton
            className="z-50 cursor-pointer"
            onClick={() => navigate('/home')}
          >
            <Icon isSvg={true} name="Close" />
          </IconButton>
        )}

        <Icon
          size={29}
          name="select-up"
          wrapperClassname="absolute -bottom-4 text-center text-bkg-2"
          color="#111E33"
        />
      </div>

      <div
        className={`flex flex-col items-center justify-center md:mx-auto pt-8 px-[18px] w-full ${
          isConnectPage ? '' : 'md:max-w-sm'
        } text-brand-white bg-brand-blue700 sm:max-w-full`}
      >
        {children}
      </div>
    </div>
  );
};
