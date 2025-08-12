import { Dialog } from '@headlessui/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { EditIconSvg } from 'components/Icon/Icon';
import { Icon, IconButton, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { IDApp } from 'state/dapp/types';
import { RootState } from 'state/store';
import { truncate, ellipsis } from 'utils/index';
import { navigateBack } from 'utils/navigationState';

const ConnectedSites = () => {
  const { controllerEmitter } = useController();
  const { navigate } = useUtils();
  const location = useLocation();
  const { t } = useTranslation();
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );

  // Get dapps directly from Redux state
  const dapps = useSelector((state: RootState) => state.dapp.dapps);

  // Show all dapps since they're connected globally (one account per dapp)
  const dappsList = Object.values(dapps);

  const [selected, setSelected] = useState<IDApp>();

  const disconnectSelected = async () => {
    if (!selected) return;

    try {
      // The controller will dispatch removeDApp action internally
      await controllerEmitter(['dapp', 'disconnect'], [selected.host]);
      await controllerEmitter(
        ['wallet', 'saveCurrentState'],
        ['connected-sites-disconnect']
      );
      // Close the modal
      setSelected(undefined);
    } catch (error) {
      console.error('Error disconnecting dapp:', error);
    }
  };

  return (
    <>
      <p className="w-full text-white text-sm md:max-w-md">
        {dappsList.length > 0
          ? `${dappsList.length} ${
              dappsList.length === 1 ? 'site is' : 'sites are'
            } connected to Pali Wallet`
          : 'No sites are connected to Pali Wallet'}
      </p>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="remove-scrollbar w-full max-w-xs h-80 overflow-auto md:max-w-md">
          {' '}
          {dappsList.map((_dapp) => (
            <li
              key={_dapp.host}
              className="flex items-center justify-between my-2 py-3 w-full text-xs border-b border-dashed border-gray-500"
            >
              <div className="flex-1">
                <p className="font-medium">{truncate(_dapp.host, 40)}</p>
                {_dapp.accountId !== activeAccountMeta.id && (
                  <p className="text-brand-graylight text-[10px] mt-1">
                    Connected to:{' '}
                    {accounts[_dapp.accountType]?.[_dapp.accountId]?.label ||
                      `Account ${_dapp.accountId + 1}`}
                  </p>
                )}
              </div>

              <IconButton onClick={() => setSelected(_dapp)}>
                <EditIconSvg className="w-4" />
              </IconButton>
            </li>
          ))}
        </ul>

        {selected && (
          <Dialog
            as="div"
            className="fixed z-10 inset-0 text-center overflow-y-auto"
            open={Boolean(selected)}
            onClose={() => setSelected(undefined)}
          >
            <div
              className={`fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-opacity duration-200 ${
                selected ? 'opacity-100' : 'opacity-0'
              }`}
            />

            <div className="px-4 min-h-screen">
              <Dialog.Overlay className="fixed inset-0" />

              <span
                className="inline-block align-middle h-screen"
                aria-hidden="true"
              >
                &#8203;
              </span>
              <div
                className={`inline-block align-middle my-8 py-6 w-full max-w-2xl text-left font-poppins bg-bkg-4 rounded-2xl shadow-xl overflow-hidden transform transition-transform duration-200 ${
                  selected ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                }`}
              >
                <Dialog.Title
                  as="h3"
                  className="pb-3 text-center text-brand-white text-lg font-medium leading-6 border-b border-dashed border-brand-white"
                >
                  {t('settings.editConnection')}
                </Dialog.Title>
                <div className="my-4">
                  <p className="m-3 text-brand-white text-sm">
                    {t('settings.deleteConnected')}:
                  </p>

                  <div className="flex items-center justify-between m-3 text-brand-white">
                    <p>{truncate(selected.host, 35)}</p>

                    <IconButton onClick={disconnectSelected}>
                      <Icon name="delete" />
                    </IconButton>
                  </div>

                  <div className="p-4 bg-bkg-3">
                    <p className="mb-3 text-brand-white">
                      {t('settings.permissions')}
                    </p>

                    <div className="flex items-center justify-between">
                      <p className="text-brand-white text-xs">
                        {accounts[selected.accountType]?.[selected.accountId]
                          ?.label || `Account ${selected.accountId + 1}`}
                      </p>

                      <p className="text-brand-white text-xs">
                        {ellipsis(
                          accounts[selected.accountType]?.[selected.accountId]
                            ?.address
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    className="transparent inline-flex justify-center px-12 py-2 hover:text-bkg-4 text-brand-white text-sm font-medium hover:bg-white bg-repeat border border-white rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
                    onClick={() => setSelected(undefined)}
                  >
                    {t('buttons.close')}
                  </button>
                </div>
              </div>
            </div>
          </Dialog>
        )}

        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton
            type="button"
            fullWidth
            onClick={() => navigateBack(navigate, location)}
          >
            {t('buttons.close')}
          </NeutralButton>
        </div>
      </div>
    </>
  );
};

export default ConnectedSites;
