import { Disclosure, Menu } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { ChainIcon } from 'components/ChainIcon';
import {
  DropdownArrowSvg,
  BtcIconSvg,
  EthIconSvg,
  WhiteSuccessIconSvg,
  NetworkIconSvg,
  EditIconSvg,
} from 'components/Icon/Icon';
import { Icon } from 'components/index';
import Spinner from 'components/Spinner/Spinner';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import store, { RootState } from 'state/store';
import { startSwitchNetwork, switchNetworkError } from 'state/vault';
import { INetworkWithKind } from 'state/vault/types';
import { NetworkType } from 'utils/types';

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
  setActiveAccountModalIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedNetwork: React.Dispatch<
    React.SetStateAction<{ chain: string; network: INetworkWithKind }>
  >;
}

const customSort = (a: INetworkWithKind, b: INetworkWithKind) => {
  const order = { 570: 2, 57: 1 };

  return (order[b.chainId] || 0) - (order[a.chainId] || 0);
};

export const NetworkMenu: React.FC<INetworkComponent> = (
  props: INetworkComponent
) => {
  const { setActiveAccountModalIsOpen, setSelectedNetwork } = props;
  const { controllerEmitter } = useController();
  const { t, i18n } = useTranslation();
  const { language } = i18n;
  const { dapps } = useSelector((state: RootState) => state.dapp);

  const networks = useSelector((state: RootState) => state.vault.networks);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const {
    activeAccount: { type: activeAccountType },
    networkStatus,
  } = useSelector((state: RootState) => state.vault);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const activeAccount = useSelector(
    (state: RootState) =>
      state.vault.accounts[state.vault.activeAccount.type][
        state.vault.activeAccount.id
      ]
  );

  const isNetworkChanging = networkStatus === 'switching';
  const networkType = isBitcoinBased ? NetworkType.UTXO : NetworkType.EVM;

  const bgColor =
    networkType === NetworkType.UTXO ? 'bg-brand-pink' : 'bg-brand-blue';

  const activeNetworkValidator = (currentNetwork: INetworkWithKind): boolean =>
    Boolean(
      activeNetwork.chainId === currentNetwork.chainId &&
        activeNetwork.url === currentNetwork.url &&
        activeNetwork.label === currentNetwork.label
    );

  const { navigate } = useUtils();

  const handleChangeNetwork = async (
    network: INetworkWithKind,
    chain: string,
    closeMenu?: () => void
  ) => {
    setSelectedNetwork({ network, chain });

    // Check if user is trying to switch to the same network that's already active
    if (activeNetworkValidator(network)) {
      // Already on this network, no need to switch
      return;
    }

    const cannotContinueWithTrezorAccount =
      // verify if user are on bitcoinBased network and if current account is Trezor-based or Ledger-based
      (isBitcoinBased && activeAccountType === KeyringAccountType.Trezor) ||
      (isBitcoinBased && activeAccountType === KeyringAccountType.Ledger) ||
      // or if user are in EVM network, using a trezor account, trying to change to UTXO network.
      (Object.keys(networks.ethereum).find(
        (chainId) => `${activeNetwork.chainId}` === chainId
      ) &&
        Object.keys(networks.syscoin).find(
          (chainId) => `${network.chainId}` === chainId
        ) &&
        `${network.slip44}` !== 'undefined' &&
        (activeAccountType === KeyringAccountType.Trezor ||
          activeAccountType === KeyringAccountType.Ledger));

    try {
      if (cannotContinueWithTrezorAccount) {
        setActiveAccountModalIsOpen(true);
        return;
      }

      // Optimistic update: dispatch the network switch action immediately
      store.dispatch(startSwitchNetwork(network));

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
          // On error, revert the optimistic update
          store.dispatch(switchNetworkError());
        });
    } catch (networkError) {}
  };

  const hasConnectedDapps = Object.values(dapps).length > 0;

  const connectedWebsiteTitle = hasConnectedDapps
    ? t('networkMenu.viewConnected')
    : t('networkMenu.noConnected');

  const currentBgColor = hasConnectedDapps ? 'bg-brand-green' : 'bg-brand-red';

  const currentBdgColor = hasConnectedDapps
    ? 'border-warning-success'
    : 'border-warning-error';
  return (
    <Menu
      as="div"
      className="absolute z-[9999] w-full left-4 inline-block mr-8 text-left"
    >
      {(menuprops) => (
        <>
          <Menu.Button className="group relative inline-flex gap-x-2 items-center justify-start ml-2 w-max text-white text-sm font-medium hover:bg-gradient-to-r hover:from-brand-blue600/20 hover:to-brand-blue500/20 hover:backdrop-blur-sm rounded-lg px-2 py-1.5 focus:outline-none cursor-pointer transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/10 active:scale-[0.98]">
            {/* Background glow effect on hover */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

            <div className="relative z-10 transform group-hover:scale-110 transition-transform duration-300 ease-out">
              <ChainIcon
                chainId={activeNetwork.chainId}
                size={20}
                networkKind={isBitcoinBased ? 'utxo' : 'evm'}
                className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
              />
            </div>
            <span className="relative z-10 font-light group-hover:font-medium group-hover:text-white transition-all duration-300">
              {activeNetwork.label}
            </span>
            <span
              className={`relative z-10 px-[6px] py-[2px] text-xs font-medium text-white rounded-full ${bgColor} group-hover:shadow-md transform group-hover:scale-105 transition-all duration-300`}
            >
              {networkType}
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

          <Menu.Items
            as="div"
            className={`absolute overflow-scroll z-50 top-[10px] left-[-17px] pb-16 pt-5 w-screen min-h-screen max-h-full text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl ring-1 ring-black ring-opacity-5
            transform transition-all duration-100 ease-out ${
              menuprops.open
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-95 pointer-events-none'
            }`}
            static
          >
            <Menu.Item>
              <li
                onClick={() =>
                  navigate('/settings/networks/connected-sites', {
                    state: { fromMenu: true },
                  })
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

            <Menu.Item>
              <li
                onClick={() =>
                  navigate('/settings/networks/trusted-sites', {
                    state: { fromMenu: true },
                  })
                }
                className="flex items-center justify-start mb-4 mx-3 px-2 py-1 text-base bg-brand-blue200 hover:bg-opacity-70 border border-solid border-brand-royalblue rounded-full cursor-pointer transition-all duration-200"
              >
                <WhiteSuccessIconSvg />

                <span className="px-3 text-base">
                  {t('networkMenu.trustedSites')}
                </span>
              </li>
            </Menu.Item>
            {isBitcoinBased || !activeAccount.isImported ? (
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
                            className="left-[12rem]"
                            id="network-settings-btn"
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm">
                          {Object.values(networks.syscoin).map(
                            (currentNetwork: INetworkWithKind) => (
                              <li
                                key={uniqueId()}
                                className="group relative ml-4 py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                                font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform
                                 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20"
                                onClick={() => {
                                  handleChangeNetwork(
                                    currentNetwork,
                                    'syscoin',
                                    menuprops.close
                                  );
                                }}
                              >
                                {/* Background glow effect on hover */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                                {/* Left side: Icon + Network name */}
                                <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10 ml-4">
                                  <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                                    <ChainIcon
                                      chainId={currentNetwork.chainId}
                                      size={18}
                                      networkKind="utxo"
                                      className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
                                    />
                                  </div>
                                  <span className="text-left group-hover:text-white transition-colors duration-300 truncate">
                                    {currentNetwork.label}
                                  </span>
                                </div>

                                {/* Right side: Checkmark */}
                                <div className="flex items-center flex-shrink-0 relative z-10">
                                  {isBitcoinBased &&
                                    activeNetworkValidator(currentNetwork) && (
                                      <div className="transform group-hover:scale-110 transition-transform duration-300">
                                        <Icon
                                          name="check"
                                          className="w-4 h-4"
                                          color="#8EC100"
                                        />
                                      </div>
                                    )}
                                </div>
                              </li>
                            )
                          )}
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </>
              </Menu.Item>
            ) : null}

            {activeAccount.isImported && isBitcoinBased ? null : (
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
                          className="left-[12rem]"
                          id="network-settings-btn"
                        />
                      </Disclosure.Button>

                      <Disclosure.Panel className="h-max pb-2 pt-4 text-sm">
                        {Object.values(networks.ethereum)
                          .sort(customSort)
                          .map((currentNetwork: any) => (
                            <li
                              key={uniqueId()}
                              className="group relative ml-4 py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                                font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform
                                 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20"
                              onClick={() => {
                                handleChangeNetwork(
                                  currentNetwork,
                                  'ethereum',
                                  menuprops.close
                                );
                              }}
                            >
                              {/* Background glow effect on hover */}
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                              {/* Left side: Icon + Network name */}
                              <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10 ml-4">
                                <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                                  <ChainIcon
                                    chainId={currentNetwork.chainId}
                                    size={18}
                                    networkKind="evm"
                                    className="flex-shrink-0 group-hover:brightness-110 transition-all duration-300"
                                  />
                                </div>
                                <span className="text-left group-hover:text-white transition-colors duration-300 truncate">
                                  {currentNetwork.label}
                                </span>
                              </div>

                              {/* Right side: Checkmark */}
                              <div className="flex items-center flex-shrink-0 relative z-10">
                                {!isBitcoinBased &&
                                  activeNetworkValidator(currentNetwork) && (
                                    <div className="transform group-hover:scale-110 transition-transform duration-300">
                                      <Icon
                                        name="check"
                                        className="w-4 h-4"
                                        color="#8EC100"
                                      />
                                    </div>
                                  )}
                              </div>
                            </li>
                          ))}
                      </Disclosure.Panel>
                    </>
                  )}
                </Disclosure>
              </Menu.Item>
            )}

            <span className="disabled text-xs flex justify-start px-5 py-3 mt-6">
              {t('networkMenu.networkSettings')}
            </span>

            <Menu.Item>
              <li
                onClick={() =>
                  navigate('/settings/networks/custom-rpc', {
                    state: { fromMenu: true },
                  })
                }
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
                onClick={() => navigate('/settings/networks/edit')}
                className="flex px-5 py-2 w-full text-base hover:bg-brand-blue500 hover:bg-opacity-20 cursor-pointer transition-all duration-200"
              >
                <EditIconSvg />

                <span className="px-3 text-sm">
                  {t('networkMenu.manageNetworks')}
                </span>
              </li>
            </Menu.Item>
          </Menu.Items>
        </>
      )}
    </Menu>
  );
};
