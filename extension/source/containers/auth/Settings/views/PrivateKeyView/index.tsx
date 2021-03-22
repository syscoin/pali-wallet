import React, { useState, FC } from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';
import { useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';

import TextInput from 'components/TextInput';
import { useController, useCopyClipboard } from 'hooks/index';
import { ellipsis } from 'containers/auth/helpers';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';

import styles from './index.scss';

interface IPrivateKeyView {
  id: string;
}

const PrivateKeyView: FC<IPrivateKeyView> = ({ id }) => {
  const controller = useController();
  const alert = useAlert();
  const { accounts }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      password: yup.string().required(),
    }),
  });

  const [isCopied, copyText] = useCopyClipboard();
  const [checked, setChecked] = useState(false);
  const [isCopiedAddress, copyAddress] = useState(false);
  const [privKey, setPrivKey] = useState<string>(
    '*************************************************************'
  );

  const addressClass = clsx(styles.address, {
    [styles.copied]: isCopied && isCopiedAddress,
  });
  const privKeyClass = clsx(styles.privKey, {
    [styles.copied]: isCopied && !isCopiedAddress,
    [styles.notAllowed]: !checked,
  });

  const onSubmit = async (data: any) => {
    const res = await controller.wallet.account.getPrivKey(id, data.password);
    if (res) {
      setPrivKey(res);
      setChecked(true);
    } else {
      alert.removeAll();
      alert.error('Error: Invalid password');
    }
  };

  const handleCopyPrivKey = () => {
    if (!checked) return;
    copyAddress(false);
    copyText(privKey);
  };

  return (
    <div className={styles.wrapper}>
      {accounts[id] && (
        <>
          <div className={styles.heading}>
            <div>Click to copy your public key:</div>
            <span
              className={addressClass}
              onClick={() => {
                copyText(accounts[id].address.constellation);
                copyAddress(true);
              }}
            >
              {ellipsis(accounts[id].address.constellation)}
            </span>
          </div>
          <div className={styles.content}>
            <span>Please input your wallet password and press enter:</span>
            <form onSubmit={handleSubmit(onSubmit)}>
              <TextInput
                type="password"
                name="password"
                visiblePassword
                fullWidth
                inputRef={register}
                variant={styles.input}
              />
            </form>
            <span>Click to copy your private key:</span>
            <div className={privKeyClass} onClick={handleCopyPrivKey}>
              {privKey}
            </div>
            <span>
              Warning: Keep your keys secret! Anyone with your private keys can
              steal your assets .
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default PrivateKeyView;
