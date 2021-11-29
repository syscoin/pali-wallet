import React from 'react';
import { useController, useStore, useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { Button } from 'components/index';
import { Layout } from '../../common/Layout';

const CreatePass = () => {
  const controller = useController();

  const { canConnect } = useStore();
  const { history } = useUtils();

  const onSubmit = (data: any) => {
    controller.wallet.setWalletPassword(data.password);
    controller.wallet.createWallet(true);

    if (canConnect) {
      history.push('/connect-wallet');
    } else {
      history.push('/home');
    }
  };

  return (
    <Layout
      title="Password"
      onlySection
    >
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <Form.Item
          name="password"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            {
              pattern: /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
              message: ''
            }
          ]}
        >
          <Input.Password placeholder="New password (min 8 chars)" />
        </Form.Item>

        <Form.Item
          name="repassword"
          dependencies={['password']}
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
          <Input.Password placeholder="Confirm password" />
        </Form.Item>

        <span className="font-light text-brand-graylight text-xs">
          At least 8 characters, 1 lower-case and 1 numeral.
        </span>

        <span className="text-center font-light text-brand-royalBlue text-xs mx-10">
          Do not forget to save your password. You will need this password to unlock your wallet.
        </span>

        <Button
          type="submit"
          classNameBorder="absolute bottom-12"
        >
          Next
        </Button>
      </Form>
    </Layout>
  );
};

export default CreatePass;