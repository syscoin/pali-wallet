import { Disclosure, Menu } from '@headlessui/react';
import { INetwork, INetworkType } from '@sidhujag/sysweb3-network';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ChainIcon } from 'components/ChainIcon';
import {
  DropdownArrowSvg,
  BtcIconSvg,
  EthIconSvg,
  WhiteSuccessIconSvg,
  NetworkIconSvg,
  EditIconSvg,
  LoadingSvg,
} from 'components/Icon/Icon';
import { Icon } from 'components/index';
import Spinner from 'components/Spinner/Spinner';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import store, { RootState } from 'state/store';
import { switchNetworkError } from 'state/vaultGlobal';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

const GlobeIcon = memo(() => (
  <Icon
    name="globe"
    size={19}
    className="w-[19px] flex items-center ml-1 text-brand-white"
  />
));
GlobeIcon.displayName = 'GlobeIcon';

const CheckIcon = memo(() => (
  <Icon name="check" className="w-4" wrapperClassname="w-6" />
));
CheckIcon.displayName = 'CheckIcon';

interface INetworkComponent {
  disabled?: boolean;
}

const customSort = (a: INetwork, b: INetwork) => {
  const order = { 570: 2, 57: 1 };
  return (order[b.chainId] || 0) - (order[a.chainId] || 0);
};

export const NetworkMenu: React.FC<INetworkComponent> = (
  props: INetworkComponent
) => {
  const { disabled = false } = props;
  const { controllerEmitter } = useController();
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  const { navigate } = useUtils();

  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const dapps = useSelector((state: RootState) => state.dapp.dapps);

  // ✅ MEMOIZED: Computed values
  const isNetworkChanging = useMemo(
    () => networkStatus === 'switching',
    [networkStatus]
  );

  const networkType = useMemo(
    () => (isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum),
    [isBitcoinBased]
  );

  const networkDisplayType = useMemo(
    () => (isBitcoinBased ? 'UTXO' : 'EVM'),
    [isBitcoinBased]
  );

  const bgColor = useMemo(
    () =>
      networkType === INetworkType.Syscoin ? 'bg-brand-pink' : 'bg-brand-blue',
    [networkType]
  );

  // ✅ MEMOIZED: Network validation function
  const activeNetworkValidator = useCallback(
    (currentNetwork: INetwork): boolean =>
      Boolean(
        activeNetwork.chainId === currentNetwork.chainId &&
          activeNetwork.url === currentNetwork.url &&
          activeNetwork.label === currentNetwork.label
      ),
    [activeNetwork.chainId, activeNetwork.url, activeNetwork.label]
  );

  // ✅ MEMOIZED: Dapp connection status
  const hasConnectedDapps = useMemo(
    () => Object.values(dapps).length > 0,
    [dapps]
  );

  const connectedWebsiteTitle = useMemo(
    () =>
      hasConnectedDapps
        ? t('networkMenu.viewConnected')
        : t('networkMenu.noConnected'),
    [hasConnectedDapps, t]
  );

  const currentBgColor = useMemo(
    () => (hasConnectedDapps ? 'bg-brand-green' : 'bg-brand-red'),
    [hasConnectedDapps]
  );

  const currentBdgColor = useMemo(
    () =>
      hasConnectedDapps ? 'border-warning-success' : 'border-warning-error',
    [hasConnectedDapps]
  );

  // ✅ MEMOIZED: Network change handler
  const handleChangeNetwork = useCallback(
    async (network: INetwork, closeMenu?: () => void) => {
      // Check if user is trying to switch to the same network that's already active
      if (activeNetworkValidator(network)) {
        // Already on this network, no need to switch
        return;
      }

      try {
        // Close menu immediately after starting the switch
        if (closeMenu) {
          closeMenu();
        }

        // Then perform the actual network switch in the background
        controllerEmitter(['wallet', 'setActiveNetwork'], [network])
          .then(() => {
            // Success is already handled by the controller via setNetworkChange
          })
          .catch(() => {
            store.dispatch(switchNetworkError());
          });
      } catch (networkError) {}
    },
    [activeNetworkValidator, controllerEmitter]
  );

  // ✅ MEMOIZED: Navigation handlers
  const handleConnectedSitesNavigation = useCallback(() => {
    // Create navigation context to return to home
    const returnContext = createNavigationContext('/home');

    navigateWithContext(
      navigate,
      '/settings/networks/connected-sites',
      { fromMenu: true },
      returnContext
    );
  }, [navigate]);

  const handleTrustedSitesNavigation = useCallback(() => {
    // Create navigation context to return to home
    const returnContext = createNavigationContext('/home');

    navigateWithContext(
      navigate,
      '/settings/networks/trusted-sites',
      { fromMenu: true },
      returnContext
    );
  }, [navigate]);

  const handleCustomRpcNavigation = useCallback(() => {
    // Create navigation context to return to network menu
    const returnContext = createNavigationContext('/home');

    navigateWithContext(
      navigate,
      '/settings/networks/custom-rpc',
      { fromMenu: true },
      returnContext
    );
  }, [navigate]);

  const handleManageNetworksNavigation = useCallback(() => {
    // Create navigation context to return to home
    const returnContext = createNavigationContext('/home');

    navigateWithContext(navigate, '/settings/networks/edit', {}, returnContext);
  }, [navigate]);

  return (
    <Menu
      as="div"
      className="absolute z-[9999] w-full left-4 inline-block mr-8 text-left"
    >
      {(menuprops) => (
        <>
          <Menu.Button
            disabled={disabled}
            className={`group relative inline-flex gap-x-2 items-center justify-start ml-2 w-max text-white text-sm font-medium rounded-lg px-2 py-1.5 focus:outline-none transition-all duration-300 ease-in-out ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-gradient-to-r hover:from-brand-blue600/20 hover:to-brand-blue500/20 hover:backdrop-blur-sm cursor-pointer hover:shadow-lg hover:shadow-brand-blue600/10 active:scale-[0.98]'
            }`}
          >
            {/* Background glow effect on hover */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

            <div className="relative z-10 transform group-hover:scale-110 transition-transform duration-300 ease-out">
              <ChainIcon
                chainId={activeNetwork.chainId}
                size={20}
                networkKind={
                  isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum
                }
                className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
              />
            </div>
            <span className="relative z-10 font-light group-hover:font-medium group-hover:text-white transition-all duration-300">
              {activeNetwork.label}
            </span>
            <span
              className={`relative z-10 px-[6px] py-[2px] text-xs font-medium text-white rounded-full ${bgColor} group-hover:shadow-md transform group-hover:scale-105 transition-all duration-300`}
            >
              {networkDisplayType}
            </span>
            {isNetworkChanging && (
              <div className="relative z-10">
                <Spinner size={16} color="#ffffff" />
              </div>
            )}

            <div className="relative z-10 transform group-hover:scale-110 transition-transform duration-300">
              <DropdownArrowSvg
                isOpen={menuprops.open}
                className="right-2 group-hover:brightness-110 transition-all duration-300"
                id="network-settings-btn"
              />
            </div>
          </Menu.Button>

          <div
            className={`fixed z-50 -inset-0 w-full bg-brand-black transition-all duration-300 ease-in-out ${
              menuprops.open
                ? 'bg-opacity-50'
                : 'bg-opacity-0 pointer-events-none'
            }`}
          />

          {!disabled && (
            <Menu.Items
              as="div"
              className={`absolute overflow-x-hidden z-50 top-[10px] left-[-17px] w-screen h-screen text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl ring-1 ring-black ring-opacity-5
              transform transition-all duration-100 ease-out ${
                menuprops.open
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-95 pointer-events-none'
              }`}
              static
            >
              <div
                className="remove-scrollbar h-full overflow-y-auto overscroll-contain pt-5"
                style={{
                  paddingBottom: 'calc(100vh - 350px)',
                }}
              >
                <Menu.Item>
                  <li
                    onClick={handleConnectedSitesNavigation}
                    className={`flex items-center justify-start mb-2 mx-3 px-2 py-1  text-base ${currentBgColor} hover:bg-opacity-70 border border-solid border-transparent hover:${currentBdgColor} rounded-full cursor-pointer transition-all duration-200`}
                  >
                    <GlobeIcon />

                    <span
                      className={`px-3 ${
                        language === 'es' &&
                        connectedWebsiteTitle.includes('No hay')
                          ? 'text-xs'
                          : 'text-base'
                      }`}
                    >
                      {connectedWebsiteTitle}
                    </span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={handleTrustedSitesNavigation}
                    className="flex items-center justify-start mb-4 mx-3 px-2 py-1 text-base bg-brand-blue200 hover:bg-opacity-70 border border-solid border-brand-royalblue rounded-full cursor-pointer transition-all duration-200"
                  >
                    <WhiteSuccessIconSvg />

                    <span className="px-3 text-base">
                      {t('networkMenu.trustedSites')}
                    </span>
                  </li>
                </Menu.Item>
                <Menu.Item>
                  <>
                    <span className="disabled text-xs flex justify-start px-5 py-4">
                      {t('networkMenu.networks')}
                    </span>
                    <Disclosure>
                      {({ open }) => (
                        <>
                          <Disclosure.Button className="flex items-center justify-start px-5 py-1 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200">
                            <BtcIconSvg />

                            <span className="px-3 text-sm">
                              {t('networkMenu.utxoNetworks')}
                            </span>

                            <DropdownArrowSvg
                              isOpen={open}
                              className="ml-auto"
                              id="network-settings-btn"
                            />
                          </Disclosure.Button>

                          <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm">
                            <div
                              className={`relative w-full block ${
                                isNetworkChanging ? 'pointer-events-none' : ''
                              }`}
                            >
                              {/* Gray overlay when network is switching */}
                              {isNetworkChanging && (
                                <div className="absolute inset-0 bg-gray-500/30 z-20 rounded-lg backdrop-blur-[0.5px]" />
                              )}

                              {Object.values(networks.syscoin).map(
                                (currentNetwork: INetwork) => (
                                  <li
                                    key={`${currentNetwork.chainId}-${currentNetwork.url}`}
                                    className="group relative py-1.5 px-5 mx-4 w-auto max-w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                                  font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform
                                   transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 overflow-hidden"
                                    onClick={() => {
                                      handleChangeNetwork(
                                        currentNetwork,
                                        menuprops.close
                                      );
                                    }}
                                  >
                                    {/* Background glow effect on hover */}
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                                    {/* Left side: Icon + Network name */}
                                    <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
                                      <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                                        <ChainIcon
                                          chainId={currentNetwork.chainId}
                                          size={18}
                                          networkKind={INetworkType.Syscoin}
                                          className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
                                        />
                                      </div>
                                      <span className="text-left group-hover:text-white transition-colors duration-300 truncate">
                                        {currentNetwork.label}
                                      </span>
                                    </div>

                                    {/* Right side: Checkmark or Spinner */}
                                    <div className="flex items-center flex-shrink-0 relative z-10 mr-2">
                                      {isNetworkChanging &&
                                      activeNetworkValidator(currentNetwork) ? (
                                        <div className="transform group-hover:scale-110 transition-transform duration-300">
                                          <LoadingSvg className="w-4 animate-spin h-4 text-brand-graylight" />
                                        </div>
                                      ) : (
                                        isBitcoinBased &&
                                        activeNetworkValidator(
                                          currentNetwork
                                        ) && (
                                          <div className="transform group-hover:scale-110 transition-transform duration-300">
                                            <Icon
                                              name="check"
                                              className="w-4 h-4"
                                              color="#8EC100"
                                            />
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </li>
                                )
                              )}
                            </div>
                          </Disclosure.Panel>
                        </>
                      )}
                    </Disclosure>
                  </>
                </Menu.Item>

                <Menu.Item>
                  <Disclosure>
                    {({ open }) => (
                      <>
                        <Disclosure.Button className="flex items-center justify-start px-5 pt-3 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200">
                          <EthIconSvg />

                          <span className="px-3 text-sm">
                            {t('networkMenu.evmNetworks')}
                          </span>

                          <DropdownArrowSvg
                            isOpen={open}
                            className="ml-auto"
                            id="network-settings-btn"
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel className="h-max pb-2 pt-4 text-sm">
                          <div
                            className={`relative w-full block ${
                              isNetworkChanging ? 'pointer-events-none' : ''
                            }`}
                          >
                            {/* Gray overlay when network is switching */}
                            {isNetworkChanging && (
                              <div className="absolute inset-0 bg-gray-500/30 z-20 rounded-lg backdrop-blur-[0.5px]" />
                            )}

                            {Object.values(networks.ethereum)
                              .sort(customSort)
                              .map((currentNetwork: any) => (
                                <li
                                  key={`${currentNetwork.chainId}-${currentNetwork.url}`}
                                  className="group relative py-1.5 px-5 mx-4 w-auto max-w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                                  font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform
                                   transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 overflow-hidden"
                                  onClick={() => {
                                    handleChangeNetwork(
                                      currentNetwork,
                                      menuprops.close
                                    );
                                  }}
                                >
                                  {/* Background glow effect on hover */}
                                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                                  {/* Left side: Icon + Network name */}
                                  <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
                                    <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                                      <ChainIcon
                                        chainId={currentNetwork.chainId}
                                        size={18}
                                        networkKind={INetworkType.Ethereum}
                                        className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
                                      />
                                    </div>
                                    <span className="text-left group-hover:text-white transition-colors duration-300 truncate">
                                      {currentNetwork.label}
                                    </span>
                                  </div>

                                  {/* Right side: Checkmark or Spinner */}
                                  <div className="flex items-center flex-shrink-0 relative z-10 mr-2">
                                    {isNetworkChanging &&
                                    activeNetworkValidator(currentNetwork) ? (
                                      <div className="transform group-hover:scale-110 transition-transform duration-300">
                                        <LoadingSvg className="w-4 animate-spin h-4 text-brand-graylight" />
                                      </div>
                                    ) : (
                                      !isBitcoinBased &&
                                      activeNetworkValidator(
                                        currentNetwork
                                      ) && (
                                        <div className="transform group-hover:scale-110 transition-transform duration-300">
                                          <Icon
                                            name="check"
                                            className="w-4 h-4"
                                            color="#8EC100"
                                          />
                                        </div>
                                      )
                                    )}
                                  </div>
                                </li>
                              ))}
                          </div>
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </Menu.Item>

                <span className="disabled text-xs flex justify-start px-5 py-3 mt-6">
                  {t('networkMenu.networkSettings')}
                </span>

                <Menu.Item>
                  <li
                    onClick={handleCustomRpcNavigation}
                    className="flex px-5 py-2 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200"
                  >
                    <NetworkIconSvg />

                    <span className="px-3 text-sm">
                      {t('networkMenu.customRpc')}
                    </span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={handleManageNetworksNavigation}
                    className="flex px-5 py-2 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200"
                  >
                    <EditIconSvg />

                    <span className="px-3 text-sm">
                      {t('networkMenu.manageNetworks')}
                    </span>
                  </li>
                </Menu.Item>
              </div>
            </Menu.Items>
          )}
        </>
      )}
    </Menu>
  );
};
