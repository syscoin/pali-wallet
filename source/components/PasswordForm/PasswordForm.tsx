import { Form, Input } from 'antd';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { generateMemorablePassword } from 'utils/memorablePassword';

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
  const submitting = useRef(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);

  const buttonIsValidStyle = useMemo(
    () =>
      Object.keys(formErrors).length > 0 || !form.getFieldValue('password')
        ? 'opacity-60'
        : 'opacity-100',
    [formErrors, form]
  );

  const onValuesChange = useCallback(() => {
    setGenerationFailed(false);
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

  const suggestPassword = () => {
    if (submitting.current) return;
    try {
      const password = generateMemorablePassword();
      form.setFieldsValue({ password, repassword: '' });
      onValuesChange();
    } catch {
      setGenerationFailed(true);
    }
  };

  const handleSubmit = async (values: any) => {
    if (submitting.current) return;
    submitting.current = true;
    setSubmitFailed(false);
    setIsLoading(true);
    try {
      await onSubmit(values);
    } catch {
      setSubmitFailed(true);
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  return (
    <OnboardingLayout title={t('settings.password')} scrollable>
      <Form
        form={form}
        onValuesChange={onValuesChange}
        validateMessages={{ default: '' }}
        name="basic"
        initialValues={{ remember: true }}
        onFinish={handleSubmit}
        autoComplete="on"
        className="password flex flex-col gap-4 items-center w-full max-w-md pb-6 text-center"
      >
        <Form.Item
          name="password"
          className="!mb-0 w-full"
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
            name="password"
            autoComplete="new-password"
            placeholder={t('components.newPassword')}
          />
        </Form.Item>

        <p className="w-full text-left text-brand-blue100 text-xs leading-relaxed">
          {t('components.atLeast')}
        </p>

        <Form.Item
          name="repassword"
          className="!mb-0 w-full"
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
            id="confirm-password"
            name="repassword"
            autoComplete="new-password"
            placeholder={t('components.confirmPassword')}
          />
        </Form.Item>

        <Button
          type="button"
          variant="ghost"
          fullWidth
          className="!h-auto min-h-[2.5rem] px-4 py-3 leading-5"
          disabled={isLoading}
          onClick={suggestPassword}
        >
          {t('components.suggestPassword')}
        </Button>
        <p className="text-center text-brand-gray200 text-xs leading-relaxed">
          {t('components.memorablePasswordHelp')}
        </p>
        {generationFailed && (
          <p role="alert" className="text-warning-error text-sm">
            {t('components.passwordGenerationFailed')}
          </p>
        )}

        {submitFailed && (
          <p role="alert" className="text-warning-error text-sm">
            {t('settings.walletSetupFailed')}
          </p>
        )}

        <div className="w-full pt-2">
          <Button
            type="submit"
            id="create-password-action"
            disabled={Object.keys(formErrors).length > 0}
            useDefaultWidth={false}
            className={`${buttonIsValidStyle} bg-brand-deepPink100 w-full h-10 text-white text-base font-base font-medium rounded-2xl`}
            loading={isLoading}
          >
            {t('buttons.next')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};
