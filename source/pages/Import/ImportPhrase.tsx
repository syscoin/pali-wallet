import React, { FC, useState } from 'react';
import { OnboardingLayout, PrimaryButton } from 'components/index';
import { getController } from 'utils/browser';
import { formatSeedPhrase } from 'utils/format';
import { Form } from 'antd';
import TextArea from 'antd/lib/input/TextArea';
import { useForm } from 'antd/lib/form/Form';

interface IImportPhrase {
  onRegister: () => void;
}

const ImportPhrase: FC<IImportPhrase> = ({ onRegister }) => {
  const controller = getController();

  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = ({ phrase }: { phrase: string }) => {
    if (controller.wallet.importPhrase(phrase)) {
      onRegister();
    }
  };
  const [form] = useForm();

  const handleKeypress = (event) => {
    if (event.key === 'Enter') {
      form.submit();
    }
  };

  return (
    <OnboardingLayout title="Import wallet">
      <Form
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
                try {
                  form.setFieldsValue({ phrase: formatSeedPhrase(value) });
                } catch (error) {
                  setSeedIsValid(false);

                  return Promise.reject();
                }
                setSeedIsValid(controller.wallet.importPhrase(value) && value);

                if (controller.wallet.importPhrase(value)) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <TextArea
            className={`${
              !seedIsValid && form.getFieldValue('phrase')
                ? 'border-warning-error'
                : 'border-fields-input-border'
            } bg-fields-input-primary`}
            placeholder="Paste your wallet seed phrase"
            id="import-wallet-input"
            onKeyPress={handleKeypress}
          />
        </Form.Item>

        <span className="text-left text-brand-royalblue text-xs font-light">
          Importing your wallet seed automatically import a wallet associated
          with this seed phrase.
        </span>

        <div className="absolute bottom-12 md:bottom-80">
          <PrimaryButton
            type="submit"
            disabled={!seedIsValid || !form.getFieldValue('phrase')}
            id="import-wallet-action"
          >
            Import
          </PrimaryButton>
        </div>
      </Form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
