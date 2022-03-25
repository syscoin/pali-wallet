import React, { useState } from 'react';
import { ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import { Form, Input } from 'antd';
import { Layout, SecondaryButton, DefaultModal } from 'components/index';
import { useNavigate } from 'react-router-dom';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

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
        <Form
          className="flex flex-col gap-8 items-center justify-center pt-4 text-center md:w-full"
          name="newaccount"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
          onFinish={onSubmit}
        >
          <Form.Item
            name="label"
            className="md:w-full"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              className="phrase-input px-4 py-2 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full md:w-full md:max-w-md"
              placeholder="Name your new account (optional)"
              id="account-name-input"
            />
          </Form.Item>

          <div className="absolute bottom-12 md:static">
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
