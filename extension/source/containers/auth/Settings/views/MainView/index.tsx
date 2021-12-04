import React, { FC } from 'react';
import { useController,/* useStore */ useUtils} from 'hooks/index';
import { Icon } from 'components/index';

// import AccountSelect from 'components/AccountSelect';

interface IMainView {
  accountSettings?: boolean;
  generalSettings?: boolean;
  // onChange: (id: string) => void;
  onClose?: any;
}

const MainView: FC<IMainView> = ({ accountSettings, generalSettings }) => {
  const { history } = useUtils();
  const controller = useController();
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
    </div>
  );
};

export default MainView;
