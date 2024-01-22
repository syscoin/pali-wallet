import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { OnboardingLayout, Button } from 'components/index';
// import { getController } from 'utils/browser';
import { getController } from 'scripts/Background';
import { formatSeedPhrase } from 'utils/format';

const ImportPhrase: React.FC = () => {
  const { TextArea } = Input;
  const controller = getController();
  console.log({ controller });
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = ({ phrase }: { phrase: string }) => {
    if (controller.wallet.isSeedValid(phrase)) {
      navigate('/create-password-import', {
        state: { phrase, isWalletImported: true },
      });
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
          <TextArea
            id="import-wallet-input"
            rows={3}
            className={`${
              !seedIsValid && form.getFieldValue('phrase')
                ? 'border-warning-error'
                : 'border-fields-input-border'
            } bg-fields-input-primary p-[15px] overflow-hidden max-w-[17.5rem] w-[17.5rem] h-[5.625rem] text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none `}
            placeholder={t('import.pasteYourWalletSeed')}
            onKeyPress={handleKeypress}
          />
        </Form.Item>

        <span className="w-[90%] text-center text-[#A2A5AB] text-xs font-normal">
          {t('import.importingYourAccount')}
        </span>

        <div className="absolute bottom-12 md:bottom-80">
          <Button
            id="import-wallet-action"
            type="submit"
            disabled={!seedIsValid || !form.getFieldValue('phrase')}
            className={`${
              seedIsValid
                ? 'cursor-pointer opacity-100'
                : ' cursor-not-allowed opacity-60'
            } bg-brand-deepPink100 w-[17.5rem] mt-3 h-10 text-white text-base font-base font-medium rounded-2xl`}
          >
            {t('buttons.import')}
          </Button>
        </div>
      </Form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
