import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { INetworkType } from '@pollum-io/sysweb3-network';
import { INetwork } from '@pollum-io/sysweb3-network';

import { ChainIcon } from 'components/ChainIcon';
import { IconButton, Icon, NeutralButton, Tooltip } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { truncate } from 'utils/index';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

const ManageNetworkView = () => {
  const networks = useSelector(
    (state: RootState) => state.vaultGlobal.networks
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { t } = useTranslation();

  const { navigate } = useUtils();
  const { controllerEmitter } = useController();

  const removeNetwork = async (
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) =>
    controllerEmitter(
      ['wallet', 'removeKeyringNetwork'],
      [chain, chainId, rpcUrl, label, key]
    );

  const editNetwork = ({
    selected,
    chain,
    isDefault,
  }: {
    chain: INetworkType;
    isDefault: boolean;
    selected: INetwork;
  }) => {
    // Create navigation context to return to manage networks
    const returnContext = createNavigationContext('/settings/networks/edit');

    navigateWithContext(
      navigate,
      '/settings/networks/custom-rpc',
      { selected, chain, isDefault, isEditing: true },
      returnContext
    );
  };

  return (
    <>
      <ul className=" mb-4 w-full h-85 text-sm overflow-auto md:h-96">
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
                      <span className="text-xs text-green-400">Active</span>
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
                      <span className="text-xs text-green-400">Active</span>
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
          onClick={() => navigate('/home')}
          fullWidth={true}
        >
          {t('buttons.close')}
        </NeutralButton>{' '}
      </div>
    </>
  );
};

export default ManageNetworkView;
