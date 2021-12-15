import React, { FC, useState } from 'react';
import { useController, /* useStore */ useUtils } from 'hooks/index';
import { Icon } from 'components/index';

// import AccountSelect from 'components/AccountSelect';

interface IMainView {
  accountSettings?: boolean;
  generalSettings?: boolean;
  networkSetting?: boolean;
  // onChange: (id: string) => void;
  onClose?: any;
}

const MainView: FC<IMainView> = ({
  accountSettings,
  generalSettings,
  networkSetting,
}) => {
  const { history } = useUtils();
  const controller = useController();
  const [showSyscoinjsNetWork, setShowSyscoinjsNetWork] =
    useState<boolean>(false);
  const [showAccounts, setShowAccounts] = useState<boolean>(false);
  //const [collapsed, setCollapsed] = useState(false)
  // const { accounts, activeAccountId } = useStore();

  // const handleSelectAccount = (id: string) => {
  //   onChange(id);
  //   showView(ACCOUNT_VIEW);
  // };

  const handleLogout = () => {
    controller.wallet.logOut();
    history.push('/app.html');
  };

  return (
    <div className="text-brand-white">
      {generalSettings && (
        <ul className="px-3">
          <li
            className="inline-flex m-px pt-4 text-base cursor-pointer"
            onClick={() => history.push('/general-autolock')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-xl mb-0.5"
            />
            Auto lock timer
          </li>

          <li
            className="inline-flex m-px pt-4 text-base cursor-pointer"
            onClick={() => history.push('/general-currency')}
          >
            <Icon
              name="dolar"
              className="pr-4 inline-flex self-center text-xl mb-0.5"
            />
            Currency
          </li>

          <li
            className="inline-flex m-px pt-4 text-base cursor-pointer"
            onClick={() => history.push('/general-phrase')}
          >
            <Icon
              name="wallet"
              className="pr-4 inline-flex self-center text-xle mb-0.5"
            />
            Wallet Seed Phrase
          </li>

          <li
            className="inline-flex m-px pt-4 text-base cursor-pointer"
            onClick={() => history.push('/general-about')}
          >
            <Icon
              name="warning"
              className="pr-4 inline-flex self-center text-xl mb-0.5"
            />
            Info/Help
          </li>

          <li
            className="inline-flex m-px pt-4 text-base cursor-pointer"
            onClick={() => history.push('/general-delete')}
          >
            <Icon
              name="delete"
              className="pr-4 inline-flex self-center text-xl mb-0.5"
            />
            Delete Wallet
          </li>
        </ul>
      )}

      {/* <DollarOutlined /> */}

      {accountSettings && (
        <ul>
          <div>
            <li
              className="inline-flex text-base pt-5 cursor-pointer"
              onClick={() => history.push('/account-priv')}
            >
              <Icon
                name="key"
                className="text-xl inline-flex self-center bg-brand-deepPink text-brand-white w-5"
              />
              X - PUB
            </li>
          </div>
          <div>
            <li
              className="inline-flex text-base pt-5 cursor-pointer"
              onClick={() => setShowAccounts(!showAccounts)}
            >
              <Icon
                name="user"
                className="text-xl inline-flex self-center bg-brand-deepPink text-brand-white w-5"
              />
              Accounts
              {showAccounts ? (
                <Icon
                  name="up"
                  className="inline-flex self-center text-sm pl-28 leading-2"
                  maxWidth={'1'}
                ></Icon>
              ) : (
                <Icon
                  name="down"
                  className="inline-flex self-center text-sm pl-28 leading-2"
                  maxWidth={'1'}
                ></Icon>
              )}
            </li>
            {showAccounts && (
              <div className="bg-brand-deepPink100">
                <ul >
                  <li
                    className="px-4 text-base mt-2 pt-5 cursor-pointer"
                    onClick={() => history.push('/account-newaccount')}
                  >
                    Create new account
                  </li>
                </ul>
              </div>
            )}
          </div>
          <div>
            <li
              className="inline-flex text-base pt-5 cursor-pointer"
              onClick={() => history.push('/account-hardware')}
            >
              <Icon
                name="partition"
                className="text-xl inline-flex self-center bg-brand-deepPink text-brand-white w-5"
              />
              Connect hardware wallet
            </li>
          </div>
          <div>
            <li className="inline-flex text-base pt-5 cursor-pointer" onClick={handleLogout}>
              <Icon
                name="lock"
                className="text-xl inline-flex self-center bg-brand-deepPink text-brand-white w-5"
              />
              Lock
            </li>
          </div>
        </ul>
      )}
      {networkSetting && (
        <ul>
          <li
            className="w-full inline-flex py-1 px-4 text-base font-bold text-white bg-brand-greensettings rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-connectedsites')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Show Connected sites
          </li>
          <li
            className="w-full inline-flex py-1 px-4 text-base font-bold text-white bg-black rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-blacklist')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Black List
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4"
            onClick={() => setShowSyscoinjsNetWork(!showSyscoinjsNetWork)}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Syscoinjs Networks
            {showSyscoinjsNetWork ? (
              <Icon
                name="up"
                className="inline-flex self-center text-sm pl-2 leading-2"
                maxWidth={'1'}
              ></Icon>
            ) : (
              <Icon
                name="down"
                className="inline-flex self-center text-sm pl-2 leading-2"
                maxWidth={'1'}
              ></Icon>
            )}
          </li>
          {showSyscoinjsNetWork && (
            <div className="bg-brand-navydarker">
              <ul className="pl-8">
                <li className="px-4 text-base mt-2">Syscoin Mainnet</li>
                <li className="px-4 text-base mt-2">Syscoin Mainnet</li>
                <li className="px-4 text-base mt-2">Bitcoin Mainnet</li>
              </ul>
            </div>
          )}
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-autolock')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            WEB3 Networks
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-autolock')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Localhost
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-customrpc')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Custom RPC
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-editnetworks')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Edit Networks
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-connectwith')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Connect with View
          </li>
          <li
            className="inline-flex py-1 px-4 text-base font-bold text-white rounded-full mt-4 cursor-pointer"
            onClick={() => history.push('/general-createtoken')}
          >
            <Icon
              name="clock"
              className="pr-4 inline-flex self-center text-base mb-0.5"
            />
            Create token
          </li>
        </ul>
      )}
    </div>
  );
};

export default MainView;
