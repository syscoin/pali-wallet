import React, { useState } from 'react';
import { useStore, useUtils } from 'hooks/index';
import { Layout, SecondaryButton } from 'components/index';
import { formatUrl } from 'utils/index';

import { CustomRPC } from '..';

const ManageNetworkView = () => {
  const { networks } = useStore();
  const { navigate } = useUtils();

  const defaultNetworks = ['main', 'testnet'];

  const [selected, setSelected] = useState('');

  return (
    <>
      {selected ? (
        <CustomRPC
          selectedToEdit={
            selected || {
              id: -1,
              lael: '',
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
            {Object.values(networks).map((network: any) => (
              <li
                key={network.id}
                className={
                  defaultNetworks.includes(network.id)
                    ? 'my-3 cursor-not-allowed border-b border-dashed bg-opacity-60 border-dashed-light flex flex-col w-full'
                    : 'my-3 w-full border-b border-dashed border-dashed-light cursor-pointer flex flex-col transition-all duration-300'
                }
                onClick={() =>
                  !defaultNetworks.includes(network.id)
                    ? setSelected(network)
                    : undefined
                }
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
      )}
    </>
  );
};

export default ManageNetworkView;
