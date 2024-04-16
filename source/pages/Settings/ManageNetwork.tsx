import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import {
  IconButton,
  Layout,
  Icon,
  NeutralButton,
  Tooltip,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate } from 'utils/index';

const ManageNetworkView = () => {
  const networks = useSelector((state: RootState) => state.vault.networks);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { t } = useTranslation();

  const { navigate } = useUtils();
  const { wallet } = getController();

  const removeNetwork = (
    chain: INetworkType,
    chainId: number,
    rpcUrl: string,
    label: string,
    key?: string
  ) => wallet.removeKeyringNetwork(chain, chainId, rpcUrl, label, key);

  const editNetwork = ({
    selected,
    chain,
    isDefault,
  }: {
    chain: INetworkType;
    isDefault: boolean;
    selected: INetwork;
  }) => {
    navigate('/settings/networks/custom-rpc', {
      state: { selected, chain, isDefault },
    });
  };

  return (
    <Layout title={t('settings.manageNetworks')}>
      <ul className=" mb-4 w-full h-80 text-sm overflow-hidden md:h-96">
        <p className="pb-3 pt-1 text-center tracking-[0.2rem] text-brand-white  text-xs font-semibold bg-transparent border-b-2 border-brand-pink200">
          UTXO
        </p>
        {Object.values(networks.syscoin).map((network: INetwork) => (
          <li
            key={
              network.key
                ? network.key
                : `${network.label.trim()}-${network.chainId}`
            }
            className={`my-3 py-1 w-full flex justify-between items-center transition-all duration-300 border-b border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>
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
                : `${network.label.trim()}-${network.chainId}`
            }
            className={`my-3 py-1 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-alpha-whiteAlpha300 cursor-default`}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>
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
      <div className="w-full px-4 absolute bottom-12 md:static">
        <NeutralButton
          type="button"
          onClick={() => navigate('/home')}
          fullWidth={true}
        >
          {t('buttons.close')}
        </NeutralButton>{' '}
      </div>
    </Layout>
  );
};

export default ManageNetworkView;
