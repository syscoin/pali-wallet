import { Form } from 'antd';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import {
  Button,
  Card,
  PageActionFooter,
  SeedPhraseDisplay,
  ValidatedPasswordInput,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { navigateBack } from 'utils/navigationState';

const ForgetWalletView = () => {
  const { navigate } = useUtils();
  const location = useLocation();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No active account');

  // Forgetting removes the whole wallet, not only the selected account.
  const hasAccountFunds = Object.values(accounts).some((group) =>
    Object.values(group).some((account) =>
      Object.values(account.balances).some((balance) => balance > 0)
    )
  );

  // Loading state for submit action
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState('');

  // Cached seed for display (view-only)
  const [cachedSeed, setCachedSeed] = useState<string>('');

  // Password validation state
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const [form] = Form.useForm();

  // Password validation function for ValidatedPasswordInput
  const validatePassword = useCallback(async (password: string) => {
    const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);
    if (!seed) {
      throw new Error('Invalid password');
    }
    return seed;
  }, []);

  // Handle successful password validation
  const handleValidationSuccess = useCallback(
    (seed: string) => {
      setIsPasswordValid(true);
      setCachedSeed(String(seed));

      // Auto-fill seed field so user can copy it when they have funds
      if (hasAccountFunds) {
        form.setFieldsValue({ seed: String(seed) });
      }
    },
    [hasAccountFunds, form]
  );

  // Handle failed password validation
  const handleValidationError = useCallback(() => {
    setIsPasswordValid(false);
    setCachedSeed('');

    if (hasAccountFunds) {
      form.setFieldsValue({ seed: '' }); // Clear seed field
    }
  }, [hasAccountFunds, form]);

  const onSubmit = useCallback(
    async ({ password }: { password: string }) => {
      setIsSubmitting(true);
      setSubmissionError('');

      try {
        await controllerEmitter(['wallet', 'forgetWallet'], [password]);
        navigate('/');
      } catch (error) {
        console.error('Failed to forget wallet:', error);
        setSubmissionError(
          (error instanceof Error && error.message) ||
            (typeof error === 'string' && error) ||
            t('forgetWalletPage.removalFailed')
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [controllerEmitter, navigate, t]
  );

  // Navigation callbacks
  const handleCancel = useCallback(() => {
    navigateBack(navigate, location);
  }, [navigate, location]);

  const handleSubmit = useCallback(() => {
    form.submit();
  }, [form]);

  return (
    <>
      {/* Loading overlay for submit action */}
      {isSubmitting && (
        <div
          role="status"
          aria-label={t('buttons.loading')}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]"
        >
          <div
            aria-hidden="true"
            className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"
          />
        </div>
      )}

      <div>
        <p className="text-sm mb-6">
          {t('forgetWalletPage.importedAccountsWont')}
        </p>
        <Form
          validateMessages={{ default: '' }}
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-4 items-center justify-center text-center w-full"
          name="forget"
          autoComplete="off"
        >
          <ValidatedPasswordInput
            onValidate={validatePassword}
            onValidationSuccess={handleValidationSuccess}
            onValidationError={handleValidationError}
            onValidationReset={handleValidationError}
            placeholder={t('settings.enterYourPassword')}
            id="forget_password"
            form={form}
            name="password"
            validationTrigger="submit"
          />

          {hasAccountFunds && (
            <>
              <Form.Item
                name="seed"
                className="w-full md:max-w-md"
                rules={[
                  {
                    required: hasAccountFunds,
                    message: t('import.pasteYourWalletSeed'),
                  },
                ]}
              >
                <SeedPhraseDisplay
                  seedPhrase={cachedSeed}
                  isEnabled={isPasswordValid}
                  showEyeToggle={true}
                  displayMode="textarea"
                />
              </Form.Item>

              <Card type="info">
                <div className="flex flex-col justify-start items-start">
                  <p className="text-brand-yellowInfo text-sm font-normal text-left">
                    {t('forgetWalletPage.stillHaveFunds')}
                  </p>
                  <p className="text-white text-sm font-normal text-left">
                    {t('forgetWalletPage.saveProperly')}
                  </p>
                </div>
              </Card>
            </>
          )}
        </Form>
      </div>

      {/* Buttons container - pushed to bottom */}
      <PageActionFooter
        className={hasAccountFunds ? 'funded-forget-footer' : undefined}
        includeInFlow={hasAccountFunds}
        error={submissionError}
      >
        <div className="flex gap-x-8 justify-between md:gap-x-40">
          <Button
            variant="secondary"
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="button"
            onClick={handleSubmit}
            disabled={!isPasswordValid || isSubmitting}
            loading={isSubmitting}
          >
            {t('buttons.forget')}
          </Button>
        </div>
      </PageActionFooter>
    </>
  );
};

export default ForgetWalletView;
