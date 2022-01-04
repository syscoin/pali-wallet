import React from 'react';
import { useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import { Form, Input } from 'antd';
import { PrimaryButton } from 'components/index';
import { Layout } from 'containers/common/Layout';

export const CreatePass = () => {
  const history = useHistory();
  const controller = useController();

  const onSubmit = (data: any) => {
    try {
      controller.wallet.setWalletPassword(data.password);

      history.push('/create/phrase/generated');
    } catch (error) {
      console.log('error', error);
    }
  };

  return (
    <Layout title="Password" onlySection>
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-1 mt-8 text-center"
      >
        <Form.Item
          name="password"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            {
              pattern: /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/,
              message: '',
            },
          ]}
        >
          <Input.Password
            className="placeholder-royalBlue"
            placeholder="New password (min 8 chars)"
          />
        </Form.Item>

        <Form.Item
          className="pt-4"
          name="repassword"
          dependencies={['password']}
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
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

        <span className="text-brand-graylight text-xs mt-3">
          At least 8 characters, 1 lower-case and 1 numeral.
        </span>

        <span className="text-center text-brand-royalblue text-xs mx-8 pt-4">
          Do not forget to save your password. You will need this password to
          unlock your wallet.
        </span>

        <div className="absolute bottom-12">
          <PrimaryButton
            type="submit"
          >
            Next
          </PrimaryButton>
        </div>


      </Form>
    </Layout>
  );
};
