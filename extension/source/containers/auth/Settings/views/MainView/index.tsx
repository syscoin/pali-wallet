import React, { FC } from 'react';
import { useHistory } from 'react-router-dom';
// import Icon from 'components/Icon';
import { useController } from 'hooks/index';
import Icon from 'components/Icon';

// import { RootState } from 'state/store';
// import IWalletState from 'state/wallet/types';
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
  // const { accounts, activeAccountId }: IWalletState = useSelector(
  //   (state: RootState) => state.wallet
  // );

  // const handleSelectAccount = (id: string) => {
  //   onChange(id);
  //   showView(ACCOUNT_VIEW);
  // };

  const handleLogout = () => {
    controller.wallet.logOut();
    history.push('/app.html');
  };

  return (
    <div >
      {generalSettings && (
        <ul>
          <li onClick={() => history.push('/general-autolock')}>
            <Icon name="clock" className="bg-brand-deepPink text-brand-white w-4" />
            Auto lock timer
          </li>

          <li
            onClick={() => history.push('/general-phrase')}
          >
            <Icon name="file-protect" className="bg-brand-deepPink text-brand-white w-4" />
            Wallet Seed Phrase
          </li>

          <li
            onClick={() => history.push('/general-about')}
          >
            <Icon name="warning" className="bg-brand-deepPink text-brand-white w-4" />
            Info/Help
          </li>
        </ul>
      )}

{/* <DollarOutlined /> */}

      {accountSettings && (
        <ul>
          <li
            onClick={() => history.push('/account-priv')}
          >
            <Icon name="key" className="bg-brand-deepPink text-brand-white w-4" />
            XPUB
          </li>

          <li
            onClick={() => history.push('/account-details')}
          >
            <Icon name="user" className="bg-brand-deepPink text-brand-white w-4" />
            Accounts
          </li>

          <li
            onClick={() => history.push('/account-newaccount')}
          >
            new account
          </li>

          <li
            onClick={() => history.push('/account-hardware')}
          >
            <Icon name="partition" className="bg-brand-deepPink text-brand-white w-4"/>
            Connect hardware wallet
          </li>

          <li
            onClick={handleLogout}
          >
            <Icon name="lock" className="bg-brand-deepPink text-brand-white w-4" />
            Lock
          </li>
        </ul>
      )}
    </div>
  );
};

export default MainView;
