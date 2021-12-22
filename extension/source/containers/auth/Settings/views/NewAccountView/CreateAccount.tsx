import React, { useState } from 'react';
import { useController, useFormat } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { PrimaryButton, Modal } from 'components/index';

const NewAccountView = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);

  const controller = useController();

  const { ellipsis } = useFormat();

  const onSubmit = async (data: any) => {
    setLoading(true);

    const response = await controller.wallet.addNewAccount(data.label);

    if (response) {
      setAddress(response);
      setLoading(false);

      await controller.wallet.account.updateTokensState();
    }
  };

  return (
    <AuthViewLayout title="CREATE ACCOUNT">
      {address ? (
        <Modal
          type="default"
          open={address !== ''}
          onClose={() => setAddress('')}
          title="Your new account has been created"
          description={`${ellipsis(address)}`}
        />
      ) : (
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center pt-4 mt-8"
          name="newaccount"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
          onFinish={onSubmit}
        >
          <Form.Item
            name="label"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              className="phrase-input rounded-full py-3 px-4 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
              placeholder="Name your new account (optional)"
            />
          </Form.Item>

          <div className="absolute bottom-12">
            <PrimaryButton
              type="submit"
              loading={loading}
              disabled={loading}
            >
              Create
            </PrimaryButton>
          </div>
        </Form>
      )}
    </AuthViewLayout>
  );
};

export default NewAccountView;
