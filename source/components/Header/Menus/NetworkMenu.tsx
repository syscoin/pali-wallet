import { Menu } from '@headlessui/react';
import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

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
import { INetwork, INetworkType } from 'types/network';
import {
  createBrowsingNavigationContext,
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

interface INetworkComponent {
  disabled?: boolean;
}

const customSort = (a: INetwork, b: INetwork) => {
  const order = { 570: 2, 57: 1 };
  return (order[b.chainId] || 0) - (order[a.chainId] || 0);
};

const networkConfigurationFields: Array<keyof INetwork> = [
  'kind',
  'chainId',
  'slip44',
  'url',
  'apiUrl',
  'explorer',
  'label',
  'currency',
  'coingeckoId',
  'coingeckoPlatformId',
];

export const NetworkMenu: React.FC<INetworkComponent> = (
  props: INetworkComponent
) => {
  const location = useLocation();
  const { disabled = false } = props;
  const { controllerEmitter } = useController();
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  const { navigate } = useUtils();
  const groupId = useId();
  const [openNetworkGroups, setOpenNetworkGroups] = useState({
    [INetworkType.Syscoin]: false,
    [INetworkType.Ethereum]: false,
  });
  const typeaheadInProgress = useRef(false);
  const typeaheadTimeout = useRef<ReturnType<typeof setTimeout>>();
  const resetSearchOnOpen = useRef(false);
  const pointerPositions = useRef(new WeakMap<HTMLElement, [number, number]>());
  const resetTypeahead = useCallback(() => {
    clearTimeout(typeaheadTimeout.current);
    typeaheadInProgress.current = false;
  }, []);
  useEffect(() => resetTypeahead, [resetTypeahead]);

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
  const refreshEnabled = useSelector((state: RootState) =>
    Boolean(state.vaultGlobal.advancedSettings?.refresh)
  );

  const dapps = useSelector((state: RootState) => state.dapp.dapps);

  const isNetworkChanging = networkStatus === 'switching';
  const networkType = isBitcoinBased
    ? INetworkType.Syscoin
    : INetworkType.Ethereum;
  const networkDisplayType = isBitcoinBased ? 'UTXO' : 'EVM';
  const bgColor =
    networkType === INetworkType.Syscoin ? 'bg-brand-pink' : 'bg-brand-blue';

  // ✅ MEMOIZED: Network validation function
  const activeNetworkValidator = useCallback(
    (currentNetwork: INetwork): boolean =>
      networkConfigurationFields.every(
        (field) =>
          (activeNetwork[field] ?? '') === (currentNetwork[field] ?? '')
      ),
    [activeNetwork]
  );

  const hasConnectedDapps = Object.values(dapps).length > 0;
  const connectedWebsiteTitle = hasConnectedDapps
    ? t('networkMenu.viewConnected')
    : t('networkMenu.noConnected');
  const currentBgColor = hasConnectedDapps ? 'bg-brand-green' : 'bg-brand-red';
  const currentBdgColor = hasConnectedDapps
    ? 'border-warning-success'
    : 'border-warning-error';

  // ✅ MEMOIZED: Network change handler
  const handleChangeNetwork = useCallback(
    (network: INetwork, closeMenu?: () => void) => {
      if (disabled || isNetworkChanging) return;
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
          .catch((error) => {
            console.error('[NetworkMenu] Network switch failed:', error);
            store.dispatch(switchNetworkError());
          });
      } catch (networkError) {
        // Log any synchronous errors from controllerEmitter
        console.error(
          '[NetworkMenu] Error initiating network switch:',
          networkError
        );
        store.dispatch(switchNetworkError());
      }
    },
    [activeNetworkValidator, disabled, isNetworkChanging]
  );

  // ✅ MEMOIZED: Navigation handlers
  const handleSettingsNavigation = useCallback(
    (pathname: string, state = {}) => {
      const returnContext = createBrowsingNavigationContext(location);

      navigateWithContext(navigate, pathname, state, returnContext);
    },
    [navigate, location]
  );

  const handleGroupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Headless UI 1.x accumulates printable keys for 350ms. Let it consume
    // spaces within that query; only a standalone Space activates a group.
    clearTimeout(typeaheadTimeout.current);
    if (
      [
        'ArrowDown',
        'ArrowUp',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Escape',
        'Tab',
      ].includes(event.key)
    ) {
      typeaheadInProgress.current = false;
      return;
    }
    if (
      event.key.length === 1 &&
      (event.key !== ' ' || typeaheadInProgress.current)
    ) {
      typeaheadInProgress.current = true;
      // Native Space appends to an existing query without arming a timeout.
      if (event.key !== ' ') {
        typeaheadTimeout.current = setTimeout(() => {
          typeaheadInProgress.current = false;
        }, 350);
      }
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    resetTypeahead();
    const activeItem = event.currentTarget.ownerDocument.getElementById(
      event.currentTarget.getAttribute('aria-activedescendant') || ''
    );
    if (
      !activeItem?.hasAttribute('data-network-group-toggle') ||
      !event.currentTarget.contains(activeItem)
    )
      return;

    // Menu keeps DOM focus on its root and normally closes before clicking
    // the active item. Group toggles expand in place; choices still use the
    // standard Menu keyboard activation and dismissal behavior.
    event.preventDefault();
    event.stopPropagation();
    activeItem.click();
  };

  type ItemPointerEvent =
    | React.PointerEvent<HTMLElement>
    | React.MouseEvent<HTMLElement>;
  const rememberItemPointer = (event: ItemPointerEvent) => {
    pointerPositions.current.set(event.currentTarget, [
      event.screenX,
      event.screenY,
    ]);
  };
  const resetPointerTypeahead = (event: ItemPointerEvent, leaving: boolean) => {
    const item = event.currentTarget;
    const previous = pointerPositions.current.get(item) || [-1, -1];
    rememberItemPointer(event);
    if (previous[0] === event.screenX && previous[1] === event.screenY) return;
    if (item.getAttribute('aria-disabled') === 'true') return;
    const activeId = item
      .closest('[role="menu"]')
      ?.getAttribute('aria-activedescendant');
    // Match Menu.Item's tracked-pointer behavior: only a real active-item
    // change (or leaving the active item) clears the native search query.
    if (leaving ? activeId === item.id : activeId !== item.id) resetTypeahead();
  };
  const itemPointerHandlers = {
    onPointerEnter: rememberItemPointer,
    onMouseEnter: rememberItemPointer,
    onPointerMove: (event: React.PointerEvent<HTMLElement>) =>
      resetPointerTypeahead(event, false),
    onMouseMove: (event: React.MouseEvent<HTMLElement>) =>
      resetPointerTypeahead(event, false),
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) =>
      resetPointerTypeahead(event, true),
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) =>
      resetPointerTypeahead(event, true),
  };

  const renderNetworkChoice = (
    currentNetwork: INetwork,
    kind: INetworkType,
    closeMenu: () => void
  ) => {
    const isCurrent = activeNetworkValidator(currentNetwork);
    return (
      <div
        key={`${currentNetwork.chainId}-${currentNetwork.url}`}
        className="mx-4"
        role="none"
      >
        <Menu.Item disabled={isNetworkChanging} {...itemPointerHandlers}>
          {({ active }) => (
            <button
              type="button"
              disabled={isNetworkChanging}
              aria-label={currentNetwork.label}
              aria-current={
                isCurrent && networkType === kind ? 'true' : undefined
              }
              className={`group relative py-1.5 px-5 w-full max-w-full backface-visibility-hidden flex items-center justify-between text-white text-sm font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 overflow-hidden disabled:cursor-wait ${
                active ? 'bg-brand-blue500/30' : ''
              }`}
              onClick={() => {
                void handleChangeNetwork(currentNetwork, closeMenu);
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg" />

              <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
                <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                  <ChainIcon
                    chainId={currentNetwork.chainId}
                    size={18}
                    networkKind={kind}
                    className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
                  />
                </div>
                <span className="text-left group-hover:text-white transition-colors duration-300 truncate">
                  {currentNetwork.label}
                </span>
              </div>

              <div className="flex items-center flex-shrink-0 relative z-10 mr-2">
                {isNetworkChanging && isCurrent ? (
                  <div className="transform group-hover:scale-110 transition-transform duration-300">
                    <LoadingSvg className="w-4 animate-spin h-4 text-brand-graylight" />
                  </div>
                ) : (
                  isCurrent &&
                  networkType === kind && (
                    <div className="transform group-hover:scale-110 transition-transform duration-300">
                      <Icon name="check" className="w-4 h-4" color="#8EC100" />
                    </div>
                  )
                )}
              </div>
            </button>
          )}
        </Menu.Item>
      </div>
    );
  };

  const renderNetworkGroup = (kind: INetworkType, closeMenu: () => void) => {
    const isUtxo = kind === INetworkType.Syscoin;
    const open = openNetworkGroups[kind];
    const label = t(
      isUtxo ? 'networkMenu.utxoNetworks' : 'networkMenu.evmNetworks'
    );
    const panelId = `${groupId}-${kind}`;
    const choices = Object.values(networks[kind]) as INetwork[];
    if (!isUtxo) choices.sort(customSort);

    return (
      <React.Fragment key={kind}>
        <Menu.Item {...itemPointerHandlers}>
          {({ active }) => (
            <button
              type="button"
              data-network-group-toggle
              aria-label={label}
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={(event) => {
                // Prevent Menu.Item's pointer handler from dismissing this
                // menu; keyboard group activation is handled above as well.
                event.preventDefault();
                resetTypeahead();
                setOpenNetworkGroups((groups) => ({
                  ...groups,
                  [kind]: !groups[kind],
                }));
                // The native Menu.Item focus handler clears its search query
                // too, including when keyboard activation called .click().
                event.currentTarget.focus({ preventScroll: true });
                event.currentTarget
                  .closest<HTMLElement>('[role="menu"]')
                  ?.focus({ preventScroll: true });
              }}
              className={`flex items-center justify-start px-5 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200 ${
                isUtxo ? 'py-1' : 'pt-3'
              } ${active ? 'bg-brand-blue500/30' : ''}`}
            >
              {isUtxo ? <BtcIconSvg /> : <EthIconSvg />}
              <span className="px-3 text-sm">{label}</span>
              <DropdownArrowSvg isOpen={open} className="ml-auto" />
            </button>
          )}
        </Menu.Item>
        {open && (
          <div
            id={panelId}
            role="group"
            aria-label={label}
            className={`h-max pb-2 text-sm ${isUtxo ? 'pt-0.5' : 'pt-4'}`}
          >
            <div
              className={`relative w-full block ${
                isNetworkChanging ? 'pointer-events-none' : ''
              }`}
            >
              {isNetworkChanging && (
                <div className="absolute inset-0 bg-gray-500/30 z-20 rounded-lg backdrop-blur-[0.5px]" />
              )}
              {choices.map((network) =>
                renderNetworkChoice(network, kind, closeMenu)
              )}
            </div>
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <Menu
      as="div"
      className={`absolute z-[9999] left-4 inline-block text-left ${
        refreshEnabled ? 'right-36' : 'right-24'
      }`}
    >
      {(menuprops) => (
        <>
          <Menu.Button
            disabled={disabled}
            onClick={() => {
              resetSearchOnOpen.current = !menuprops.open;
            }}
            className={`group relative inline-flex gap-x-2 items-center justify-start ml-2 w-max max-w-full text-white text-sm font-medium rounded-lg px-2 py-1.5 focus:outline-none transition-all duration-300 ease-in-out ${
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-gradient-to-r hover:from-brand-blue600/20 hover:to-brand-blue500/20 hover:backdrop-blur-sm cursor-pointer hover:shadow-lg hover:shadow-brand-blue600/10 active:scale-[0.98]'
            }`}
          >
            {/* Background glow effect on hover */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

            <div className="relative z-10 flex-shrink-0 transform group-hover:scale-110 transition-transform duration-300 ease-out">
              <ChainIcon
                chainId={activeNetwork.chainId}
                size={20}
                networkKind={
                  isBitcoinBased ? INetworkType.Syscoin : INetworkType.Ethereum
                }
                className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
              />
            </div>
            <span
              title={activeNetwork.label}
              className="relative z-10 min-w-0 truncate font-light group-hover:font-medium group-hover:text-white transition-all duration-300"
            >
              {activeNetwork.label}
            </span>
            <span
              className={`relative z-10 flex-shrink-0 px-[6px] py-[2px] text-xs font-medium text-white rounded-full ${bgColor} group-hover:shadow-md transform group-hover:scale-105 transition-all duration-300`}
            >
              {networkDisplayType}
            </span>
            {isNetworkChanging && (
              <div className="relative z-10 flex-shrink-0">
                <Spinner size={16} color="#ffffff" />
              </div>
            )}

            <div className="relative z-10 flex-shrink-0 transform group-hover:scale-110 transition-transform duration-300">
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
              onKeyDownCapture={handleGroupKeyDown}
              onFocusCapture={(event) => {
                if (event.target !== event.currentTarget) {
                  resetTypeahead();
                  return;
                }
                if (!resetSearchOnOpen.current) return;
                resetSearchOnOpen.current = false;
                // Item focus clears Headless UI's retained typeahead query.
                const menu = event.currentTarget;
                menu
                  .querySelector<HTMLElement>(
                    '[role="menuitem"]:not([aria-disabled="true"])'
                  )
                  ?.focus({ preventScroll: true });
                menu.focus({ preventScroll: true });
              }}
              className={`fixed overflow-x-hidden z-50 inset-x-0 top-8 bottom-0 w-full text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl ring-1 ring-black ring-opacity-5
              transform transition-all duration-100 ease-out ${
                menuprops.open
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-95 pointer-events-none'
              }`}
              unmount={false}
            >
              <div className="remove-scrollbar h-full overflow-y-auto overscroll-contain pt-5 pb-6">
                <Menu.Item {...itemPointerHandlers}>
                  <li
                    onClick={() =>
                      handleSettingsNavigation(
                        '/settings/networks/connected-sites',
                        {
                          fromMenu: true,
                        }
                      )
                    }
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

                <Menu.Item {...itemPointerHandlers}>
                  <li
                    onClick={() =>
                      handleSettingsNavigation(
                        '/settings/networks/trusted-sites',
                        {
                          fromMenu: true,
                        }
                      )
                    }
                    className="flex items-center justify-start mb-4 mx-3 px-2 py-1 text-base bg-brand-blue200 hover:bg-opacity-70 border border-solid border-brand-royalblue rounded-full cursor-pointer transition-all duration-200"
                  >
                    <WhiteSuccessIconSvg />

                    <span className="px-3 text-base">
                      {t('networkMenu.trustedSites')}
                    </span>
                  </li>
                </Menu.Item>
                <span className="disabled text-xs flex justify-start px-5 py-4">
                  {t('networkMenu.networks')}
                </span>
                {renderNetworkGroup(INetworkType.Syscoin, menuprops.close)}
                {renderNetworkGroup(INetworkType.Ethereum, menuprops.close)}

                <span className="disabled text-xs flex justify-start px-5 py-3 mt-6">
                  {t('networkMenu.networkSettings')}
                </span>

                <Menu.Item {...itemPointerHandlers}>
                  <li
                    onClick={() =>
                      handleSettingsNavigation(
                        '/settings/networks/custom-rpc',
                        {
                          fromMenu: true,
                        }
                      )
                    }
                    className="flex px-5 py-2 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200"
                  >
                    <NetworkIconSvg />

                    <span className="px-3 text-sm">
                      {t('networkMenu.customRpc')}
                    </span>
                  </li>
                </Menu.Item>

                <Menu.Item {...itemPointerHandlers}>
                  <li
                    onClick={() =>
                      handleSettingsNavigation('/settings/networks/edit')
                    }
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
