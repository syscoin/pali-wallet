import React, { useState } from 'react';
import { Layout, SecondaryButton, DefaultModal } from 'components/index';
import { useStore } from 'hooks/index';
import { Form, Input } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getController } from 'utils/browser';

const AutolockView = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const { timer } = useStore();

  const onSubmit = (data: any) => {
    setLoading(true);

    controller.wallet.account.setAutolockTimer(data.minutes);

    setConfirmed(true);
    setLoading(false);
  };

  return (
    <Layout title="AUTO LOCK TIMER" id="auto-lock-timer-title">
      <p className="px-10 py-6 text-white text-sm md:pb-10 md:px-4 md:w-96 md:text-center">
        You can set auto lock timer. Default is 5 minutes after no activity.
        Maximum is 30 minutes.
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

      <Form
        className="flex flex-col gap-8 items-center justify-center text-center"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ minutes: timer }}
        autoComplete="off"
      >
        <Form.Item
          name="minutes"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
              min: 1,
              max: 30,
            },
            () => ({
              validator(_, value) {
                if (value <= 30 && value >= 1) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="number"
            placeholder="Minutes"
            className="px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-96"
          />
        </Form.Item>

        <div className="absolute bottom-12 md:static">
          <SecondaryButton type="submit" loading={loading}>
            Save
          </SecondaryButton>
        </div>
      </Form>
    </Layout>
  );
};

export default AutolockView;
