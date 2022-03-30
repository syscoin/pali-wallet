import { Layout, Icon, IconButton, SecondaryButton } from 'components/index';
import React, { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { browser } from 'webextension-polyfill-ts';
import { useUtils } from 'hooks/index';
import { formatUrl, ellipsis } from 'utils/index';
import { getController } from 'utils/browser';

const ConnectedSites = (): any => {
  const { navigate } = useUtils();

  const accountController = getController().wallet.account;
  const activeAccount = accountController.getActiveAccount();

  const [selected, setSelected] = useState<string>('');

  const disconnectSite = (id: any) => {
    browser.runtime.sendMessage({
      type: 'RESET_CONNECTION_INFO',
      target: 'background',
      id,
      url: selected,
    });

    setSelected('');
  };

  return (
    <Layout title="CONNECTED SITES">
      <p className="m-4 max-w-xs text-white text-xs md:max-w-md">
        {false
          ? `${activeAccount?.label} is connected to:`
          : `${activeAccount?.label} is not connected to any sites. To connect to a SYS platform site, find the connect button on their site.`}
      </p>

      <div className="flex flex-col items-center justify-center w-full">
        {/* {activeAccount?.connectedTo &&
          activeAccount.connectedTo.map((url: string) => (
            <ul
              key={url}
              className="scrollbar-styled px-4 py-2 w-full h-80 overflow-auto"
            >
              <li className="flex items-center justify-between my-2 py-3 w-full text-xs border-b border-dashed border-gray-500">
                <p>{formatUrl(url, 25)}</p>

                <IconButton onClick={() => setSelected(url)}>
                  <Icon name="edit" wrapperClassname="w-4" />
                </IconButton>
              </li>
            </ul>
          ))} */}

        {selected && (
          <Transition appear show={selected !== ''} as={Fragment}>
            <Dialog
              as="div"
              className="fixed z-10 inset-0 text-center overflow-y-auto"
              onClose={() => setSelected('')}
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
                  <div className="inline-block align-middle my-8 py-6 w-full max-w-2xl text-left font-poppins bg-bkg-2 rounded-2xl shadow-xl overflow-hidden transform transition-all">
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
                        <p>{formatUrl(selected, 20)}</p>

                        <IconButton
                          onClick={() => disconnectSite(activeAccount?.id)}
                        >
                          <Icon name="delete" />
                        </IconButton>
                      </div>

                      <div className="p-4 bg-bkg-1">
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
                        onClick={() => setSelected('')}
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
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </Layout>
  );
};

export default ConnectedSites;
