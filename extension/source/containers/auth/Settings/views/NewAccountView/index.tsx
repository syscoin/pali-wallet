import React, { useState } from 'react';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';

import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useCopyClipboard, useSettingsView } from 'hooks/index';

import styles from './index.scss';
import { ellipsis } from 'containers/auth/helpers';
import { MAIN_VIEW } from '../routes';

const NewAccountView = () => {
  const [address, setAddress] = useState<string | undefined>();
  const controller = useController();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string().required(),
    }),
  });
  const [isCopied, copyText] = useCopyClipboard();
  const showView = useSettingsView();

  const addressClass = clsx(styles.address, {
    [styles.copied]: isCopied && address,
  });

  const onSubmit = async (data: any) => {
    const res = await controller.wallet.account.addNewAccount(data.name);
    if (res) {
      setAddress(res);
    }
  };

  return (
    <div className={styles.newAccount}>
      {address ? (
        <>
          <span>Your new account has been created</span>
          <span>Click to copy your public address:</span>
          <span
            className={addressClass}
            onClick={() => {
              copyText(address);
            }}
          >
            {ellipsis(address)}
          </span>
          <div className={clsx(styles.actions, styles.centered)}>
            <Button
              type="button"
              variant={styles.button}
              onClick={() => showView(MAIN_VIEW)}
            >
              Finish
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <span>Please name your new account:</span>
          <TextInput
            type="text"
            name="name"
            fullWidth
            variant={styles.input}
            inputRef={register}
          />
          <div className={styles.actions}>
            <Button
              type="button"
              theme="secondary"
              variant={clsx(styles.button, styles.close)}
              onClick={() => showView(MAIN_VIEW)}
            >
              Close
            </Button>
            <Button type="submit" variant={styles.button}>
              Next
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default NewAccountView;
