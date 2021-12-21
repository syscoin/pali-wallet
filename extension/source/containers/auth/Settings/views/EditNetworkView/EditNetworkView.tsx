import React, { useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { useStore, useFormat } from 'hooks/index';
import { CustomRPCView } from '..';

const EditNetworkView = () => {
  const { networks } = useStore();
  const { formatURL } = useFormat();

  const defaultNetworks = ['main', 'testnet'];

  const [selected, setSelected] = useState('');

  return (
    <>
      {selected ? (
        <CustomRPCView selectedToEdit={selected || { id: -1, label: '', beUrl: '', chainID: -1 }} />
      ) : (
        <AuthViewLayout title="EDIT NETWORK">
          <p className="text-brand-white font-poppins py-4 pl-6 text-sm">Click on network to edit</p>

          <ul className="text-sm overflow-auto px-4 h-96 w-full">
            {Object.values(networks).map((network: any) => {
              return (
                <li
                  key={network.id}
                  className={defaultNetworks.includes(network.id) ? 'my-3 py-2 px-4 rounded-lg cursor-not-allowed border border-dashed bg-brand-navydarker bg-opacity-60 border-brand-graydark flex flex-col w-full' : 'my-3 py-2 px-4 rounded-lg w-full border border-dashed border-brand-royalBlue cursor-pointer flex flex-col transition-all duration-300 bg-brand-navydark hover:bg-brand-navydarker'}
                  onClick={() => {
                    !defaultNetworks.includes(network.id) && setSelected(network);
                  }}
                >
                  <span>
                    {formatURL(network.label, 25)}
                  </span>

                  <small className="flex justify-start items-center gap-x-3">
                    <span>Blockbook URL:</span>
                    <span> {formatURL(String(network.beUrl), 25)}</span>
                  </small>
                </li>
              )
            })}
          </ul>
        </AuthViewLayout >
      )
      }
    </>

  );
};

export default EditNetworkView;