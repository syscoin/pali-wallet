import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { RootState } from 'state/store';

const LOADING_OVERLAY_EXCLUDED_PAGES = new Set([
  '/chain-fail-to-connect',
  '/settings/networks/custom-rpc',
  // Dapp approval pages own their pending state.
  '/external/switch-network',
  '/external/add-ethchain',
  '/external/switch-ethchain',
  '/external/switch-utxoevm',
]);

// Router paths are case-insensitive and accept trailing slashes and encoded
// segments. Safety guards must cover those aliases of the same rendered page.
export const normalizeWalletPathname = (pathname: string): string => {
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // A malformed escape must not throw while rendering recovery controls.
  }
  return pathname.toLowerCase().replace(/\/+$/, '') || '/';
};

export const isPageLoadingOverlayExcluded = (pathname: string): boolean =>
  LOADING_OVERLAY_EXCLUDED_PAGES.has(normalizeWalletPathname(pathname));

// Navigation stays available during slow reads, but actions tied to the active
// account/network must not submit while that context is changing.
export const isContextSensitiveWalletRoute = (pathname: string): boolean => {
  pathname = normalizeWalletPathname(pathname);
  return (
    pathname === '/home' ||
    pathname === '/settings/advanced' ||
    /^\/settings\/networks\/(?:edit|custom-rpc)$/.test(pathname) ||
    /^(?:\/external)?\/(?:send|tx|tokens)(?:\/|$)/.test(pathname) ||
    /^(?:\/external)?\/settings\/(?:account(?:\/|$)|edit-account$|manage-accounts$|forget-wallet$|seed$)/.test(
      pathname
    ) ||
    pathname === '/home/smart-account' ||
    /^\/external\/(?:smart-account|smart-account-modules|watch-asset|connect-wallet|change-account|change-active-connected-account)$/.test(
      pathname
    )
  );
};

export const usePageLoadingState = (
  additionalLoadingConditions: boolean[] = []
) => {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const isSwitchingAccount = useSelector(
    (state: RootState) => state.vaultGlobal.isSwitchingAccount
  );
  const networkTarget = useSelector(
    (state: RootState) => state.vaultGlobal.networkTarget
  );
  const isLoadingBalances = useSelector(
    (state: RootState) => state.vaultGlobal.loadingStates.isLoadingBalances
  );
  const isPollingUpdate = useSelector(
    (state: RootState) => state.vaultGlobal.isPollingUpdate
  );
  const isNetworkChanging = networkStatus === 'switching';
  const isConnecting = networkStatus === 'connecting';
  const isNonPollingBalanceLoad = isLoadingBalances && !isPollingUpdate;
  const isContextChanging =
    isNetworkChanging || isConnecting || isSwitchingAccount;
  const isLoading =
    isContextChanging ||
    isNonPollingBalanceLoad ||
    additionalLoadingConditions.some(Boolean);

  let message = t('buttons.loading');
  if (isNetworkChanging && networkTarget) {
    message = t('networkConnection.connecting', {
      network: networkTarget.label,
    });
  } else if (isNetworkChanging || isConnecting) {
    message = t('networkConnection.switchingNetwork');
  } else if (isNonPollingBalanceLoad) {
    message = t('networkConnection.updatingBalances');
  }

  return {
    isLoading: !isPageLoadingOverlayExcluded(pathname) && isLoading,
    isContextChanging,
    message,
  };
};
