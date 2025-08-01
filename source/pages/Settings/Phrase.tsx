import { Form } from 'antd';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import {
  Card,
  Button,
  ValidatedPasswordInput,
  SeedPhraseDisplay,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { navigateBack } from 'utils/navigationState';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>();

  // Password validation state like ForgetWallet
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  // Copy state for SeedPhraseDisplay
  const [copied, setCopied] = useState<boolean>(false);

  const { t } = useTranslation();
  const { navigate, alert } = useUtils();
  const location = useLocation();
  const { controllerEmitter } = useController();

  const [form] = Form.useForm();

  // Password validation function for the ValidatedPasswordInput
  const validatePassword = useCallback(async (password: string) => {
    const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);
    if (!seed) {
      throw new Error('Invalid password');
    }
    return seed;
  }, []);

  // Handle successful password validation
  const handleValidationSuccess = useCallback((seed: string) => {
    setPhrase(String(seed));
    setIsPasswordValid(true);
  }, []);

  // Handle failed password validation
  const handleValidationError = useCallback(() => {
    setPhrase(undefined);
    setIsPasswordValid(false);
  }, []);

  // Copy seed phrase to clipboard using alert like ForgetWallet
  const handleCopyToClipboard = useCallback(
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

  // Navigation callback
  const handleClose = useCallback(() => {
    navigateBack(navigate, location);
  }, [navigate, location]);

  return (
    <>
      <p className="text-sm mb-6">
        {t('forgetWalletPage.importedAccountsWont')}
      </p>
      <div className="flex flex-col">
        <Form
          validateMessages={{ default: '' }}
          form={form}
          className="password flex flex-col gap-4 items-center justify-center text-center"
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <ValidatedPasswordInput
            onValidate={validatePassword}
            onValidationSuccess={handleValidationSuccess}
            onValidationError={handleValidationError}
            placeholder={t('settings.enterYourPassword')}
            id="phraseview_password"
            form={form}
            name="password"
          />

          <Form.Item name="seed" className="w-full md:max-w-md">
            <SeedPhraseDisplay
              seedPhrase={phrase}
              isEnabled={isPasswordValid}
              showEyeToggle={true}
              onCopy={handleCopyToClipboard}
              copied={copied}
              displayMode="textarea"
            />
          </Form.Item>
        </Form>

        <Card type="info">
          <div className="flex flex-col justify-start items-start">
            <p className="text-brand-yellowInfo text-sm font-normal text-left">
              {t('walletSeedPhrasePage.keepSeedPhrase')}
            </p>
            <p className="text-white text-sm font-normal text-left">
              {t('walletSeedPhrasePage.anyoneWithThisInfo')}
            </p>
          </div>
        </Card>
      </div>

      <div className="w-full px-4 absolute bottom-12 md:static">
        <Button
          type="button"
          onClick={handleClose}
          className="w-full h-10 flex items-center justify-center rounded-[100px] bg-white border-white text-base font-medium text-brand-blue400"
        >
          {t('buttons.close')}
        </Button>
      </div>
    </>
  );
};

export default PhraseView;
