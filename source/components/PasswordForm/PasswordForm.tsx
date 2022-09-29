import { Form, Input } from 'antd';
import React from 'react';

import { OnboardingLayout, PrimaryButton } from 'components/index';

interface IPasswordForm {
  onSubmit: (data: any) => any;
}

export const PasswordForm: React.FC<IPasswordForm> = ({ onSubmit }) => (
  <OnboardingLayout title="Password">
    <Form
      validateMessages={{ default: '' }}
      name="basic"
      labelCol={{ span: 8 }}
      wrapperCol={{ span: 8 }}
      initialValues={{ remember: true }}
      onFinish={onSubmit}
      autoComplete="off"
      className="password flex flex-col gap-4 items-center justify-center w-full max-w-xs text-center md:max-w-md"
    >
      <Form.Item
        name="password"
        className="w-full"
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
          className="input-small relative"
          placeholder="New password (min 8 chars)"
        />
      </Form.Item>

      <Form.Item
        name="repassword"
        className="w-full"
        hasFeedback
        dependencies={['password']}
        rules={[
          {
            required: true,
            message: '',
          },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value)
                return Promise.resolve();
              return Promise.reject();
            },
          }),
        ]}
      >
        <Input.Password
          className="input-small relative"
          placeholder="Confirm password"
        />
      </Form.Item>

      <span className="px-3 w-full text-left text-brand-graylight text-xs">
        At least 8 characters, 1 lower-case and 1 numeral. {'   '}
      </span>

      <span className="px-3 text-left text-brand-royalblue text-xs">
        Do not forget to save your password. You will need this password to
        unlock your wallet.
      </span>

      <div className="absolute bottom-12 md:bottom-32">
        <PrimaryButton type="submit" id="create-password-action">
          Next
        </PrimaryButton>
      </div>
    </Form>
  </OnboardingLayout>
);
