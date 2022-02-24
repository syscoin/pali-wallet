import React, { useState } from 'react';
import { useController, useFormat } from 'hooks/index';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton, Modal } from 'components/index';

const CreateAccount = () => {
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
    <Layout title="CREATE ACCOUNT" id="create-account-title">
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
          className="flex flex-col gap-8 items-center justify-center pt-4 text-center"
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
              className="phrase-input px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full"
              placeholder="Name your new account (optional)"
              id="account-name-input"
            />
          </Form.Item>

          <div className="absolute bottom-12">
            <SecondaryButton
              type="submit"
              loading={loading}
              disabled={loading}
              id="create-btn"
            >
              Create
            </SecondaryButton>
          </div>
        </Form>
      )}
    </Layout>
  );
};

export default CreateAccount;
