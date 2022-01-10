import { Icon, IconButton, SecondaryButton } from 'components/index';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { Fragment, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { useUtils, useBrowser, useAccount, useFormat } from 'hooks/index';

const ConnectedSites = () => {
  const [selected, setSelected] = useState<string>('');

  const { activeAccount } = useAccount();
  const { formatURL, ellipsis } = useFormat();
  const { history } = useUtils();
  const { browser } = useBrowser();

  const disconnectSite = (id: any) => {
    console.log('id selected', id, selected);
    browser.runtime.sendMessage({
      type: 'RESET_CONNECTION_INFO',
      target: 'background',
      id,
      url: selected,
    });

    setSelected('');
  };

  return (
    <AuthViewLayout title="CONNECTED SITES">
      <p className="text-white text-xs m-4">
        {activeAccount?.connectedTo.length
          ? `${activeAccount.label} is connected to:`
          : `${activeAccount?.label} is not connected to any sites. To connect to a SYS platform site, find the connect button on their site.`}
      </p>

      <div className="flex flex-col justify-center items-center w-full">
        {activeAccount?.connectedTo &&
          activeAccount.connectedTo.map((url: string) => {
            return (
              <ul className="scrollbar-styled h-80 overflow-auto w-full p-4">
                <li className="flex justify-between p-3 my-2 border-b border-dashed border-yellow-300 items-center w-full text-xs">
                  <p>{formatURL(url, 25)}</p>

                  <IconButton onClick={() => setSelected(url)}>
                    <Icon
                      name="edit"
                      className="text-yellow-300"
                      wrapperClassname="w-4"
                    />
                  </IconButton>
                </li>
              </ul>
            );
          })}

        {selected && (
          <Transition appear show={selected !== ''} as={Fragment}>
            <Dialog
              as="div"
              className="fixed inset-0 z-10 overflow-y-auto"
              onClose={() => setSelected('')}
            >
              <div className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-black bg-opacity-50" />

              <div className="min-h-screen px-4">
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
                  className="inline-block h-screen align-middle"
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
                  <div className="font-poppins inline-block w-full max-w-md py-6 my-8 overflow-hidden align-middle transition-all transform bg-bkg-2 shadow-xl rounded-2xl">
                    <Dialog.Title
                      as="h3"
                      className="text-lg font-medium leading-6 text-brand-white text-center border-b pb-3 border-dashed border-brand-white"
                    >
                      Edit connection
                    </Dialog.Title>
                    <div className="my-4">
                      <p className="text-sm text-brand-white m-3">
                        Delete connected site:
                      </p>

                      <div className="flex justify-between text-brand-white items-center m-3">
                        <p>{formatURL(selected, 20)}</p>

                        <IconButton
                          onClick={() => disconnectSite(activeAccount?.id)}
                        >
                          <Icon name="delete" className="text-yellow-300" />
                        </IconButton>
                      </div>

                      <div className="bg-bkg-1 p-4">
                        <p className="text-brand-white mb-3">Permissions</p>

                        <div className="flex justify-between items-center">
                          <p className="text-brand-white text-xs">
                            {activeAccount?.label}
                          </p>

                          <p className="text-brand-white text-xs">
                            {ellipsis(activeAccount?.address.main)}
                          </p>
                        </div>

                        <p className="text-brand-white cursor-not-allowed opacity-60 pt-3 border-t border-dashed border-brand-white mt-4">
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
                        className="inline-flex justify-center px-12 py-2 text-sm font-medium text-brand-royalblue bg-blue-100 border border-transparent rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-royalblue"
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

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => history.push('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};
export default ConnectedSites;
