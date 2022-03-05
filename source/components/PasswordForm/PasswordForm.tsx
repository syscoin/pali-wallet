import React from 'react';
import { Layout } from 'containers/common/Layout';
import { Form, Input } from 'antd';
import { PrimaryButton } from 'components/index';

export const PasswordForm = ({ onSubmit }: { onSubmit: any }) => (
  <Layout title="Password" onlySection>
    <Form
      name="basic"
      labelCol={{ span: 8 }}
      wrapperCol={{ span: 8 }}
      initialValues={{ remember: true }}
      onFinish={onSubmit}
      autoComplete="off"
      className="password flex flex-col gap-4 items-center justify-center w-full max-w-xs text-center"
    >
      <Form.Item
        name="password"
        hasFeedback
        className="w-full"
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
        <Input.Password placeholder="New password (min 8 chars)" />
      </Form.Item>

      <Form.Item
        className="w-full"
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

              return Promise.reject();
            },
          }),
        ]}
      >
        <Input.Password placeholder="Confirm password" />
      </Form.Item>

      <span className="px-3 text-brand-graylight text-xs">
        At least 8 characters, 1 lower-case and 1 numeral. {'   '}
      </span>

      <span className="px-3 text-left text-brand-royalblue text-xs">
        Do not forget to save your password. You will need this password to
        unlock your wallet.
      </span>

      <div className="absolute bottom-12">
        <PrimaryButton type="submit" id="create-password-action">
          Next
        </PrimaryButton>
      </div>
    </Form>
  </Layout>
);
