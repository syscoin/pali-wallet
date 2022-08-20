import React from 'react';
import { useSelector } from 'react-redux';

import { INetwork } from '@pollum-io/sysweb3-utils';

import { IconButton, Layout, SecondaryButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatUrl } from 'utils/index';

const ManageNetworkView = () => {
  const networks = useSelector((state: RootState) => state.vault.networks);
  const { navigate } = useUtils();
  const { wallet } = getController();

  const removeNetwork = (chain: string, chainId: number) =>
    wallet.removeKeyringNetwork(chain, chainId);

  const editNetwork = ({
    selected,
    chain,
  }: {
    chain: string;
    selected: INetwork;
  }) => {
    navigate('/settings/networks/custom-rpc', {
      state: { selected, chain },
    });
  };

  return (
    <Layout title="MANAGE NETWORKS">
      <p className="mt-4 text-left text-brand-white font-poppins text-sm">
        Click on network to manage
      </p>

      <ul className="scrollbar-styled mb-3 mt-2 px-4 py-2 w-full h-80 text-sm overflow-auto md:h-96">
        <p className="py-1 text-brand-royalbluemedium text-xs font-bold bg-bkg-1">
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
              <span>{formatUrl(network.label, 25)}</span>

              <span>Blockbook URL: {formatUrl(String(network.url), 30)}</span>
            </div>

            {!network.default && (
              <div className="flex gap-x-3 items-center justify-between">
                <IconButton
                  onClick={() =>
                    editNetwork({ selected: network, chain: 'syscoin' })
                  }
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

        <p className="py-1 text-brand-royalbluemedium text-xs font-bold bg-bkg-1">
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
              <span>{formatUrl(network.label, 25)}</span>

              <span>RPC URL: {formatUrl(String(network.url), 30)}</span>
            </div>

            {!network.default && (
              <div className="flex gap-x-3 items-center justify-between">
                <IconButton
                  onClick={() =>
                    editNetwork({ selected: network, chain: 'ethereum' })
                  }
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="edit"
                    className="hover:text-brand-royalblue text-xl"
                  />
                </IconButton>

                <IconButton
                  onClick={() => removeNetwork('ethereum', network.chainId)}
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
      </ul>

      <SecondaryButton type="button" onClick={() => navigate('/home')}>
        Close
      </SecondaryButton>
    </Layout>
  );
};

export default ManageNetworkView;
