import React, { useState } from 'react';
import clsx from 'clsx';
import { useAlert } from 'react-alert';
import { useForm } from 'react-hook-form';
import * as yup from 'yup';
import TextInput from 'components/TextInput';
import { useCopyClipboard, useController } from 'hooks/index';

import styles from './index.scss';

const PhraseView = () => {
  const [checked, setChecked] = useState(false);
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const alert = useAlert();
  const controller = useController();
  const [isCopied, copyText] = useCopyClipboard();
  const { handleSubmit, register } = useForm({
    validationSchema: yup.object().shape({
      password: yup.string().required(),
    }),
  });

  const seedClass = clsx(styles.seed, {
    [styles.copied]: isCopied,
    [styles.notAllowed]: !checked,
  });

  const onSubmit = (data: any) => {
    const res = controller.wallet.getPhrase(data.password);
    if (res) {
      setPhrase(res);
      setChecked(true);
    } else {
      alert.removeAll();
      alert.error('Error: Invalid password');
    }
  };

  const handleCopySeed = () => {
    if (!checked) return;
    copyText(phrase);
  };

  return (
    <div className={styles.phrase}>
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
      <span>Click to copy your seed phrase:</span>
      <div className={seedClass} onClick={handleCopySeed}>
        {phrase}
      </div>
      <span>
        Warning: Keep your seed phrase secret! Anyone with your seed phrase can
        access any account connected to this wallet and steal your assets.
      </span>
    </div>
  );
};

export default PhraseView;
