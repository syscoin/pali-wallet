import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = async ({ label }: { label?: string }) => {
    setLoading(true);

    const { address: newAddress } = await controller.wallet.createAccount(
      label
    );

    setAddress(newAddress);
    setLoading(false);
  };

  const { register, handleSubmit } = useForm({
    defaultValues: {
      label: '',
    },
  });

  return (
    <Layout title="CREATE ACCOUNT">
      {address ? (
        <DefaultModal
          show={address !== ''}
          onClose={() => {
            setAddress('');
            navigate('/home');
          }}
          title="Your new account has been created"
          description={`${ellipsis(address)}`}
        />
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
        >
          <input
            type="text"
            placeholder="Name your new account (optional)"
            className="input-small relative md:w-full"
            {...register('label', {
              required: false,
            })}
          />

          <NeutralButton
            className="absolute bottom-12 md:static"
            type="submit"
            loading={loading}
            disabled={loading}
          >
            Create
          </NeutralButton>
        </form>
      )}
    </Layout>
  );
};

export default CreateAccount;
