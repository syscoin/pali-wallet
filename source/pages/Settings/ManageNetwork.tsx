import React from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-utils';

import { IconButton, Layout, Icon, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate } from 'utils/index';

const ManageNetworkView = () => {
  const networks = useSelector((state: RootState) => state.vault.networks);
  const { navigate } = useUtils();
  const { wallet } = getController();

  const removeNetwork = (chain: string, chainId: number) =>
    wallet.removeKeyringNetwork(chain, chainId);

  const editNetwork = (chainId: number, chain: string) => {
    navigate('/settings/networks/custom-rpc', {
      state: { chainId, chain },
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
            className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light
              ${
                network.default
                  ? 'cursor-not-allowed bg-opacity-60'
                  : 'cursor-default'
              }
            `}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>

              <span>
                <b className="text-brand-royalblue">Blockbook URL:</b>{' '}
                {truncate(String(network.url), 26)}
              </span>
            </div>

            {!network.default && (
              <div className="flex gap-x-3 items-center justify-between">
                <IconButton
                  onClick={() => editNetwork(network.chainId, 'syscoin')}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="edit"
                    className="hover:text-brand-royalblue text-xl"
                  />
                </IconButton>

                <IconButton
                  onClick={() => removeNetwork('syscoin', network.chainId)}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="trash"
                    className="hover:text-brand-royalblue text-xl"
                  />
                </IconButton>
              </div>
            )}
          </li>
        ))}

        <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
          Ethereum Networks
        </p>
        {Object.values(networks.ethereum).map((network: any) => (
          <li
            key={network.chainId}
            className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light
              ${
                network.default
                  ? 'cursor-not-allowed bg-opacity-60'
                  : 'cursor-default'
              }
            `}
          >
            <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
              <span>{truncate(network.label, 25)}</span>

              <span className="text-brand-white">
                <b className="text-brand-royalblue">RPC URL:</b>
                {truncate(String(network.url), 26)}
              </span>
            </div>

            {!network.default && (
              <div className="flex flex-col gap-y-3 items-end justify-end">
                <IconButton
                  onClick={() => editNetwork(network.chainId, 'ethereum')}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="edit"
                    className="hover:text-brand-royalblue text-xs"
                  />
                </IconButton>

                <IconButton
                  onClick={() => removeNetwork('ethereum', network.chainId)}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="trash"
                    className="hover:text-brand-royalblue text-xs"
                  />
                </IconButton>
              </div>
            )}
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
