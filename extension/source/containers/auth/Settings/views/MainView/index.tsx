import React, { FC, Fragment, useState } from 'react';
import { useController, useUtils, useStore } from 'hooks/index';
import { Icon, Select } from 'components/index';
import { SYS_NETWORK, ETH_NETWORK } from 'constants/index';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { ChevronUpIcon } from '@heroicons/react/solid';

interface IMainView {
  accountSettings?: boolean;
  networkSettings?: boolean;
  generalSettings?: boolean;
  onClose?: any;
}

const MainView: FC<IMainView> = ({ accountSettings, generalSettings, networkSettings }) => {
  const { history } = useUtils();
  const controller = useController();
  const { activeNetwork } = useStore();

  const [expandedSYS, setExpandedSYS] = useState(false);
  const [expandedETH, setExpandedETH] = useState(false);

  const handleChangeNetwork = (value: string) => {
    controller.wallet.switchNetwork(value as string);
    controller.wallet.getNewAddress();
  };

  const handleLogout = () => {
    controller.wallet.logOut();

    history.push('/app.html');
  };

  return (
    <div className="text-brand-white">


      {accountSettings && (
        <ul>
          <div>
            <li className="inline-flex" onClick={() => history.push('/account-priv')}>
              <Icon
                name="key"
                className="inline-flex self-center bg-brand-deepPink text-brand-white w-4"
              />
              XPUB
            </li>
          </div>
          <div>
            <li className="inline-flex" onClick={() => history.push('/account-details')}>
              <Icon
                name="user"
                className="inline-flex self-center bg-brand-deepPink text-brand-white w-4"
              />
              Accounts
            </li>

            <li onClick={() => history.push('/account-newaccount')}>
              new account
            </li>
          </div>
          <div>
            <li className="inline-flex" onClick={() => history.push('/account-hardware')}>
              <Icon
                name="partition"
                className="inline-flex self-center bg-brand-deepPink text-brand-white w-4"
              />
              Connect hardware wallet
            </li>
          </div>
          <div>
            <li className="inline-flex" onClick={handleLogout}>
              <Icon
                name="lock"
                className="inline-flex self-center bg-brand-deepPink text-brand-white w-4"
              />
              Lock
            </li>
          </div>
        </ul>
      )}

    </div>
  );
};

export default MainView;
