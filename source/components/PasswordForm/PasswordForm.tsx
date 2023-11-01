import { Form, Input } from 'antd';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { OnboardingLayout, Button } from 'components/index';

interface IPasswordForm {
  onSubmit: (data: any) => any;
}

export const PasswordForm: React.FC<IPasswordForm> = ({ onSubmit }) => {
  const { t } = useTranslation();
  return (
    <OnboardingLayout title={t('settings.password')}>
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
          className="w-full flex justify-center"
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
            className="custom-input-password relative"
            id="create-password"
            placeholder={t('components.newPassword')}
          />
        </Form.Item>

        <Form.Item
          name="repassword"
          className="w-full flex justify-center"
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
            className="custom-input-password relative"
            id="create-password"
            placeholder={t('components.confirmPassword')}
          />
        </Form.Item>

        <span className="px-3 w-full text-left text-brand-blue100 text-xs">
          {t('components.atLeast')} {'   '}
        </span>

        <span className="px-3 text-center text-brand-gray200 text-xs">
          {t('components.doNotForget')}
        </span>

        <div className="absolute bottom-12 md:bottom-32">
          <Button
            type="submit"
            id="create-password-action"
            className="bg-brand-deepPink100 w-[17.5rem] h-10 text-white font-base font-medium rounded-2xl"
          >
            {t('buttons.next')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};
