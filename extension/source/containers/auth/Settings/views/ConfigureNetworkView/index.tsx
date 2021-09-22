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

const ConfigureNetworkView = () => {
  const [address, setAddress] = useState<string | undefined>();
  const controller = useController();
  // const { handleSubmit, register } = useForm({
  //   validationSchema: yup.object().shape({
  //     name: yup.string().required(),
  //   }),
  // });
  const [isCopied, copyText] = useCopyClipboard();
  const [loading, setLoading] = useState<boolean>(false);
  const showView = useSettingsView();

  const addressClass = clsx(styles.address, {
    [styles.copied]: isCopied && address,
  });

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
    <div className={styles.configureNetworkWrapper}>
    </div>
  );
};

export default ConfigureNetworkView;
