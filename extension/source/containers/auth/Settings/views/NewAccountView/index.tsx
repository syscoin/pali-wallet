import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import { useController, useSettingsView } from 'hooks/index';
import { ellipsis } from 'containers/auth/helpers';
import Spinner from '@material-ui/core/CircularProgress';

import { MAIN_VIEW } from '../routes';

const NewAccountView = () => {
  const [address, setAddress] = useState<string | undefined>();
  const controller = useController();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      name: yup.string().required(),
    }),
  });
  // const [isCopied, copyText] = useCopyClipboard();
  const [loading, setLoading] = useState<boolean>(false);
  const showView = useSettingsView();

  // const addressClass = clsx(styles.address, {
  //   [styles.copied]: isCopied && address,
  // });

  const onSubmit = async (data: any) => {
    setLoading(true);
    const res = await controller.wallet.account.addNewAccount(data.name);

    if (res) {
      setAddress(res);
      setLoading(false);

      await controller.wallet.account.updateTokensState();
    }
  };

  return (
    <div >
      {address ? (
        <>
          <span>Your new account has been created</span>
          <span>Click to copy your public address:</span>
          <span
            // onClick={() => {
            //   copyText(address);
            // }}
          >
            {ellipsis(address)}
          </span>
          <div>
            <Button
              type="button"
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
            placeholder="account"
            inputRef={register}
          />
          <div>
            <Button
              type="button"
              onClick={() => showView(MAIN_VIEW)}
            >
              Close
            </Button>
            {loading ? (
              <div>
                <Spinner size={22} />
              </div>
            ) : (
              <Button
                type="submit"
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
