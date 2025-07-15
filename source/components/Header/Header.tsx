import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { INetwork } from '@pollum-io/sysweb3-network';

import { ErrorModal } from '..';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

import { AccountHeader } from '.';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import { GeneralMenu, NetworkMenu } from './Menus';
import { SetActiveAccountModal } from './SetActiveAccountModal';

interface IHeader {
  accountHeader?: boolean;
}

export const Header: React.FC<IHeader> = ({ accountHeader = false }) => {
  const location = useLocation();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const error = useSelector((state: RootState) => state.vaultGlobal.error);

  // Determine if menus should be enabled based on current route
  const menusEnabled = useMemo(() => {
    const homeRoutes = ['/home'];
    return homeRoutes.includes(location.pathname);
  }, [location.pathname]);

  const [networkErrorStatus, setNetworkErrorStatus] = useState({
    error: false,
    description: '',
    title: '',
  });
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedNetwork, setSelectedNetwork] = useState<INetwork>();

  useEffect(() => {
    if (error) {
      setNetworkErrorStatus({
        error: true,
        description: error,
        title: t('header.errorSwitching'),
      });

      controllerEmitter(['wallet', 'resolveError']);
    }
  }, [error]);

  return (
    <>
      <div className="relative z-[60] flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
        <div className="flex items-center gap-3">
          <NetworkMenu
            setActiveAccountModalIsOpen={setIsOpen}
            setSelectedNetwork={setSelectedNetwork}
            disabled={!menusEnabled}
          />
          <ConnectionStatusIndicator />
        </div>

        <GeneralMenu disabled={!menusEnabled} />
        <SetActiveAccountModal
          showModal={isOpen}
          setIsOpen={setIsOpen}
          selectedNetwork={selectedNetwork}
        />

        <ErrorModal
          title={t('header.errorSwitching')}
          description={t('header.thereWasAnError')}
          log={networkErrorStatus.description}
          show={networkErrorStatus.error}
          onClose={() =>
            setNetworkErrorStatus({
              error: false,
              description: '',
              title: '',
            })
          }
        />
      </div>

      {accountHeader && <AccountHeader />}
    </>
  );
};
