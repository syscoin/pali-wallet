import React from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-network';

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
  const SYSCOIN_UTXO_CHAIN_ID = 57;

  const { navigate } = useUtils();
  const { wallet } = getController();

  const removeNetwork = (chain: string, chainId: number, key?: string) =>
    wallet.removeKeyringNetwork(chain, chainId, key);

  const editNetwork = ({
    selected,
    chain,
    isDefault,
  }: {
    chain: string;
    isDefault: boolean;
    selected: INetwork;
  }) => {
    navigate('/settings/networks/custom-rpc', {
      state: { selected, chain, isDefault },
    });
  };

  return (
    <Layout title="MANAGE NETWORKS">
      <ul className="scrollbar-styled mb-4 w-full h-80 text-sm overflow-auto md:h-96">
        <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
          Syscoin Networks
        </p>
        {Object.values(networks.syscoin).map((network: INetwork) => (
          <li
            key={network.chainId}
            className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>

              <span>
                <b className="text-brand-royalblue">Blockbook URL:</b>{' '}
                {truncate(String(network.url), 26)}
              </span>
            </div>

            <div className="flex gap-x-3 items-center justify-between">
              {network.chainId !== SYSCOIN_UTXO_CHAIN_ID && (
                <IconButton
                  onClick={() =>
                    editNetwork({
                      selected: network,
                      chain: 'syscoin',
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
              )}
              {!network.default && (
                <Tooltip
                  content={
                    network.chainId === activeNetwork.chainId &&
                    network.url === activeNetwork.url
                      ? 'You cannot remove the active network'
                      : ''
                  }
                >
                  <IconButton
                    onClick={() =>
                      removeNetwork('syscoin', network.chainId, network?.key)
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

        <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
          Ethereum Networks
        </p>
        {Object.values(networks.ethereum).map((network: any) => (
          <li
            key={network.chainId}
            className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>

              <span className="text-brand-white">
                <b className="text-brand-royalblue">RPC URL:</b>
                {truncate(String(network.url), 26)}
              </span>
            </div>

            <div className="flex gap-x-3 items-center justify-between">
              <IconButton
                onClick={() =>
                  editNetwork({
                    selected: network,
                    chain: 'ethereum',
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
                      ? 'You cannot remove the active network'
                      : ''
                  }
                >
                  <IconButton
                    onClick={() => removeNetwork('ethereum', network.chainId)}
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

      <NeutralButton type="button" onClick={() => navigate('/home')}>
        Close
      </NeutralButton>
    </Layout>
  );
};

export default ManageNetworkView;
