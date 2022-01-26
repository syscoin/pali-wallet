import React, { useState } from 'react';
import { SecondaryButton, Modal } from 'components/index';
import { useController, useStore } from 'hooks/index';
import { Form, Input } from 'antd';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';

const AutolockView = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = useController();

  const { timer } = useStore();

  const onSubmit = (data: any) => {
    setLoading(true);

    controller.wallet.account.setAutolockTimer(data.minutes);

    setConfirmed(true);
    setLoading(false);
  };

  return (
    <AuthViewLayout title="AUTO LOCK TIMER" id="auto-lock-timer-title">
      <p className="text-white text-sm py-6 px-10">
        You can set auto lock timer. Default is 5 minutes after no activity.
        Maximum is 30 minutes.
      </p>

      {confirmed && (
        <Modal
          type="default"
          open={confirmed}
          onClose={() => setConfirmed(false)}
          title="Time set successfully"
          description="Your auto lock was configured successfully. You can change it at any time."
        />
      )}

      <Form
        className="flex justify-center items-center flex-col gap-8 text-center"
        name="autolock"
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
            className="rounded-full py-2 px-4 w-72 bg-fields-input-primary border border-fields-input-border text-sm focus:border-fields-input-borderfocus"
          />
        </Form.Item>

        <div className="absolute bottom-12">
          <SecondaryButton type="submit" loading={loading}>
            Save
          </SecondaryButton>
        </div>
      </Form>
    </AuthViewLayout>
  );
};

export default AutolockView;
