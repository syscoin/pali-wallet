import React, { useState } from 'react';
import { useStore, useUtils } from 'hooks/index';
import { IconButton, Layout, SecondaryButton, Icon } from 'components/index';
import { formatUrl } from 'utils/index';
import { getController } from 'utils/browser';

import { CustomRPC } from '..';

const ManageNetworkView = () => {
  const { networks } = useStore();
  const { navigate } = useUtils();
  const { wallet } = getController();

  const [selected, setSelected] = useState('');

  const removeNetwork = (chainId: number) => {
    const chain = networks.syscoin[chainId] ? 'syscoin' : 'ethereum';

    wallet.removeNetwork(chain, chainId);
  };

  return (
    <>
      {selected ? (
        <CustomRPC
          selectedToEdit={
            selected || {
              id: -1,
              label: '',
              berl: '',
              chinID: -1,
            }
          }
        />
      ) : (
        <Layout title="MANAGE NETWORK">
          <p className="mt-4 text-left text-brand-white font-poppins text-sm">
            Click on network to manage
          </p>

          <ul className="scrollbar-styled mb-3 mt-2 px-4 py-2 w-full h-80 text-sm overflow-auto">
            {Object.values(networks.syscoin).map((network: any) => (
              <li
                key={network.chainId}
                className={
                  network.default
                    ? 'my-3 cursor-not-allowed border-b border-dashed bg-opacity-60 border-dashed-light flex flex-col w-full'
                    : 'my-3 w-full border-b border-dashed border-dashed-light cursor-pointer flex flex-col transition-all duration-300'
                }
              >
                <span
                  onClick={() =>
                    !network.default ? setSelected(network) : undefined
                  }
                  className={`${
                    !network.default &&
                    'hover:text-brand-royalblue cursor-pointer'
                  }`}
                >
                  {formatUrl(network.label, 25)}
                </span>

                <small className="flex items-center justify-between">
                  <div className="flex gap-x-3 items-center justify-start">
                    <span>Blockbook URL:</span>
                    <span>{formatUrl(String(network.url), 25)}</span>
                  </div>

                  {!network.default && (
                    <IconButton
                      onClick={() => removeNetwork(network.chainId)}
                      type="primary"
                      shape="circle"
                    >
                      <Icon
                        name="trash"
                        className="hover:text-brand-royalblue text-xl"
                      />
                    </IconButton>
                  )}
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
      )}
    </>
  );
};

export default ManageNetworkView;
