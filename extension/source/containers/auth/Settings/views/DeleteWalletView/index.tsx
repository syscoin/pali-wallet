import React from 'react';
import { useAlert } from 'react-alert';
import { useHistory } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController } from 'hooks/index';

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

      return;
    }

    alert.removeAll();
    alert.error('Error: Invalid password');
  };

  return (
    <div >
      <form onSubmit={handleSubmit(onSubmit)}>
        <span>
          <b>Warning:</b> this action will delete your wallet and all accounts
          associated with this wallet. Please make sure to back up your Wallet
          seed phase if you would like to access this wallet and associated
          accounts in the future.
        </span>
        <span>Please enter your wallet password:</span>
        <TextInput
          placeholder="password"
          inputRef={register}
        />
        <div>
          <Button
            type="button"
            onClick={() => history.goBack()}
          >
            Close
          </Button>
          <Button
            type="submit"
          >
            Delete
          </Button>
        </div>
      </form>
    </div>
  );
};

export default DeleteWalletView;
