import React, {
  FC,
  useState,
  useEffect,
  // KeyboardEvent,
  // ChangeEvent,
} from 'react';
// import clsx from 'clsx';
import Portal from '@reach/portal';
import { useSelector } from 'react-redux';
import { useTransition, animated } from 'react-spring';
import { useLocation, useHistory } from 'react-router-dom';
import IconButton from '@material-ui/core/IconButton';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import CloseIcon from '@material-ui/icons/Close';
import EditIcon from '@material-ui/icons/Create';
import CheckIcon from '@material-ui/icons/Check';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
// import TextInput from 'components/TextInput';
// import { useController } from 'hooks/index';

import * as Views from './views';
import * as routes from './views/routes';

interface ISettings {
  onClose?: () => void;
  open: boolean;
  accountSettings?: boolean;
  generalSettings?: boolean;
}

const Settings: FC<ISettings> = ({
  onClose,
  open,
  generalSettings = true,
  accountSettings = false,
}) => {
  const location = useLocation();
  const history = useHistory();
  // const controller = useController();
  const transitions = useTransition(location, (locat) => locat.hash, {
    initial: { opacity: 1 },
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
    config: { duration: 300 },
  });

  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [showedId, setShowedId] = useState<string>('0');
  const [editable, setEditable] = useState<boolean>(false);

  useEffect(() => {
    console.log(location.hash, routes)
    if (location.hash !== routes.ACCOUNT_VIEW && editable) {
      setEditable(false);
    }
  }, [location.hash]);

  const renderTitle = (view: string) => {
    switch (view) {
      // case routes.ACCOUNT_VIEW:
      //      return 'Accounts'
      // case routes.GENERAL_VIEW:
      //   return 'General Settings';
      case routes.PHRASE_VIEW:
        return 'Wallet seed phrase';
      case routes.DELETE_WALLET_VIEW:
        return 'Delete wallet';
      // case routes.NEW_ACCOUNT_VIEW:
      //   return 'Create account';
      // case routes.PRIV_KEY_VIEW:
      //   return 'Export private key';
      case routes.ABOUT_VIEW:
        return 'About';
      // case routes.CONNECT_HARDWARE_WALLET_VIEW:
      //   return 'Connect hardware wallet';
      case routes.AUTOLOCK_VIEW:
        return 'Auto lock timer';
    }
  };

  const renderView = (view: string) => {
    switch (view) {
      // case routes.ACCOUNT_VIEW:
      //   return <Views.AccountView id={Number(showedId)} />;
      // case routes.GENERAL_VIEW:
      //   return <Views.GeneralView />;
      case routes.PHRASE_VIEW:
        return <Views.PhraseView />;
      case routes.DELETE_WALLET_VIEW:
        return <Views.DeleteWalletView />;
      // case routes.NEW_ACCOUNT_VIEW:
      //   return <Views.NewAccountView />;
      // case routes.PRIV_KEY_VIEW:
      //   return <Views.PrivateKeyView id={showedId} />;
      case routes.ABOUT_VIEW:
        return <Views.AboutView />;
      // case routes.CONNECT_HARDWARE_WALLET_VIEW:
      //   return <Views.ConnectHardwareWalletView />;
      case routes.AUTOLOCK_VIEW:
        return <Views.AutolockView />;
      default:
        return <Views.MainView accountSettings={accountSettings} generalSettings={generalSettings} onChange={(id: string) => setShowedId(id)} />;
    }
  };

  const handleBackNav = () => {
    history.goBack();
  };

  const handleChangeLabel = () => {
    // if (!editable) {
    //   setShowedLabel(accounts[Number(showedId)].label);
    // } else {
    //   controller.wallet.account.updateAccountLabel(
    //     Number(showedId),
    //     showedLabel
    //   );
    // }
    setEditable(!editable);
  };

  return (
    <div>
      {open && accountSettings && (
        <div className="transition-all duration-300 ease-in-out">
          <div onClick={onClose} className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"></div>

          <div className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-deepPink max-w-70 top-3rem right-4 p-6 rounded-3xl">
            <h2 className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4">ACCOUNT SETTINGS</h2>

            {/* <ul>
            
            <li>
              auto lock timer
            </li>

            <li>
              wallet seed phrase
            </li>

            <li>
              info/help
            </li>

            <li>
              delete wallet
            </li>

            <li>
              fiat currency
            </li>
          </ul> */}

            {/* <ul>
            <li
            >
              {renderTitle(location.hash)}
            </li>
          </ul> */}

            {transitions.map(({ item, props, key }) => (
              <animated.section
                style={{
                  ...props,
                }}
                key={key}
              >
                {renderView(item.hash)}
              </animated.section>
            ))}
          </div>
        </div>
      )}
      
      {open && generalSettings && (
        <div className="transition-all duration-300 ease-in-out">
          <div onClick={onClose} className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"></div>

          <div className="transition-all duration-300 ease-in-out fixed z-10 flex flex-col bg-brand-royalBlue max-w-70 top-3rem right-4 p-6 rounded-3xl">
            <h2 className="pb-4 text-brand-white border-b border-dashed border-brand-graylight w-full text-center mb-4">GENERAL SETTINGS</h2>

            {/* <ul>
            
            <li>
              auto lock timer
            </li>

            <li>
              wallet seed phrase
            </li>

            <li>
              info/help
            </li>

            <li>
              delete wallet
            </li>

            <li>
              fiat currency
            </li>
          </ul> */}

            {/* <ul>
            <li
            >
              {renderTitle(location.hash)}
            </li>
          </ul> */}

            {transitions.map(({ item, props, key }) => (
              <animated.section
                style={{
                  ...props,
                }}
                key={key}
              >
                {renderView(item.hash)}
              </animated.section>
            ))}
          </div>
        </div>
      )}
    </div>
    // <Portal>
    //   <div className={open ? "opacity-1 pointer-events-auto" : "hidden"}>
    //     <div className="opacity-1 transform translate-y-0">
    //       <section >
    //         <IconButton
    //           onClick={handleBackNav}
    //           disabled={!location.hash}
    //         >
    //           {location.hash && <ArrowBackIcon />}
    //         </IconButton>
    // <span
    // >
    //   {renderTitle(location.hash)}
    // </span>
    //         {location.hash === routes.ACCOUNT_VIEW && (
    //           <IconButton
    //             onClick={handleChangeLabel}
    //           >
    //             {editable ? (
    //               <CheckIcon />
    //             ) : (
    //               <EditIcon  />
    //             )}
    //           </IconButton>
    //         )}
    //         <IconButton
    //           onClick={onClose}
    //         >
    //           <CloseIcon />
    //         </IconButton>
    //       </section>
    // {transitions.map(({ item, props, key }) => (
    //   <animated.section
    //     style={{
    //       ...props,
    //       position: 'absolute',
    //       height: '100%',
    //       width: '100%',
    //     }}
    //     key={key}
    //   >
    //     {renderView(item.hash)}
    //   </animated.section>
    // ))}
    //     </div>
    //   </div>
    // </Portal>
  );
};

export default Settings;
