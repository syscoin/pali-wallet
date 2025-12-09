import { Form, Input } from 'antd';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';

type FormErrors = {
  [key: string]: string;
};

interface IPasswordForm {
  onSubmit: (data: any) => any;
}

export const PasswordForm: React.FC<IPasswordForm> = ({ onSubmit }) => {
  const { t } = useTranslation();

  const [form] = Form.useForm();
  const [formErrors, setFormErrors] = useState<FormErrors>({
    password: '',
    repassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);

  const buttonIsValidStyle = useMemo(
    () =>
      Object.keys(formErrors).length > 0 || !form.getFieldValue('password')
        ? 'opacity-60'
        : 'opacity-100',
    [formErrors, form]
  );

  const onValuesChange = useCallback(() => {
    form
      .validateFields()
      .then(() => setFormErrors({}))
      .catch((errors) => {
        setFormErrors(
          errors.errorFields.reduce((acc, current) => {
            acc[current.name[0]] = current.errors[0];
            return acc;
          }, {})
        );
      });
  }, []);

  const handleSubmit = async (values: any) => {
    setIsLoading(true);
    await onSubmit(values);
    setIsLoading(false);
  };

  return (
    <OnboardingLayout title={t('settings.password')}>
      <Form
        form={form}
        onValuesChange={onValuesChange}
        validateMessages={{ default: '' }}
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={handleSubmit}
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
              // Strong password requirements: 12+ chars, uppercase, lowercase, number, special char
              pattern:
                /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
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
          id="create-password"
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
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match'));
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

        <span className="px-3 mt-6 mb-4 w-full text-left text-brand-blue100 text-xs">
          {t('components.atLeast')} {'   '}
        </span>

        <span className="px-3 text-center text-brand-gray200 text-xs">
          {t('components.doNotForget')}
        </span>

        <div className="absolute bottom-12 md:bottom-32">
          <Button
            type="submit"
            id="create-password-action"
            disabled={Object.keys(formErrors).length > 0}
            className={`${buttonIsValidStyle} bg-brand-deepPink100 w-[17.5rem] h-10 text-white text-base font-base font-medium rounded-2xl`}
            loading={isLoading}
          >
            {t('buttons.next')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};
