import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { OnboardingLayout, PrimaryButton } from 'components/index';
import { getController } from 'utils/browser';
import { formatSeedPhrase } from 'utils/format';

const ImportPhrase: React.FC = () => {
  const controller = getController();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = ({ phrase }: { phrase: string }) => {
    if (controller.wallet.isSeedValid(phrase)) {
      navigate('/create-password-import', { state: { phrase } });
    }
  };
  const [form] = useForm();

  const handleKeypress = (event) => {
    if (event.key === 'Enter') {
      form.submit();
    }
  };

  return (
    <OnboardingLayout title={t('titles.importWallet')}>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        name="import"
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-4 items-center w-full max-w-xs"
      >
        <Form.Item
          name="phrase"
          className="w-full"
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                value = formatSeedPhrase(value);

                form.setFieldsValue({ phrase: value });

                //todo: we should validate the seed phrase with the new fn
                setSeedIsValid(controller.wallet.isSeedValid(value) && value);

                if (controller.wallet.isSeedValid(value)) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            className={`${
              !seedIsValid && form.getFieldValue('phrase')
                ? 'border-warning-error'
                : 'border-fields-input-border'
            } bg-fields-input-primary p-2 pl-4 w-full h-20 text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none`}
            placeholder={t('import.pasteYourWalletSeed')}
            id="import-wallet-input"
            onKeyPress={handleKeypress}
          />
        </Form.Item>

        <span className="text-left text-brand-royalblue text-xs font-light">
          {t('import.importingYourAccount')}
        </span>

        <div className="absolute bottom-12 md:bottom-80">
          <PrimaryButton
            type="submit"
            disabled={!seedIsValid || !form.getFieldValue('phrase')}
            id="import-wallet-action"
          >
            {t('buttons.import')}
          </PrimaryButton>
        </div>
      </Form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
