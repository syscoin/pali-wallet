import React, {
  FC,
  useState,
  useEffect,
  KeyboardEvent,
  ChangeEvent,
} from 'react';
import clsx from 'clsx';
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
import * as Views from './views';
import * as routes from './views/routes';

import TextInput from 'components/TextInput';
import { useController } from 'hooks/index';
import styles from './Settings.scss';

interface ISettings {
  open: boolean;
  onClose?: () => void;
}

const Settings: FC<ISettings> = ({ open, onClose }) => {
  const location = useLocation();
  const history = useHistory();
  const controller = useController();
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
  const [selectedContact, setSelectedContact] = useState<string>('');
  const [editable, setEditable] = useState(false);
  const [showedLabel, setShowedLabel] = useState('');

  useEffect(() => {
    if (location.hash !== routes.ACCOUNT_VIEW && editable) {
      setEditable(false);
    }
  }, [location.hash]);

  const renderTitle = (view: string) => {
    switch (view) {
      case routes.ACCOUNT_VIEW:
        return editable ? (
          <TextInput
            value={showedLabel}
            variant={styles.accLabel}
            onChange={(
              ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
            ) => setShowedLabel(ev.target.value)}
            onKeyDown={(ev: KeyboardEvent<HTMLInputElement>) => {
              if (ev.key === 'Enter') {
                setShowedLabel(ev.currentTarget.value);
                handleChangeLabel();
              }
            }}
          />
        ) : (
          accounts[showedId].label
        );
      case routes.GENERAL_VIEW:
        return 'General Settings';
      case routes.PHRASE_VIEW:
        return 'Wallet seed phrase';
      case routes.DELETE_WALLET_VIEW:
        return 'Delete wallet';
      case routes.NEW_ACCOUNT_VIEW:
        return 'Create account';
      case routes.REMOVE_ACCOUNT_VIEW:
        return 'Remove account';
      case routes.PRIV_KEY_VIEW:
        return 'Export private key';
      case routes.ABOUT_VIEW:
        return 'About';
      case routes.CONTACTS_VIEW:
        return 'Contacts';
      case routes.CONTACT_VIEW:
        return 'Contact';
      case routes.ADD_CONTACT_VIEW:
        return 'Add Contact';
      case routes.EDIT_CONTACT_VIEW:
        return 'Edit Contact';
      case routes.IMPORT_ACCOUNT_VIEW:
        return 'Import private key';
      default:
        return 'Settings';
    }
  };

  const renderView = (view: string) => {
    switch (view) {
      case routes.ACCOUNT_VIEW:
        return <Views.AccountView address={accounts[showedId].address} />;
      case routes.GENERAL_VIEW:
        return <Views.GeneralView />;
      case routes.PHRASE_VIEW:
        return <Views.PhraseView />;
      case routes.DELETE_WALLET_VIEW:
        return <Views.DeleteWalletView />;
      case routes.NEW_ACCOUNT_VIEW:
        return <Views.NewAccountView />;
      case routes.REMOVE_ACCOUNT_VIEW:
        return <Views.RemoveAccountView id={showedId} />;
      case routes.PRIV_KEY_VIEW:
        return <Views.PrivateKeyView id={showedId} />;
      case routes.ABOUT_VIEW:
        return <Views.AboutView />;
      case routes.CONTACTS_VIEW:
        return (
          <Views.ContactsView
            onSelect={(id: string) => setSelectedContact(id)}
          />
        );
      case routes.ADD_CONTACT_VIEW:
        return <Views.ModifyContactView type="add" />;
      case routes.EDIT_CONTACT_VIEW:
        return (
          <Views.ModifyContactView type="edit" selected={selectedContact} />
        );
      case routes.CONTACT_VIEW:
        return <Views.ContactView selected={selectedContact} />;
      case routes.IMPORT_ACCOUNT_VIEW:
        return <Views.ImportAccountView />;
      default:
        return <Views.MainView onChange={(id: string) => setShowedId(id)} />;
    }
  };

  const handleBackNav = () => {
    history.goBack();
  };

  const handleChangeLabel = () => {
    if (!editable) {
      setShowedLabel(accounts[showedId].label);
    } else {
      controller.wallet.account.updateAccountLabel(showedId, showedLabel);
    }
    setEditable(!editable);
  };

  return (
    <Portal>
      <div className={clsx(styles.mask, { [styles.open]: open })}>
        <div className={styles.modal}>
          <section className={styles.heading}>
            <IconButton
              className={styles.navBtn}
              onClick={handleBackNav}
              disabled={!location.hash}
            >
              {location.hash && <ArrowBackIcon className={styles.icon} />}
            </IconButton>
            <span
              className={clsx(styles.title, {
                [styles.account]: location.hash !== routes.ACCOUNT_VIEW,
              })}
            >
              {renderTitle(location.hash)}
            </span>
            {location.hash === routes.ACCOUNT_VIEW && (
              <IconButton
                className={styles.editBtn}
                onClick={handleChangeLabel}
              >
                {editable ? (
                  <CheckIcon className={styles.icon} />
                ) : (
                  <EditIcon className={styles.icon} />
                )}
              </IconButton>
            )}
            <IconButton
              className={clsx(styles.navBtn, styles.closeBtn)}
              onClick={onClose}
            >
              <CloseIcon className={styles.icon} />
            </IconButton>
          </section>
          {transitions.map(({ item, props, key }) => (
            <animated.section
              className={styles.content}
              style={{
                ...props,
                position: 'absolute',
                height: '100%',
                width: '100%',
              }}
              key={key}
            >
              {renderView(item.hash)}
            </animated.section>
          ))}
        </div>
      </div>
    </Portal>
  );
};

export default Settings;
