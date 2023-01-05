import React, { useEffect } from 'react';
import { useForm, FieldValues } from 'react-hook-form';

import { Layout, Card, CopyCard, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

const PhraseView = () => {
  const {
    handleSubmit,
    register,
    formState: { isValid },
    getValues,
  } = useForm();

  const { useCopyClipboard, navigate, alert } = useUtils();
  const controller = getController();
  const [copied, copyText] = useCopyClipboard();

  const onSubmit = (data: FieldValues) =>
    controller.wallet.getSeed(data.password);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Seed phrase successfully copied');
  }, [copied]);

  return (
    <Layout title="WALLET SEED PHRASE">
      <form
        className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
        onSubmit={handleSubmit(onSubmit)}
      >
        <input
          type="password"
          placeholder="Enter your password"
          className="input-small relative md:w-full"
          {...register('password', {
            validate: {
              checkPwd: (pwd: string) => controller.wallet.checkPassword(pwd),
            },
          })}
        />

        <CopyCard
          onClick={isValid ? () => copyText(onSubmit(getValues())) : undefined}
          label="Your seed phrase"
        >
          <p>{isValid ? onSubmit(getValues()) : '********...************'}</p>
        </CopyCard>

        <Card type="info">
          <p>
            <b className="text-warning-info">WARNING:</b> Keep your seed phrase
            secret! Anyone with your seed phrase can access any account
            connected to this wallet and steal your assets
          </p>
        </Card>

        <NeutralButton
          className="absolute bottom-12 md:static md:mt-10"
          type="button"
          onClick={() => navigate('/home')}
        >
          Close
        </NeutralButton>
      </form>
    </Layout>
  );
};

export default PhraseView;
