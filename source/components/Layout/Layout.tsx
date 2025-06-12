import React, { FC, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import dotsImage from 'assets/all_assets/dotsHeader.png';
import { Header, Icon, IconButton } from 'components/index';

// Memoize frequently used navigation icons to prevent unnecessary re-renders
const BackArrowIcon = memo(() => <Icon isSvg={true} name="ArrowLeft" />);
BackArrowIcon.displayName = 'BackArrowIcon';

const CloseIcon = memo(() => <Icon isSvg={true} name="Close" />);
CloseIcon.displayName = 'CloseIcon';

const HeaderSelectIcon = memo(() => (
  <Icon
    size={29}
    name="select-up"
    wrapperClassname="absolute -bottom-4 text-center text-bkg-2"
    color="#111E33"
  />
));
HeaderSelectIcon.displayName = 'HeaderSelectIcon';

interface ILayout {
  canGoBack?: boolean;
  children: React.ReactNode;
  hideHeader?: boolean;
  id?: string;
  isConnectPage?: boolean;
  isSwitchChainPage?: boolean;
  title: string;
  titleOnly?: boolean;
}

export const Layout: FC<ILayout> = ({
  canGoBack = true,
  children,
  hideHeader = false,
  id = '',
  isConnectPage = false,
  isSwitchChainPage = false,
  title,
  titleOnly,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Check if this page was accessed from a dropdown menu
  const cameFromMenu = location.state?.fromMenu === true;

  const bgHeader = isSwitchChainPage
    ? 'bg-gradient'
    : 'bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]';

  // Back navigation handler
  const handleBackNavigation = () => {
    // If we came from a dropdown menu, go to home since menus are overlays on home page
    if (cameFromMenu) {
      navigate('/home');
    } else {
      // Otherwise use browser back navigation
      navigate(-1);
    }
  };

  return (
    <div
      className={`scrollbar-styled remove-scrollbar relative w-full min-w-popup max-h-popup min-h-popup text-brand-white bg-brand-blue700 transition-all duration-200 ease-in-out ${
        isSwitchChainPage ? '' : 'overflow-y-auto'
      }`}
    >
      {!titleOnly && canGoBack && !hideHeader && <Header />}
      <div
        className={`relative flex rounded-b-[20px] items-center justify-center px-[18px] py-5 w-full h-[4.25rem] text-brand-white animate-slideIn ${bgHeader}`}
      >
        <img
          src={dotsImage}
          alt="Image description"
          className="absolute object-cover bg-repeat-x w-full h-full"
        />

        {!titleOnly && canGoBack && !hideHeader && (
          <IconButton
            className="z-40 cursor-pointer"
            onClick={handleBackNavigation}
          >
            <BackArrowIcon />
          </IconButton>
        )}

        <p className="w-full text-center text-base" id={id}>
          {title}
        </p>

        {!titleOnly && canGoBack && !hideHeader && (
          <IconButton
            className="z-40 cursor-pointer"
            onClick={() => navigate('/home')}
          >
            <CloseIcon />
          </IconButton>
        )}

        <HeaderSelectIcon />
      </div>

      <div
        className={`flex flex-col items-center justify-center md:mx-auto pt-8 px-[24px] w-full animate-fadeIn page-content ${
          isConnectPage ? '' : 'md:max-w-sm'
        } text-brand-white bg-brand-blue700 sm:max-w-full`}
      >
        {children}
      </div>
    </div>
  );
};
