import React, { useState } from 'react';
import TextInput from 'components/TextInput';
import Button from 'components/Button';
import Link from 'components/Link';
import { useForm } from 'react-hook-form';
import { useController } from 'hooks/index';
import LogoImage from 'assets/images/logo.svg';

import { schema } from './consts';
import styles from './Start.scss';

const Starter = () => {
  const controller = useController();
  const { handleSubmit, register, errors } = useForm({
    validationSchema: schema,
  });
  const [isInvalid, setInvalid] = useState<boolean>(false);

  const onSubmit = (data: any) => {
    setInvalid(!controller.wallet.unLock(data.password));
  };

  return (
    <div className={styles.home}>
      <h1 className="heading-start full-width t-roboto t-royalBlue">
        <p>Welcome to</p>
        <br />
        Pali Wallet
      </h1>
      <img src={LogoImage} className={styles.logo} alt="syscoin" />
      <form onSubmit={handleSubmit(onSubmit)}>
        <TextInput
          type="password"
          name="password"
          visiblePassword
          fullWidth
          inputRef={register}
          placeholder="Please enter your password"
          variant={styles.password}
        />
        {errors.password ? (
          <span className={styles.error}>{errors.password.message}</span>
        ) : (
          isInvalid && (
            <span className={styles.error}>Error: Invalid password</span>
          )
        )}
        <Button
          type="submit"
          theme="btn-gradient-primary"
          variant={styles.unlock}
        >
          Unlock
        </Button>
      </form>
      <Link color="tertiary" to="/import">
        Import using wallet seed phrase
      </Link>
    </div>
  );
};

export default Starter;
