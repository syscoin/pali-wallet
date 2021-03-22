import React, { FC } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';

import Button from 'components/Button';
import Icon from 'components/Icon';
import { useSettingsView } from 'hooks/index';
import { RootState } from 'state/store';
import IContactBookState, { IContactState } from 'state/contacts/types';
import UserIcon from '@material-ui/icons/AccountCircleRounded';
import SendIcon from '@material-ui/icons/Send';
import IconButton from '@material-ui/core/IconButton';

import { ADD_CONTACT_VIEW, CONTACT_VIEW } from '../routes';
import styles from './index.scss';

interface IContactsView {
  onSelect: (id: string) => void;
}

const ContactsView: FC<IContactsView> = ({ onSelect }) => {
  const contacts: IContactBookState = useSelector(
    (state: RootState) => state.contacts
  );
  const showView = useSettingsView();
  const history = useHistory();

  const handleSelect = (id: string) => {
    onSelect(id);
    showView(CONTACT_VIEW);
  };
  const handleSelectedContact = (ev: any, address: string) => {
    ev.stopPropagation();
    history.push(`/send/${address}`);
  };

  return (
    <div className={styles.contacts}>
      <div className={styles.actions}>
        <Button
          type="button"
          variant={styles.add}
          onClick={() => showView(ADD_CONTACT_VIEW)}
        >
          Add contact
        </Button>
      </div>
      <ul className={styles.list}>
        {Object.values(contacts).map((contact: IContactState) => (
          <li onClick={() => handleSelect(contact.id)} key={contact.id}>
            <div className={styles.contact}>
              <span className={styles.info}>
                <Icon Component={UserIcon} />
                <div>
                  {contact.name}
                  <small>{contact.address}</small>
                </div>
              </span>
              <IconButton
                className={styles.send}
                onClick={(ev) => handleSelectedContact(ev, contact.address)}
              >
                <SendIcon />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ContactsView;
