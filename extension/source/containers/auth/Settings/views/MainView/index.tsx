import React, { FC, useState } from 'react';
import { useController, useUtils, useStore } from 'hooks/index';
import { Icon, Select } from 'components/index';
import { SYS_NETWORK, ETH_NETWORK } from 'constants/index';

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
      {generalSettings && (
        <ul>
          <li
            className="inline-flex m-px pt-6 text-base"
            onClick={() => history.push('/general-autolock')}
          >
            <Icon name="clock" className="pr-4 inline-flex self-center text-base mb-0.5" />
            Auto lock timer
          </li>

          <li
            className="inline-flex m-px pt-6 text-base"
            onClick={() => history.push('/general-currency')}
          >
            <Icon name="dolar" className="pr-4 inline-flex self-center text-base mb-0.5" />
            Currency
          </li>

          <li
            className="inline-flex m-px pt-6 text-base"
            onClick={() => history.push('/general-phrase')}
          >
            <Icon name="wallet" className="pr-4 inline-flex self-center text-base mb-0.5" />

            Wallet Seed Phrase
          </li>

          <li
            className="inline-flex m-px pt-6 text-base"
            onClick={() => history.push('/general-about')}
          >
            <Icon name="warning" className="pr-4 inline-flex self-center text-base mb-0.5" />

            Info/Help
          </li>

          <li
            className="inline-flex m-px pt-6 text-base"
            onClick={() => history.push('/general-delete')}
          >
            <Icon name="delete" className="pr-4 inline-flex self-center text-base mb-0.5" />
            Delete Wallet
          </li>
        </ul>
      )}

      {/* <DollarOutlined /> */}

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

      {networkSettings && (
        <ul>
          <div className="px-6">
            <li
              className="px-3 flex items-center bg-brand-lightgreen rounded-full text-sm w-full py-1"
              onClick={() => history.push('/networks-sites')}
            >
              <Icon name="globe" className="pr-4 inline-flex self-center text-base mb-0.5" />
              Show connected sites
            </li>
          </div>

          <Select
            value="Mainnet"
            title="Syscoin networks"
            icon="dolar"
            expanded={expandedSYS}
            setExpanded={setExpandedSYS}
            close={setExpandedETH}
          >
            {Object.values(SYS_NETWORK).map((network: any) => {
              return (
                <li
                  className="flex items-center justify-around p-2 hover:bg-brand-lightnavyborder transition-all duration-300"
                  onClick={() => handleChangeNetwork(network.id)}
                >
                  <span>{network.label}</span>

                  {activeNetwork === network.id && (
                    <Icon
                      name="check"
                      className="w-4 mb-1"
                      wrapperClassname="w-6 absolute right-1"
                    />
                  )}
                </li>
              )
            })}
          </Select>

          <Select
            value="Mainnet"
            title="Ethereum networks"
            icon="dolar"
            expanded={expandedETH}
            setExpanded={setExpandedETH}
            close={setExpandedSYS}
          >
            {Object.values(ETH_NETWORK).map((network: any) => {
              return (
                <li
                  className="flex items-center justify-around p-2 hover:bg-brand-lightnavyborder transition-all duration-300"
                  onClick={() => handleChangeNetwork(network.id)}
                >
                  <span>{network.label}</span>

                  {activeNetwork === network.id && (
                    <Icon
                      name="check"
                      className="w-4 mb-1"
                      wrapperClassname="w-6 absolute right-1"
                    />
                  )}
                </li>
              )
            })}
          </Select>

          <li
            className="px-6 flex items-center pt-6 text-base"
          >
            <Icon name="home" className="pr-4 inline-flex self-center text-base mb-0.5" />

            Localhost 8545
          </li>

          <li
            className="px-6 flex items-center pt-6 text-base"
            onClick={() => history.push('/networks-custom')}
          >
            <Icon name="appstoreadd" className="pr-4 inline-flex self-center text-base mb-0.5" />
            Custom RPC
          </li>

          <li
            className="px-6 flex items-center pt-6 text-base"
            onClick={() => history.push('/networks-edit')}
          >
            <Icon name="edit" className="pr-4 inline-flex self-center text-base mb-0.5" />
            Edit networks
          </li>
        </ul>
      )}
    </div>
  );
};

export default MainView;
