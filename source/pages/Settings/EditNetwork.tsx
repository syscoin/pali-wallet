import React from 'react';
import { useStore, useUtils } from 'hooks/index';
import { Layout, SecondaryButton } from 'components/index';
import { formatUrl } from 'utils/index';

const EditNetworkView = () => {
  const { networks } = useStore();
  const { navigate } = useUtils();

  const defaultNetworks = ['main', 'testnet'];

  return (
    <Layout title="EDIT NETWORK">
      <p className="mt-4 text-left text-brand-white font-poppins text-sm">
        Click on network to edit
      </p>

      <ul className="scrollbar-styled mb-3 mt-2 px-6 py-2 w-full h-80 text-sm overflow-auto">
        {Object.values(networks).map((network) => (
          <li
            key={network.id}
            className={
              defaultNetworks.includes(network.id)
                ? 'my-3 cursor-not-allowed border-b border-dashed bg-opacity-60 border-dashed-light flex flex-col w-full'
                : 'my-3 w-full border-b border-dashed border-dashed-light cursor-pointer flex flex-col transition-all duration-300'
            }
            onClick={() => {
              if (defaultNetworks.includes(network.id)) return;
              navigate(`/settings/networks/custom-rpc/${network.id}`);
            }}
          >
            <span>{formatUrl(network.label, 25)}</span>

            <small className="flex gap-x-3 items-center justify-start">
              <span>Blockbook URL:</span>
              <span> {formatUrl(String(network.beUrl), 25)}</span>
            </small>
          </li>
        ))}
      </ul>

      <div className="absolute bottom-12">
        <SecondaryButton type="button" onClick={() => navigate('/home')}>
          Close
        </SecondaryButton>
      </div>
    </Layout>
  );
};

export default EditNetworkView;
