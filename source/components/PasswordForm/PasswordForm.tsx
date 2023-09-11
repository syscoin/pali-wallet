import { Form, Input } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { OnboardingLayout, PrimaryButton } from 'components/index';

interface IPasswordForm {
  onSubmit: (data: any) => any;
}

export const PasswordForm: React.FC<IPasswordForm> = ({ onSubmit }) => {
  const { t } = useTranslation();
  return (
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
            placeholder={t('components.newPassword')}
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
            placeholder={t('components.confirmPassword')}
          />
        </Form.Item>

        <span className="px-3 w-full text-left text-brand-graylight text-xs">
          {t('components.atLeast')} {'   '}
        </span>

        <span className="px-3 text-left text-brand-royalblue text-xs">
          {t('components.doNotForget')}
        </span>

        <div className="absolute bottom-12 md:bottom-32">
          <PrimaryButton type="submit" id="create-password-action">
            {t('buttons.next')}
          </PrimaryButton>
        </div>
      </Form>
    </OnboardingLayout>
  );
};
