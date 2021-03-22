import React, { ChangeEvent, FC, useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import clsx from 'clsx';
import { useHistory } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useAlert } from 'react-alert';

import Button from 'components/Button';
import TextInput from 'components/TextInput';
import { useController, useSettingsView } from 'hooks/index';
import IContactBookState from 'state/contacts/types';
import { RootState } from 'state/store';
import { CONTACTS_VIEW } from '../routes';
import VerifiedIcon from 'assets/images/svg/check-green.svg';
import styles from './index.scss';
interface IModifyContactView {
  type: 'add' | 'edit';
  selected?: string;
}

const ModifyContactView: FC<IModifyContactView> = ({ type, selected }) => {
  const controller = useController();
  const showView = useSettingsView();
  const history = useHistory();
  const alert = useAlert();
  const contacts: IContactBookState = useSelector(
    (state: RootState) => state.contacts
  );
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string().required(),
      address: yup.string().required(),
      memo: yup.string(),
    }),
  });
  const [address, setAddress] = useState('');

  const isValidAddress = useMemo(() => {
    return controller.wallet.account.isValidDAGAddress(address);
  }, [address]);

  const statusIconClass = clsx(styles.statusIcon, {
    [styles.hide]: !isValidAddress,
  });

  const handleAddressChange = useCallback(
    (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setAddress(ev.target.value.trim());
    },
    []
  );

  const onSubmit = (data: any) => {
    if (!isValidAddress) {
      alert.removeAll();
      alert.error('Error: Invalid recipient address');
      return;
    }

    if (!controller.wallet.account.isValidDAGAddress(data.address.trim()))
      return;
    controller.contacts.modifyContact(
      type,
      data.name,
      data.address.trim(),
      data.memo,
      selected
    );
    showView(CONTACTS_VIEW);
  };

  return (
    <form className={styles.wrapper} onSubmit={handleSubmit(onSubmit)}>
      <span>Contact Name</span>
      <TextInput
        name="name"
        fullWidth
        variant={styles.input}
        defaultValue={selected && contacts[selected].name}
        inputRef={register}
      />
      <span>Address</span>
      <div className={styles.inputWrap}>
        <img
          src={`/${VerifiedIcon}`}
          alt="checked"
          className={statusIconClass}
        />
        <TextInput
          name="address"
          fullWidth
          value={address}
          variant={clsx(styles.input, { [styles.verfied]: isValidAddress })}
          defaultValue={selected && contacts[selected].address}
          onChange={handleAddressChange}
          inputRef={register}
        />
      </div>
      <span>Memo</span>
      <TextInput
        name="memo"
        fullWidth
        multiline
        variant={styles.textarea}
        defaultValue={selected && contacts[selected].memo}
        inputRef={register}
      />
      <div className={styles.actions}>
        <Button
          type="button"
          variant={styles.cancel}
          onClick={() => history.goBack()}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={styles.save}
          disabled={!address || !isValidAddress}
        >
          Save
        </Button>
      </div>
    </form>
  );
};

export default ModifyContactView;
