import { Form } from 'antd';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import {
  Card,
  Button,
  ValidatedPasswordInput,
  SeedPhraseDisplay,
  PageActionFooter,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useSecretDisclosure } from 'hooks/useSecretDisclosure';
import { navigateBack } from 'utils/navigationState';

const PhraseView = () => {
  const { t } = useTranslation();
  const { navigate } = useUtils();
  const location = useLocation();
  const { controllerEmitter } = useController();

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

  // Password validation function for the ValidatedPasswordInput
  const validatePassword = (password: string) =>
    disclosure.read(async () => {
      const seed = await controllerEmitter(['wallet', 'getSeed'], [password]);
      if (!seed) throw new Error('Invalid password');
      return String(seed);
    });

  // Navigation callback
  const handleClose = useCallback(() => {
    disclosure.reset();
    form.resetFields();
    navigateBack(navigate, location);
  }, [navigate, location, disclosure.reset, form]);

  return (
    <>
      <p className="text-sm mb-6">
        {t('forgetWalletPage.importedAccountsWont')}
      </p>
      <div className="flex flex-col">
        <Form
          validateMessages={{ default: '' }}
          form={form}
          className="password flex flex-col gap-4 items-center justify-center text-center w-full"
          name="phraseview"
          autoComplete="off"
        >
          <ValidatedPasswordInput
            onValidate={validatePassword}
            onValidationSuccess={disclosure.accept}
            onValidationError={disclosure.reset}
            onValidationReset={disclosure.reset}
            placeholder={t('settings.enterYourPassword')}
            id="phraseview_password"
            form={form}
            name="password"
            validationTrigger="submit"
          />

          <Form.Item name="seed" className="w-full md:max-w-md">
            <SeedPhraseDisplay
              seedPhrase={disclosure.secret}
              isEnabled={!!disclosure.secret}
              copyAuthorization={disclosure.isCurrent}
              showEyeToggle={true}
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

      <PageActionFooter>
        <Button
          type="button"
          onClick={handleClose}
          className="w-full h-10 flex items-center justify-center rounded-[100px] bg-white border-white text-base font-medium text-brand-blue400"
        >
          {t('buttons.close')}
        </Button>
      </PageActionFooter>
    </>
  );
};

export default PhraseView;
