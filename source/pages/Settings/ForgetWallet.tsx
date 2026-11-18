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
import { useSecretDisclosure } from 'hooks/useSecretDisclosure';
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

  const [form] = Form.useForm();
  const disclosure = useSecretDisclosure(
    JSON.stringify([
      location.key,
      location.pathname,
      location.search,
      location.hash,
    ]),
    () => form.resetFields()
  );
  const validatePassword = (password: string) =>
    disclosure.read(async () => {
      const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);
      if (!seed) throw new Error('Invalid password');
      return String(seed);
    });

  const onSubmit = useCallback(
    async ({ password }: { password: string }) => {
      if (!disclosure.isCurrent()) return;
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
    [controllerEmitter, navigate, t, disclosure.isCurrent]
  );

  // Navigation callbacks
  const handleCancel = useCallback(() => {
    disclosure.reset();
    form.resetFields();
    navigateBack(navigate, location);
  }, [navigate, location, disclosure.reset, form]);

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
        <p className="text-sm mb-3">
          {t('forgetWalletPage.importedAccountsWont')}
        </p>
        <Form
          validateMessages={{ default: '' }}
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-2 items-center justify-center text-center w-full"
          name="forget"
          autoComplete="off"
        >
          <ValidatedPasswordInput
            onValidate={validatePassword}
            onValidationSuccess={disclosure.accept}
            onValidationError={disclosure.reset}
            onValidationReset={disclosure.reset}
            placeholder={t('settings.enterYourPassword')}
            id="forget_password"
            form={form}
            name="password"
            validationTrigger="submit"
          />

          {hasAccountFunds && (
            <>
              <Form.Item className="w-full md:max-w-md">
                <SeedPhraseDisplay
                  seedPhrase={disclosure.secret}
                  isEnabled={!!disclosure.secret}
                  copyAuthorization={disclosure.isCurrent}
                  showEyeToggle={true}
                  displayMode="textarea"
                />
              </Form.Item>

              <Card type="info">
                <div className="flex flex-col items-start justify-start gap-1">
                  <p className="text-brand-yellowInfo text-sm font-normal text-left">
                    {t('forgetWalletPage.stillHaveFunds')}
                  </p>
                  <p className="text-white text-sm font-normal text-left">
                    {t('forgetWalletPage.saveProperly')}
                  </p>
                  <p className="text-white text-sm font-normal text-left">
                    {t('forgetWalletPage.privateNotesBackupWarning')}
                  </p>
                </div>
              </Card>
            </>
          )}
          {!hasAccountFunds && (
            <Card type="info">
              <div className="flex flex-col items-start justify-start gap-1">
                <p className="text-white text-sm font-normal text-left">
                  {t('start.eraseFundsWarning')}
                </p>
                <p className="text-white text-sm font-normal text-left">
                  {t('forgetWalletPage.privateNotesBackupWarning')}
                </p>
              </div>
            </Card>
          )}
        </Form>
      </div>

      {/* Buttons container - pushed to bottom */}
      <PageActionFooter
        className="funded-forget-footer"
        includeInFlow
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
            disabled={!disclosure.secret || isSubmitting}
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
