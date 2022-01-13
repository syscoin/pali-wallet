import React, { FC, useState } from 'react';
import { Layout } from 'containers/common/Layout';
import { useController } from 'hooks/index';
import { PrimaryButton } from 'components/index';
import { Form } from 'antd';
import TextArea from 'antd/lib/input/TextArea';
import { useForm } from 'antd/lib/form/Form';

interface IImportPhrase {
  onRegister: () => void;
}

const ImportPhrase: FC<IImportPhrase> = ({ onRegister }) => {
  const controller = useController();

  const [seedIsValid, setSeedIsValid] = useState<boolean>();

  const onSubmit = (data: any) => {
    if (controller.wallet.importPhrase(data.phrase)) {
      onRegister();
    }
  };

  const [form] = useForm();

  return (
    <Layout onlySection title="Import wallet">
      <Form
        form={form}
        name="import"
        onFinish={onSubmit}
        autoComplete="off"
        className="flex items-center flex-col w-full gap-4 max-w-xs"
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
          />
        </Form.Item>

        <span className="font-light text-brand-royalblue text-xs text-left">
          Importing your wallet seed automatically import a wallet associated
          with this seed phrase.
        </span>

        <div className="absolute bottom-12">
          <PrimaryButton
            type="submit"
            disabled={!seedIsValid || !form.getFieldValue('phrase')}
          >
            Import
          </PrimaryButton>
        </div>
      </Form>
    </Layout>
  );
};

export default ImportPhrase;
