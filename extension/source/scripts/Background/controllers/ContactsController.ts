import store from 'state/store';
import {
  addContactAddress,
  deleteContactAddress,
  updateContactAddress,
} from 'state/contacts';

export interface IContactsController {
  modifyContact: (
    type: 'add' | 'edit',
    name: string,
    address: string,
    memo: string,
    id?: string
  ) => void;
  deleteContact: (id: string) => void;
}

const ContactsController = (actions: {
  isLocked: () => boolean;
}): IContactsController => {
  const modifyContact = (
    type: 'add' | 'edit',
    name: string,
    address: string,
    memo: string,
    id?: string
  ) => {
    if (actions.isLocked()) return;
    if (type === 'add') {
      store.dispatch(addContactAddress({ name, address, memo }));
    } else if (id) {
      store.dispatch(updateContactAddress({ id, name, address, memo }));
    }
  };

  const deleteContact = (id: string) => {
    if (actions.isLocked()) return;
    store.dispatch(deleteContactAddress({ id }));
  };

  return {
    modifyContact,
    deleteContact,
  };
};

export default ContactsController;
