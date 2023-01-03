import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const AutolockView = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const timer = useSelector((state: RootState) => state.vault.timer);

  const { register, handleSubmit } = useForm({
    defaultValues: {
      minutes: timer,
    },
  });

  const onSubmit = (data: { minutes: number }) => {
    setLoading(true);

    controller.wallet.setAutolockTimer(data.minutes);

    setConfirmed(true);
    setLoading(false);
  };

  return (
    <Layout title="AUTO LOCK TIMER">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
      >
        <p className="text-white text-sm">
          Default timer is 5 minutes after no activity. Maximum is 30 minutes.
        </p>

        <DefaultModal
          show={confirmed}
          onClose={() => {
            setConfirmed(false);
            navigate('/home');
          }}
          title="Time set successfully"
          description="Your auto lock was configured successfully. You can change it at any time."
        />

        <input
          type="number"
          placeholder="Minutes"
          className="input-small relative md:w-full"
          {...register('minutes', {
            validate: {
              lessThanThirty: (value) => value <= 30,
              greaterThanOne: (value) => value > 1,
            },
          })}
        />

        <NeutralButton
          className="absolute bottom-12 md:static"
          type="submit"
          loading={loading}
        >
          Save
        </NeutralButton>
      </form>
    </Layout>
  );
};

export default AutolockView;
