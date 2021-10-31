import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import Button from 'components/Button';
import TextInput from 'components/TextInput';
import CheckIcon from '@material-ui/icons/CheckCircle';
import { useForm } from 'react-hook-form';
import { useController } from 'hooks/index';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

import Layout from '../Layout';

import * as consts from './consts';

const CreatePass = () => {
  const history = useHistory();
  const controller = useController();
  const [passed, setPassed] = useState<boolean>(false);
  const { handleSubmit, register, errors } = useForm({
    validationSchema: consts.schema,
  });
  const title = passed ? consts.CREATE_PASS_TITLE2 : consts.CREATE_PASS_TITLE1;
  const comment = passed
    ? consts.CREATE_PASS_COMMENT2
    : consts.CREATE_PASS_COMMENT1;

  const { tabs }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const nextHandler = () => {
    if (passed) {
      controller.wallet.createWallet(true);

      if (tabs.canConnect) {
        history.push('/connect-wallet');
      } else {
        history.push('/home');
      }
    }
  };

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    setPassed(true);
  };

  return (
    <Layout title={title} linkTo="/app.html">
      <form onSubmit={handleSubmit(onSubmit)}>
        {passed ? (
          <CheckIcon/>
        ) : (
          <>
            <TextInput
              inputType="password"
              placeholder="Please enter at least 8 characters"
              createPass
              inputRef={register}
            />
            <span >
              At least 8 characters, 1 lower-case, 1 numeral.
            </span>
            {(errors.password || errors.repassword) && (
              <span >
                {errors.password
                  ? errors.password.message
                  : errors.repassword.message}
              </span>
            )}
          </>
        )}
        <span >{comment}</span>
        <Button
          type={passed ? 'button' : 'submit'}
          theme="btn-gradient-primary"
          onClick={nextHandler}
        >
          Next
        </Button>
      </form>
    </Layout>
  );
};

export default CreatePass;
