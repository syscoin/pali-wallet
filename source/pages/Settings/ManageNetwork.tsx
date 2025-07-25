import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { INetworkType } from '@pollum-io/sysweb3-network';
import { INetwork } from '@pollum-io/sysweb3-network';

import { ChainIcon } from 'components/ChainIcon';
import {
  IconButton,
  Icon,
  NeutralButton,
  Tooltip,
  ConfirmationModal,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { truncate } from 'utils/index';
import { navigateWithContext } from 'utils/navigationState';
import { navigateBack } from 'utils/navigationState';

const ManageNetworkView = () => {
  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { t } = useTranslation();
  const location = useLocation();

  const { navigate } = useUtils();
  const { controllerEmitter } = useController();

  // Ref for the scrollable ul element
  const scrollContainerRef = useRef<HTMLUListElement>(null);

  // State for confirmation modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [networkToRemove, setNetworkToRemove] = useState<{
    chain: INetworkType;
    chainId: number;
    key?: string;
    label: string;
    rpcUrl: string;
  } | null>(null);

  // Track if we've already restored scroll position to prevent duplicate restoration
  const hasRestoredScrollRef = useRef(false);

  // Custom scroll restoration for the ul element
  useEffect(() => {
    if (
      location.state?.scrollPosition !== undefined &&
      !hasRestoredScrollRef.current
    ) {
      // Small delay to ensure the component has rendered before scrolling
      if (scrollContainerRef.current) {
        hasRestoredScrollRef.current = true;
        scrollContainerRef.current.scrollTop = location.state.scrollPosition;
      }
    }
  }, [location.state]);

  const removeNetwork = (
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) => {
    // Store network info and show confirmation modal
    setNetworkToRemove({ chain, chainId, rpcUrl, label, key });
    setShowConfirmModal(true);
  };

  const handleConfirmRemoval = async () => {
    if (!networkToRemove) return;

    // Close modal first
    setShowConfirmModal(false);

    // Proceed with removal
    await controllerEmitter(
      ['wallet', 'removeKeyringNetwork'],
      [
        networkToRemove.chain,
        networkToRemove.chainId,
        networkToRemove.rpcUrl,
        networkToRemove.label,
        networkToRemove.key,
      ]
    );

    // Clear state
    setNetworkToRemove(null);
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
    // Create navigation context with scroll position from the ul element
    const scrollPosition = scrollContainerRef.current?.scrollTop || 0;

    const returnContext = {
      returnRoute: '/settings/networks/edit',
      scrollPosition,
    };

    navigateWithContext(
      navigate,
      '/settings/networks/custom-rpc',
      { selected, chain, isDefault, isEditing: true },
      returnContext
    );
  };

  return (
    <>
      <ul
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
            className={`my-3 py-1 w-full flex justify-between items-center transition-all duration-300 border-b border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex gap-x-3 items-center justify-start text-xs">
              <ChainIcon
                chainId={network.chainId}
                size={24}
                networkKind={INetworkType.Syscoin}
                className="flex-shrink-0"
              />
              <div className="flex flex-col items-start">
                <span>{truncate(network.label || 'Unknown Network', 25)}</span>
                {network.chainId === activeNetwork.chainId &&
                  network.url === activeNetwork.url && (
                    <div className="flex items-center gap-1 mt-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-xs text-green-400">
                        {t('components.activeStatus')}
                      </span>
                    </div>
                  )}
              </div>
            </div>

            <div className="flex gap-x-3 items-center justify-between">
              <IconButton
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
                    network.chainId === activeNetwork.chainId &&
                    network.url === activeNetwork.url
                      ? t('settings.youCannotRemoveActiveNetwork')
                      : ''
                  }
                >
                  <IconButton
                    onClick={() =>
                      removeNetwork(
                        INetworkType.Syscoin,
                        network.chainId,
                        network.url,
                        network.label,
                        network?.key
                      )
                    }
                    type="primary"
                    shape="circle"
                    disabled={
                      network.chainId === activeNetwork.chainId &&
                      network.url === activeNetwork.url
                    }
                  >
                    <Icon
                      name="trash"
                      disabled={
                        network.chainId === activeNetwork.chainId &&
                        network.url === activeNetwork.url
                      }
                      className={
                        network.chainId === activeNetwork.chainId &&
                        network.url === activeNetwork.url
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
            className={`my-3 py-1 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex gap-x-3 items-center justify-start text-xs">
              <ChainIcon
                chainId={network.chainId}
                size={24}
                networkKind={INetworkType.Ethereum}
                className="flex-shrink-0"
              />
              <div className="flex flex-col items-start">
                <span>{truncate(network.label || 'Unknown Network', 25)}</span>
                {network.chainId === activeNetwork.chainId &&
                  network.url === activeNetwork.url && (
                    <div className="flex items-center gap-1 mt-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-xs text-green-400">
                        {t('components.activeStatus')}
                      </span>
                    </div>
                  )}
              </div>
            </div>

            <div className="flex gap-x-3 items-center justify-between">
              <IconButton
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
                    network.chainId === activeNetwork.chainId &&
                    network.url === activeNetwork.url
                      ? t('settings.youCannotRemoveActiveNetwork')
                      : ''
                  }
                >
                  <IconButton
                    onClick={() =>
                      removeNetwork(
                        INetworkType.Ethereum,
                        network.chainId,
                        network.url,
                        network.label,
                        network?.key
                      )
                    }
                    type="primary"
                    shape="circle"
                    disabled={
                      network.chainId === activeNetwork.chainId &&
                      network.url === activeNetwork.url
                    }
                  >
                    <Icon
                      name="trash"
                      disabled={
                        network.chainId === activeNetwork.chainId &&
                        network.url === activeNetwork.url
                      }
                      className={
                        network.chainId === activeNetwork.chainId &&
                        network.url === activeNetwork.url
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
        <NeutralButton
          type="button"
          onClick={() => navigateBack(navigate, location)}
          fullWidth={true}
        >
          {t('buttons.close')}
        </NeutralButton>{' '}
      </div>

      <ConfirmationModal
        show={showConfirmModal}
        title={t('settings.confirmRemoveNetwork', {
          networkName: networkToRemove?.label || '',
        })}
        description=""
        buttonText={t('buttons.remove')}
        onClose={handleCancelRemoval}
        onClick={handleConfirmRemoval}
      />
    </>
  );
};

export default ManageNetworkView;
