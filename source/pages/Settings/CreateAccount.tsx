import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

const CreateAccount = () => {
  const [address, setAddress] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = async ({ label }: { label?: string }) => {
    setLoading(true);

    const { address: newAddress } = await controller.wallet.createAccount(
      isBitcoinBased,
      label
    );

    setAddress(newAddress);
    setLoading(false);
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
          validateMessages={{ default: '' }}
          className="flex flex-col gap-8 items-center justify-center text-center md:w-full"
          name="newaccount"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
          onFinish={onSubmit}
        >
          <Form.Item
            name="label"
            className="md:w-full"
            hasFeedback
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
          >
            <Input
              type="text"
              className="input-small relative"
              placeholder="Name your new account (optional)"
              id="account-name-input"
            />
          </Form.Item>

          <div className="absolute bottom-12 md:static">
            <NeutralButton
              type="submit"
              loading={loading}
              disabled={loading}
              id="create-btn"
            >
              Create
            </NeutralButton>
          </div>
        </Form>
      )}
    </Layout>
  );
};

export default CreateAccount;
