import React, { FC } from 'react';
import { useHistory } from 'react-router-dom';
import { useController /* , useStore */ } from 'hooks/index';
import { Icon } from 'components/index';
import { ClockCircleOutlined, DeleteOutlined, DollarOutlined, WalletOutlined, WarningOutlined } from '@ant-design/icons';
// import AccountSelect from 'components/AccountSelect';

interface IMainView {
  accountSettings?: boolean;
  generalSettings?: boolean;
  // onChange: (id: string) => void;
  onClose?: any;
}

const MainView: FC<IMainView> = ({ accountSettings, generalSettings }) => {
  const history = useHistory();
  const controller = useController();
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
        <ul>
          <li className="m-px pt-6 justify-center" onClick={() => history.push('/general-autolock')}>
            <ClockCircleOutlined style={{marginBottom: '2px'}} />
            Auto lock timer
          </li>

          <li className="m-px pt-6" onClick={() => history.push('/general-phrase')}>
            <DollarOutlined />
            Currency
          </li>

          <li className="m-px pt-6" onClick={() => history.push('/general-phrase')}>
            <WalletOutlined />
            Wallet Seed Phrase
          </li>

          <li className="m-px pt-6" onClick={() => history.push('/general-about')}>
            <WarningOutlined />
            Info/Help
          </li>

          <li className="m-px pt-6" onClick={() => history.push('/general-about')}>
            <DeleteOutlined />
            Delete Wallet
          </li>
          
        </ul>
      )}

      {/* <DollarOutlined /> */}

      {accountSettings && (
        <ul>
          <li onClick={() => history.push('/account-priv')}>
            <Icon
              name="key"
              className="bg-brand-deepPink text-brand-white w-4"
            />
            XPUB
          </li>

          <li onClick={() => history.push('/account-details')}>
            <Icon
              name="user"
              className="bg-brand-deepPink text-brand-white w-4"
            />
            Accounts
          </li>

          <li onClick={() => history.push('/account-newaccount')}>
            new account
          </li>

          <li onClick={() => history.push('/account-hardware')}>
            <Icon
              name="partition"
              className="bg-brand-deepPink text-brand-white w-4"
            />
            Connect hardware wallet
          </li>

          <li onClick={handleLogout}>
            <Icon
              name="lock"
              className="bg-brand-deepPink text-brand-white w-4"
            />
            Lock
          </li>
        </ul>
      )}
    </div>
  );
};

export default MainView;
