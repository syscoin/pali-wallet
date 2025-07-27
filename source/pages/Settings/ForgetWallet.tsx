import { Form } from 'antd';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  PrimaryButton,
  SecondaryButton,
  Card,
  ValidatedPasswordInput,
  SeedPhraseDisplay,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { INetworkType } from 'types/network';

const ForgetWalletView = () => {
  const { navigate, alert } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No active account');

  const hasAccountFunds =
    (isBitcoinBased
      ? activeAccount.balances[INetworkType.Syscoin]
      : activeAccount.balances[INetworkType.Ethereum]) > 0;

  // Loading state for submit action
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cached seed for copying
  const [cachedSeed, setCachedSeed] = useState<string>('');

  // Password validation state
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  // Copy state for SeedPhraseDisplay
  const [copied, setCopied] = useState<boolean>(false);

  const [form] = Form.useForm();

  // Password validation function for ValidatedPasswordInput
  const validatePassword = useCallback(
    async (password: string) => {
      const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);
      if (!seed) {
        throw new Error('Invalid password');
      }
      return seed;
    },
    [controllerEmitter]
  );

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

  // Copy seed phrase to clipboard using SeedPhraseDisplay
  const handleCopySeed = useCallback(
    async (seedPhrase: string) => {
      try {
        await navigator.clipboard.writeText(seedPhrase);
        alert.success(t('settings.seedPhraseCopied'));
        setCopied(true);
        // Reset copied state after a delay
        setTimeout(() => setCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy seed:', error);
        alert.error(t('buttons.error'));
      }
    },
    [alert, t]
  );

  const onSubmit = useCallback(
    async ({ password }: { password: string }) => {
      setIsSubmitting(true);

      try {
        await controllerEmitter(['wallet', 'forgetWallet'], [password]);
        navigate('/');
      } catch (error) {
        console.error('Failed to forget wallet:', error);
        // Handle error if needed
      } finally {
        setIsSubmitting(false);
      }
    },
    [controllerEmitter, navigate]
  );

  // Navigation callbacks
  const handleCancel = useCallback(() => {
    navigate('/home');
  }, [navigate]);

  const handleSubmit = useCallback(() => {
    form.submit();
  }, [form]);

  return (
    <>
      {/* Loading overlay for submit action */}
      {isSubmitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
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
          className="password flex flex-col gap-4 items-center justify-center text-center"
          name="forget"
          autoComplete="off"
        >
          <ValidatedPasswordInput
            onValidate={validatePassword}
            onValidationSuccess={handleValidationSuccess}
            onValidationError={handleValidationError}
            placeholder={t('settings.enterYourPassword')}
            id="forget_password"
            form={form}
            name="password"
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
                  onCopy={handleCopySeed}
                  copied={copied}
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
      <div className="w-full px-4 absolute bottom-12 md:static">
        <div className="flex gap-x-8 justify-between md:gap-x-40">
          <SecondaryButton
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            onClick={handleSubmit}
            disabled={!isPasswordValid || isSubmitting}
            loading={isSubmitting}
          >
            {t('buttons.forget')}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default ForgetWalletView;
