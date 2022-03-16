import React, { useState } from 'react';
import clsx from 'clsx';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useCopyClipboard, useSettingsView } from 'hooks/index';
import { ellipsis } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import { MAIN_VIEW } from '../routes';

import styles from './index.scss';

const NewAccountView = () => {
  const [address, setAddress] = useState<string | undefined>();
  const controller = useController();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string(),
    }),
  });
  const [isCopied, copyText] = useCopyClipboard();
  const [loading, setLoading] = useState<boolean>(false);
  const showView = useSettingsView();

  const addressClass = clsx(styles.address, {
    [styles.copied]: isCopied && address,
  });

  const onSubmit = async (data: any) => {
    setLoading(true);
    const res = await controller.wallet.addNewAccount(data.name);

    if (res) {
      setAddress(res);
      setLoading(false);

      await controller.wallet.account.updateTokensState();
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
              theme="btn-gradient-primary"
              variant={styles.button}
              onClick={() => showView(MAIN_VIEW)}
            >
              Finish
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <span>Please name your new account if you want:</span>
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
              theme="btn-outline-secondary"
              variant={clsx(styles.button, styles.close)}
              onClick={() => showView(MAIN_VIEW)}
            >
              Close
            </Button>
            {loading ? (
              <div className={styles.loading}>
                <Spinner size={22} className={styles.spinner} />
              </div>
            ) : (
              <Button
                type="submit"
                theme="btn-gradient-primary"
                variant={styles.button}
                disabled={loading}
              >
                Next
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
};

export default NewAccountView;
