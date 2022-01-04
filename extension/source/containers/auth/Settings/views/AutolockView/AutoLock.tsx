import React, { useState } from 'react';
import { PrimaryButton, Modal } from 'components/index';;
import { useController, useStore } from 'hooks/index';

import { Form, Input } from 'antd';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';

const AutolockView = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = useController();

  const { timer } = useStore();

  const onSubmit = (data: any) => {
    console.log(confirmed)
    setLoading(true);

    controller.wallet.account.setAutolockTimer(data.minutes);

    setConfirmed(true);
    setLoading(false);

    console.log(confirmed)
  };

  return (
    <AuthViewLayout title="AUTO LOCK TIMER">
      <p className="text-white text-sm py-6 px-10">You can set auto lock timer. Default is 5 minutes after no activity. Maximum is 30 minutes.</p>

      {confirmed && (
        <Modal
          type="default"
          open={confirmed}
          onClose={() => setConfirmed(false)}
          title="Time set successfully"
          description={`Your auto lock was configured successfully. You can change it at any time.`}
        />
      )}

      <Form
        className="flex justify-center items-center flex-col gap-8 text-center pt-4"
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
          ]}
        >
          <Input
            type="number"
            placeholder="Minutes"
            className="ant-input ant-input rounded-full py-3 px-4 w-72 bg-bkg-3 border border-brand-royalblue text-sm outline-none"
          />
        </Form.Item>

        <div className="absolute bottom-12">
          <PrimaryButton
            type="submit"
            loading={loading}
          >
            Save
          </PrimaryButton>
        </div>
      </Form>
    </AuthViewLayout>
  );
};

export default AutolockView;
