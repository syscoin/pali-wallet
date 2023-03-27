import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, Icon, IconButton, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { IDApp } from 'state/dapp/types';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate, ellipsis } from 'utils/index';

const ConnectedSites = () => {
  const { dapp } = getController();
  const { navigate } = useUtils();

  const { accounts, activeAccountId } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountId];

  const [selected, setSelected] = useState<IDApp>();
  const dapps = Object.values(dapp.getAll());

  const disconnectSelected = () => {
    dapp.disconnect(selected.host);

    setSelected(undefined);
  };

  return (
    <Layout title="CONNECTED SITES">
      <p className="w-full text-white text-sm md:max-w-md">
        {dapps.length > 0
          ? `${activeAccount.label} is connected to these sites. They can view your account public information.`
          : `${activeAccount.label} is not connected to any sites. To connect to a Pali compatible dApp, find the connect button on their site.`}
      </p>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled w-full max-w-xs h-80 overflow-auto md:max-w-md">
          {' '}
          {dapps.map((_dapp) => (
            <li
              key={_dapp.host}
              className="flex items-center justify-between my-2 py-3 w-full text-xs border-b border-dashed border-gray-500"
            >
              <p>{truncate(_dapp.host, 40)}</p>

              <IconButton onClick={() => setSelected(_dapp)}>
                <Icon name="edit" wrapperClassname="w-4" />
              </IconButton>
            </li>
          ))}
        </ul>

        {selected && (
          <Transition appear show={selected !== undefined} as={Fragment}>
            <Dialog
              as="div"
              className="fixed z-10 inset-0 text-center overflow-y-auto"
              onClose={() => setSelected(undefined)}
            >
              <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

              <div className="px-4 min-h-screen">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <Dialog.Overlay className="fixed inset-0" />
                </Transition.Child>

                <span
                  className="inline-block align-middle h-screen"
                  aria-hidden="true"
                >
                  &#8203;
                </span>
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <div className="inline-block align-middle my-8 py-6 w-full max-w-2xl text-left font-poppins bg-bkg-4 rounded-2xl shadow-xl overflow-hidden transform transition-all">
                    <Dialog.Title
                      as="h3"
                      className="pb-3 text-center text-brand-white text-lg font-medium leading-6 border-b border-dashed border-brand-white"
                    >
                      Edit connection
                    </Dialog.Title>
                    <div className="my-4">
                      <p className="m-3 text-brand-white text-sm">
                        Delete connected site:
                      </p>

                      <div className="flex items-center justify-between m-3 text-brand-white">
                        <p>{truncate(selected.host, 35)}</p>

                        <IconButton onClick={disconnectSelected}>
                          <Icon name="delete" />
                        </IconButton>
                      </div>

                      <div className="p-4 bg-bkg-3">
                        <p className="mb-3 text-brand-white">Permissions</p>

                        <div className="flex items-center justify-between">
                          <p className="text-brand-white text-xs">
                            {activeAccount?.label}
                          </p>

                          <p className="text-brand-white text-xs">
                            {ellipsis(activeAccount?.address)}
                          </p>
                        </div>

                        <p className="mt-4 pt-3 text-brand-white border-t border-dashed border-brand-white opacity-60 cursor-not-allowed">
                          <input type="checkbox" />

                          <span className="mb-1 ml-3">
                            View the addresses of your permitted accounts
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 text-center">
                      <button
                        type="button"
                        className="transparent inline-flex justify-center px-12 py-2 hover:text-bkg-4 text-brand-white text-sm font-medium hover:bg-white bg-repeat border border-white rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
                        onClick={() => setSelected(undefined)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </Transition.Child>
              </div>
            </Dialog>
          </Transition>
        )}

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="button" onClick={() => navigate('/home')}>
            Close
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default ConnectedSites;
