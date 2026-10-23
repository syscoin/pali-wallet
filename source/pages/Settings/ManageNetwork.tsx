import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { ChainIcon } from 'components/ChainIcon';
import {
  Button,
  ConfirmationModal,
  Icon,
  IconButton,
  Tooltip,
} from 'components/index';
import { getControllerStatus } from 'hooks/controllerStatus';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { usePageLoadingState } from 'hooks/usePageLoadingState';
import store, { RootState } from 'state/store';
import { INetworkType, INetwork } from 'types/network';
import { truncate } from 'utils/index';
import {
  createBrowsingNavigationContext,
  navigateBack,
  navigateWithContext,
} from 'utils/navigationState';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';

const ManageNetworkView = () => {
  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { t } = useTranslation();
  const location = useLocation();
  const chainIdentity = (chain: INetworkType, chainId: number) =>
    `${chain === INetworkType.Syscoin ? 'UTXO' : 'EVM'} · ${t(
      'settings.chainNumber',
      { chainId }
    )}`;
  const networkIdentity = (
    chain: INetworkType,
    network: { chainId: number; label: string }
  ) =>
    `${network.label || t('settings.unknownNetwork')} (${chainIdentity(
      chain,
      network.chainId
    )})`;

  const { navigate, alert } = useUtils();
  const { controllerEmitter, connectionUnavailable } = useController();
  const { isContextChanging } = usePageLoadingState();
  const networkActionsBlocked = isContextChanging || connectionUnavailable;
  const isActiveNetwork = (network: INetwork) =>
    network.kind === activeNetwork.kind &&
    network.chainId === activeNetwork.chainId &&
    network.url === activeNetwork.url;
  const isNetworkActionBlocked = () => {
    const { networkStatus, isSwitchingAccount } = store.getState().vaultGlobal;
    return (
      networkActionsBlocked ||
      getControllerStatus().connectionUnavailable ||
      networkStatus === 'switching' ||
      networkStatus === 'connecting' ||
      isSwitchingAccount
    );
  };

  // Ref for the scrollable ul element
  const scrollContainerRef = useRef<HTMLUListElement>(null);

  // State for confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [networkToRemove, setNetworkToRemove] = useState<{
    chain: INetworkType;
    chainId: number;
    expectedRegistration: string;
    key?: string;
    label: string;
    rpcUrl: string;
  } | null>(null);

  useEffect(() => {
    if (networkActionsBlocked) {
      setShowConfirmModal(false);
      setNetworkToRemove(null);
    }
  }, [networkActionsBlocked]);

  // Track if we've already restored scroll position to prevent duplicate restoration
  const hasRestoredScrollRef = useRef(false);

  // Custom scroll restoration for the ul element
  useEffect(() => {
    if (
      location.state?.manageNetworksScrollTop !== undefined &&
      !hasRestoredScrollRef.current
    ) {
      // Small delay to ensure the component has rendered before scrolling
      if (scrollContainerRef.current) {
        hasRestoredScrollRef.current = true;
        scrollContainerRef.current.scrollTop =
          location.state.manageNetworksScrollTop;
      }
    }
  }, [location.state]);

  const removeNetwork = (chain: INetworkType, network: INetwork) => {
    if (isNetworkActionBlocked()) return;
    // Bind confirmation to the exact registration displayed by this row.
    const { chainId, url: rpcUrl, label, key } = network;
    setNetworkToRemove({
      chain,
      chainId,
      rpcUrl,
      label,
      key,
      expectedRegistration: networkRegistrationFingerprint(network)!,
    });
    setShowConfirmModal(true);
  };

  const handleConfirmRemoval = async () => {
    if (!networkToRemove) return;
    if (isNetworkActionBlocked()) {
      handleCancelRemoval();
      return;
    }

    // Close modal first
    setShowConfirmModal(false);

    try {
      await controllerEmitter(
        ['wallet', 'removeKeyringNetwork'],
        [
          networkToRemove.chain,
          networkToRemove.chainId,
          networkToRemove.rpcUrl,
          networkToRemove.label,
          networkToRemove.expectedRegistration,
          networkToRemove.key,
        ]
      );
    } catch {
      alert.error(t('settings.networkRemovalIncomplete'));
    } finally {
      // A later selection must not be cleared by this request finishing.
      setNetworkToRemove((current) =>
        current === networkToRemove ? null : current
      );
    }
  };

  const handleCancelRemoval = () => {
    setShowConfirmModal(false);
    setNetworkToRemove(null);
  };

  const editNetwork = ({
    selected,
    chain,
    isDefault,
  }: {
    chain: INetworkType;
    isDefault: boolean;
    selected: INetwork;
  }) => {
    if (isNetworkActionBlocked()) return;
    // Create navigation context with scroll position from the ul element
    const scrollPosition = scrollContainerRef.current?.scrollTop || 0;

    const returnContext = createBrowsingNavigationContext(location, {
      manageNetworksScrollTop: scrollPosition,
    });

    navigateWithContext(
      navigate,
      '/settings/networks/custom-rpc',
      {
        selected: {
          chainId: selected.chainId,
          key: selected.key,
          kind: selected.kind,
        },
        chain,
        isDefault,
        isEditing: true,
      },
      returnContext
    );
  };

  return (
    <>
      <ul
        data-navigation-scroll="settings-manage-networks"
        ref={scrollContainerRef}
        className="mb-4 w-full h-85 text-sm overflow-auto md:h-96 remove-scrollbar"
      >
        <p className="pb-3 pt-1 text-center tracking-[0.2rem] text-brand-white  text-xs font-semibold bg-transparent border-b-2 border-brand-pink200">
          UTXO
        </p>
        {Object.values(networks.syscoin).map((network: INetwork) => (
          <li
            key={
              network.key
                ? network.key
                : `${(network.label || 'unknown').trim()}-${network.chainId}`
            }
            className={`my-3 py-1 w-full flex gap-x-3 justify-between items-center transition-all duration-300 border-b border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex min-w-0 flex-1 gap-x-3 items-center justify-start text-xs">
              <ChainIcon
                chainId={network.chainId}
                size={24}
                networkKind={INetworkType.Syscoin}
                className="flex-shrink-0"
              />
              <div className="flex min-w-0 flex-col items-start">
                <span
                  className="max-w-full truncate"
                  title={networkIdentity(INetworkType.Syscoin, network)}
                >
                  {truncate(network.label || t('settings.unknownNetwork'), 25)}
                </span>
                <span className="mt-1 text-content-muted">
                  {chainIdentity(INetworkType.Syscoin, network.chainId)}
                </span>
                {isActiveNetwork(network) && (
                  <div className="flex items-center gap-1 mt-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-xs text-green-400">
                      {t('components.activeStatus')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-x-3 items-center justify-between">
              <IconButton
                aria-label={`${t('buttons.edit')}: ${networkIdentity(
                  INetworkType.Syscoin,
                  network
                )}`}
                onClick={() =>
                  editNetwork({
                    selected: network,
                    chain: INetworkType.Syscoin,
                    isDefault: network.default,
                  })
                }
                type="primary"
                shape="circle"
              >
                <Icon
                  name="edit"
                  className="hover:text-brand-royalblue text-xl"
                />
              </IconButton>
              {!network.default && (
                <Tooltip
                  content={
                    isActiveNetwork(network)
                      ? t('settings.youCannotRemoveActiveNetwork')
                      : ''
                  }
                >
                  <IconButton
                    aria-label={`${t('buttons.remove')}: ${networkIdentity(
                      INetworkType.Syscoin,
                      network
                    )}`}
                    onClick={() => removeNetwork(INetworkType.Syscoin, network)}
                    type="primary"
                    shape="circle"
                    disabled={isActiveNetwork(network)}
                  >
                    <Icon
                      name="trash"
                      disabled={isActiveNetwork(network)}
                      className={
                        isActiveNetwork(network)
                          ? 'text-xl'
                          : 'hover:text-brand-royalblue text-xl'
                      }
                    />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          </li>
        ))}

        <p className="py-3 text-center tracking-[0.2rem] text-brand-white  text-xs font-semibold bg-transparent border-b-2 border-brand-blue200">
          EVM
        </p>
        {Object.values(networks.ethereum).map((network: any) => (
          <li
            key={
              network.key
                ? network.key
                : `${(network.label || 'unknown').trim()}-${network.chainId}`
            }
            className={`my-3 py-1 w-full flex gap-x-3 justify-between items-center transition-all duration-300 border-b border-dashed border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex min-w-0 flex-1 gap-x-3 items-center justify-start text-xs">
              <ChainIcon
                chainId={network.chainId}
                size={24}
                networkKind={INetworkType.Ethereum}
                className="flex-shrink-0"
              />
              <div className="flex min-w-0 flex-col items-start">
                <span
                  className="max-w-full truncate"
                  title={networkIdentity(INetworkType.Ethereum, network)}
                >
                  {truncate(network.label || t('settings.unknownNetwork'), 25)}
                </span>
                <span className="mt-1 text-content-muted">
                  {chainIdentity(INetworkType.Ethereum, network.chainId)}
                </span>
                {isActiveNetwork(network) && (
                  <div className="flex items-center gap-1 mt-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-xs text-green-400">
                      {t('components.activeStatus')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-x-3 items-center justify-between">
              <IconButton
                aria-label={`${t('buttons.edit')}: ${networkIdentity(
                  INetworkType.Ethereum,
                  network
                )}`}
                onClick={() =>
                  editNetwork({
                    selected: network,
                    chain: INetworkType.Ethereum,
                    isDefault: network.default,
                  })
                }
                type="primary"
                shape="circle"
              >
                <Icon
                  name="edit"
                  className="hover:text-brand-royalblue text-xl"
                />
              </IconButton>

              {!network.default && (
                <Tooltip
                  content={
                    isActiveNetwork(network)
                      ? t('settings.youCannotRemoveActiveNetwork')
                      : ''
                  }
                >
                  <IconButton
                    aria-label={`${t('buttons.remove')}: ${networkIdentity(
                      INetworkType.Ethereum,
                      network
                    )}`}
                    onClick={() =>
                      removeNetwork(INetworkType.Ethereum, network)
                    }
                    type="primary"
                    shape="circle"
                    disabled={isActiveNetwork(network)}
                  >
                    <Icon
                      name="trash"
                      disabled={isActiveNetwork(network)}
                      className={
                        isActiveNetwork(network)
                          ? 'text-xl'
                          : 'hover:text-brand-royalblue text-xl'
                      }
                    />
                  </IconButton>
                </Tooltip>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="w-full px-2 md:static">
        <Button
          variant="neutral"
          className="text-sm text-brand-royalblue"
          type="button"
          onClick={() => navigateBack(navigate, location)}
          fullWidth={true}
        >
          {t('buttons.close')}
        </Button>{' '}
      </div>

      <ConfirmationModal
        show={showConfirmModal && !networkActionsBlocked}
        title={t('settings.confirmRemoveNetwork', {
          networkName: networkToRemove
            ? networkIdentity(networkToRemove.chain, networkToRemove)
            : '',
        })}
        description={
          networkToRemove
            ? chainIdentity(networkToRemove.chain, networkToRemove.chainId)
            : ''
        }
        buttonText={t('buttons.remove')}
        onClose={handleCancelRemoval}
        onClick={handleConfirmRemoval}
      />
    </>
  );
};

export default ManageNetworkView;
