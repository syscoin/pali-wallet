import React from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';
import { useHistory } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';

import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController } from 'hooks/index';

import styles from './index.scss';

const DeleteWalletView = () => {
  const controller = useController();
  const history = useHistory();
  const alert = useAlert();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      password: yup.string().required(),
    }),
  });

  const onSubmit = (data: any) => {
    if (controller.wallet.checkPassword(data.password)) {
      controller.wallet.deleteWallet(data.password);
      history.push('/app.html');
    } else {
      alert.removeAll();
      alert.error('Error: Invalid password');
    }
  };

  return (
    <div className={styles.deleteWallet}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <span>
          <b>Warning:</b> this action will delete your wallet and all accounts
          associated with this wallet. Please make sure to back up your Wallet
          seed phase if you would like to access this wallet and associated
          accounts in the future.
        </span>
        <span>Please enter your wallet password:</span>
        <TextInput
          type="password"
          name="password"
          visiblePassword
          fullWidth
          inputRef={register}
          variant={styles.input}
        />
        <div className={styles.actions}>
          <Button
            type="button"
            theme="secondary"
            variant={clsx(styles.button, styles.close)}
            onClick={() => history.goBack()}
          >
            Close
          </Button>
          <Button type="submit" variant={styles.button}>
            Delete
          </Button>
        </div>
      </form>
    </div>
  );
};

export default DeleteWalletView;
