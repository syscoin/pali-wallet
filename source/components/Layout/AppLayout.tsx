import React, { FC, useMemo, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import dotsImage from 'assets/all_assets/dotsHeader.png';
import { Header } from 'components/Header/Header';
import { Icon, IconButton } from 'components/index';
import { PageLoadingOverlay } from 'components/Loading/PageLoadingOverlay';
import { useAppReady } from 'hooks/useAppReady';
import { usePageLoadingState } from 'hooks/usePageLoadingState';
import { RootState } from 'state/store';
import { navigateBack } from 'utils/navigationState';

// Memoize frequently used navigation icons to prevent unnecessary re-renders
const BackArrowIcon = memo(() => <Icon isSvg={true} name="ArrowLeft" />);
BackArrowIcon.displayName = 'BackArrowIcon';

const CloseIcon = memo(() => <Icon isSvg={true} name="Close" />);
CloseIcon.displayName = 'CloseIcon';

interface IAppLayout {
  children?: React.ReactNode;
}

export const AppLayout: FC<IAppLayout> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // Use the new page loading state hook
  const { isLoading, hasTimedOut } = usePageLoadingState();

  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );

  // Signal app is ready when this layout renders
  useAppReady();

  // Determine if we should show the account header based on route
  const shouldShowAccountHeader = useMemo(() => {
    const homeRoutes = ['/home'];
    return homeRoutes.includes(location.pathname);
  }, [location.pathname]);

  // Determine if we should hide the header entirely (e.g., hardware wallet page)
  const hideHeader = useMemo(() => {
    const hideHeaderRoutes = ['/external/settings/account/hardware'];
    return hideHeaderRoutes.includes(location.pathname);
  }, [location.pathname]);

  // Determine if this is a title-only page (shows banner but not header)
  const titleOnly = useMemo(() => {
    const titleOnlyRoutes = [
      // External routes should be title-only (no persistent header)
      '/external/login',
      '/external/connect-wallet',
      '/external/change-account',
      '/external/change-active-connected-account',
      '/external/watch-asset',
      '/external/switch-network',
      '/external/add-EthChain',
      '/external/switch-EthChain',
      '/external/switch-UtxoEvm',
      // External transaction routes should also be title-only
      '/external/tx/ethSign',
      '/external/tx/sign',
      '/external/tx/sign-psbt',
      '/external/tx/send/ethTx',
      '/external/tx/send/nTokenTx',
      '/external/tx/send/approve',
      '/external/tx/decrypt',
      '/external/tx/encryptKey',
    ];
    return titleOnlyRoutes.includes(location.pathname);
  }, [location.pathname]);

  // Determine if this is a connect page (affects content width)
  const isConnectPage = useMemo(() => {
    const connectRoutes = ['/external/connect-wallet'];
    return connectRoutes.includes(location.pathname);
  }, [location.pathname]);

  // Get dynamic page data from location state
  const locationState = location.state as any;

  // Get the page title based on current route
  const pageTitle = useMemo(() => {
    const path = location.pathname;

    // Handle dynamic titles from location state
    if (locationState?.pageTitle) {
      return locationState.pageTitle;
    }

    // Route-based titles
    if (path === '/home') return '';
    if (path === '/home/details') {
      // Handle dynamic Details page titles
      if (locationState?.nftCollection && locationState?.nftData)
        return t('send.nftDetails');
      if (locationState?.id && !locationState?.hash)
        return t('titles.assetDetails');
      return t('titles.transactionDetails');
    }
    if (path === '/receive')
      return `${t('receive.receiveTitle')} ${
        activeNetwork?.currency?.toUpperCase() || ''
      }`;
    if (path === '/send/eth')
      return `${t('send.send')} ${
        activeNetwork?.currency?.toUpperCase() || ''
      }`;
    if (path === '/send/sys')
      return `${t('send.send')} ${
        activeNetwork?.currency?.toUpperCase() || ''
      }`;
    if (path === '/send/confirm') return t('send.confirm');
    if (path === '/faucet') return activeNetwork?.label || 'Faucet';
    if (path === '/tokens/add') return t('buttons.addToken');
    if (path === '/chain-fail-to-connect') return t('chainError.errorTitle');
    if (path === '/switch-network') return t('settings.switchChain');
    if (path === '/switch-utxo-evm') return t('settings.switchChain');

    // Transaction routes (both internal and external)
    if (path === '/send/approve') return t('send.approve');
    if (path === '/send/tx/send/ethTx') return t('send.send');
    if (path === '/send/tx/send/nTokenTx') return t('send.send');
    if (path === '/tx/sign') return t('send.sign');
    if (path === '/tx/ethSign') return t('send.sign');
    if (path === '/tx/encryptKey') return t('send.encryptKey');
    if (path === '/tx/decrypt') return t('send.decrypt');

    // External transaction routes
    if (path === '/external/tx/send/confirm') return t('send.confirm');
    if (path === '/external/tx/send/ethTx') return t('send.send');
    if (path === '/external/tx/send/nTokenTx') return t('send.send');
    if (path === '/external/tx/send/approve') return t('send.approve');
    if (path === '/external/tx/sign') return t('send.sign');
    if (path === '/external/tx/ethSign') return t('send.sign');
    if (path === '/external/tx/encryptKey') return t('send.encryptKey');
    if (path === '/external/tx/decrypt') return t('send.decrypt');
    if (path === '/external/tx/sign-psbt') return t('send.sign');

    // External dApp routes
    if (path === '/external/connect-wallet')
      return t('connections.connectAccount');
    if (path === '/external/change-account')
      return t('connections.connectedAccount');
    if (path === '/external/change-active-connected-account')
      return t('connections.connectedAccount');
    if (path === '/external/watch-asset') return t('buttons.addToken');
    if (path === '/external/switch-network') return t('settings.switchChain');
    if (path === '/external/add-EthChain') return t('settings.customRpc');
    if (path === '/external/switch-EthChain') return t('settings.switchChain');
    if (path === '/external/switch-UtxoEvm') return t('settings.switchChain');
    if (path === '/external/settings/account/hardware')
      return t('settings.hardwareWallet');

    // Settings routes
    if (path.startsWith('/settings')) {
      if (path === '/settings/about')
        return t('generalMenu.infoHelp').toUpperCase();
      if (path === '/settings/advanced') return t('settings.advancedTitle');
      if (path === '/settings/languages') return 'Languages';
      if (path === '/settings/currency') return t('settings.fiatCurrency');
      if (path === '/settings/forget-wallet') return t('generalMenu.forget');
      if (path === '/settings/seed') return t('settings.walletSeedPhrase');
      if (path === '/settings/manage-accounts')
        return t('settings.manageAccounts');
      if (path === '/settings/edit-account') return t('settings.editAccount');

      if (path === '/settings/account/new') return t('settings.createAccount');
      if (path === '/settings/account/import')
        return t('header.importAccount').toUpperCase();
      if (path === '/settings/account/private-key')
        return t('accountMenu.yourKeys').toUpperCase();
      if (path === '/settings/networks/connected-sites')
        return t('settings.connectedSites');
      if (path === '/settings/networks/custom-rpc') {
        // Handle dynamic CustomRPC titles
        return locationState?.isEditing
          ? `${t('buttons.edit')} RPC`
          : t('settings.customRpc');
      }
      if (path === '/settings/networks/edit')
        return t('settings.manageNetworks');
      if (path === '/settings/networks/trusted-sites')
        return t('settings.trustedWebsites');
      if (path === '/settings/remove-eth')
        return t('settings.manageEthProvider');
    }

    return '';
  }, [
    location.pathname,
    location.state,
    t,
    activeNetwork?.currency,
    locationState,
  ]);

  // Background color - always use dark background, no color change during loading
  const bgColor = 'bg-bkg-3';

  // Don't show banner on home page and chain error page
  const showBanner = useMemo(() => {
    const noBannerRoutes = ['/home', '/chain-fail-to-connect'];
    return (
      !noBannerRoutes.includes(location.pathname) && pageTitle && !hideHeader
    );
  }, [location.pathname, pageTitle, hideHeader]);

  // Check if this is an external transaction
  const isExternalTransaction = useMemo(
    () =>
      // Check location state for external flag
      locationState?.external === true,
    [locationState]
  );

  // Determine if we should show navigation buttons
  const showNavigationButtons = useMemo(() => {
    // Pages that shouldn't show back/close buttons
    const noNavigationRoutes = [
      '/switch-network',
      '/switch-utxo-evm',
      // External dApp routes
      '/external/login',
      '/external/connect-wallet',
      '/external/change-account',
      '/external/change-active-connected-account',
      '/external/watch-asset',
      '/external/switch-network',
      '/external/add-EthChain',
      '/external/switch-EthChain',
      '/external/switch-UtxoEvm',
      // External transaction routes
      '/external/tx/send/confirm',
      '/external/tx/send/ethTx',
      '/external/tx/send/nTokenTx',
      '/external/tx/send/approve',
      '/external/tx/sign',
      '/external/tx/ethSign',
      '/external/tx/encryptKey',
      '/external/tx/decrypt',
      '/external/tx/sign-psbt',
    ];

    // Don't show buttons if:
    // 1. Route is in noNavigationRoutes
    // 2. Page has titleOnly or hideHeader
    // 3. Transaction is external (from dApp)
    return (
      !noNavigationRoutes.includes(location.pathname) &&
      !titleOnly &&
      !hideHeader &&
      !isExternalTransaction
    );
  }, [location.pathname, titleOnly, hideHeader, isExternalTransaction]);

  // Determine banner gradient style
  const bannerGradient = useMemo(() => {
    // Special gradient for switch network pages
    if (
      location.pathname === '/switch-network' ||
      location.pathname === '/switch-utxo-evm'
    ) {
      return 'bg-gradient'; // This is the blue gradient
    }
    // Default gradient for other pages
    return 'bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]';
  }, [location.pathname]);

  // Back navigation handler
  const handleBackNavigation = useCallback(() => {
    // First check for navigation context
    const hasNavigationContext = location.state?.returnContext;

    if (hasNavigationContext) {
      navigateBack(navigate, location);
    } else {
      // Always go to home when no navigation context
      // This prevents cycling through browser history
      navigate('/home');
    }
  }, [location, navigate]);

  // Get page ID based on route
  const pageId = useMemo(() => {
    if (location.pathname === '/settings/about') return 'info-help-title';
    if (location.pathname === '/external/settings/account/hardware')
      return 'hardware-wallet-title';
    return undefined;
  }, [location.pathname]);

  // Determine if we should disable scrolling (for switch chain pages)
  const disableScroll = useMemo(
    () =>
      location.pathname === '/switch-network' ||
      location.pathname === '/switch-utxo-evm',
    [location.pathname]
  );

  return (
    <div
      className={`scrollbar-styled remove-scrollbar relative w-full min-w-popup max-h-popup min-h-popup text-brand-white ${bgColor} overflow-x-hidden ${
        disableScroll ? '' : 'overflow-y-auto'
      }`}
    >
      {/* Loading overlay - shows after delay for content area only */}
      <PageLoadingOverlay
        isLoading={isLoading}
        hasTimedOut={hasTimedOut}
        hasHeader={!hideHeader && !titleOnly}
        hasBanner={showBanner}
      />

      {/* Persistent header across all routes - respect hideHeader and titleOnly */}
      {!hideHeader && !titleOnly && (
        <Header accountHeader={shouldShowAccountHeader} />
      )}
      {/* Page title banner - only shown on pages that need it */}
      {showBanner && (
        <div
          className={`relative z-[60] flex rounded-b-[20px] items-center justify-center px-[18px] py-5 w-full h-[4.25rem] text-brand-white gradient-banner-animated ${bannerGradient}`}
        >
          <img
            src={dotsImage}
            alt="Image description"
            className="absolute object-cover bg-repeat-x w-full h-full"
          />

          {/* Animated particles for the gradient banner */}
          <div className="banner-particle-1"></div>
          <div className="banner-particle-2"></div>
          <div className="banner-particle-3"></div>
          <div className="banner-particle-4"></div>
          <div className="banner-particle-5"></div>

          {/* Back button */}
          {showNavigationButtons ? (
            <IconButton
              className="z-40 cursor-pointer"
              onClick={handleBackNavigation}
            >
              <BackArrowIcon />
            </IconButton>
          ) : (
            <div className="w-5" />
          )}

          <p className="w-full text-center text-base z-10" id={pageId}>
            {pageTitle}
          </p>

          {/* Close button */}
          {showNavigationButtons ? (
            <IconButton
              className="z-40 cursor-pointer"
              onClick={() => {
                if (
                  networkStatus === 'error' ||
                  networkStatus === 'connecting'
                ) {
                  navigate('/chain-fail-to-connect');
                } else {
                  navigate('/home');
                }
              }}
            >
              <CloseIcon />
            </IconButton>
          ) : (
            <div className="w-5" />
          )}

          <Icon
            size={29}
            name="select-up"
            wrapperClassname="absolute -bottom-4 text-center text-bkg-2"
            color="#111E33"
          />
        </div>
      )}

      {/* Content area */}
      {location.pathname === '/home' ? (
        // Home page gets no wrapper - it has its own layout
        <>{children || <Outlet />}</>
      ) : hideHeader ? (
        // Hardware wallet and other hideHeader pages get no wrapper
        <>{children || <Outlet />}</>
      ) : (
        // Other pages get the standard content wrapper
        <div
          className={`flex flex-col items-center justify-center md:mx-auto ${
            showBanner ? 'pt-8' : 'pt-4'
          } px-[24px] w-full page-content ${
            isConnectPage ? '' : 'md:max-w-sm'
          } text-brand-white sm:max-w-full`}
        >
          {children || <Outlet />}
        </div>
      )}
    </div>
  );
};
