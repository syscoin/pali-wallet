import React, { FC } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';
import Portal from '@reach/portal';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';
import UserIcon from '@material-ui/icons/AccountCircleRounded';

import Icon from 'components/Icon';
import { RootState } from 'state/store';
import IContactBookState, { IContactState } from 'state/contacts/types';

import styles from './Contacts.scss';

interface IWalletContacts {
  open: boolean;
  onClose?: () => void;
  onChange: (address: string) => void;
}

const WalletContacts: FC<IWalletContacts> = ({ open, onClose, onChange }) => {
  const contacts: IContactBookState = useSelector(
    (state: RootState) => state.contacts
  );

  return (
    <Portal>
      <div className={clsx(styles.mask, { [styles.open]: open })}>
        <div className={styles.modal}>
          <section className={styles.heading}>
            <span className={styles.title}>Contacts</span>
            <IconButton
              className={clsx(styles.navBtn, styles.closeBtn)}
              onClick={onClose}
            >
              <CloseIcon className={styles.icon} />
            </IconButton>
          </section>
          <section className={styles.container}>
            <ul className={styles.list}>
              {Object.values(contacts).map((contact: IContactState) => (
                <li key={contact.id} onClick={() => onChange(contact.address)}>
                  <div className={styles.contact}>
                    <span className={styles.info}>
                      <Icon Component={UserIcon} />
                      <div>
                        {contact.name}
                        <small>{contact.address}</small>
                      </div>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Portal>
  );
};

export default WalletContacts;
