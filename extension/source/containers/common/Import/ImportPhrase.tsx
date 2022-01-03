import React, { FC, useState } from 'react';
import { Layout } from 'containers/common/Layout';
import { useController } from 'hooks/index';
import { PrimaryButton } from 'components/index';
import { Form, Input } from 'antd';

interface IImportPhrase {
  onRegister: () => void;
}

const ImportPhrase: FC<IImportPhrase> = ({ onRegister }) => {
  const controller = useController();

  const [seedIsValid, setSeedIsValid] = useState<boolean>(false);

  const onSubmit = (data: any) => {
    if (controller.wallet.importPhrase(data.phrase)) {
      onRegister();
    }
  };

  return (
    <Layout onlySection title="Import wallet">
      <Form
        name="import"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex items-center flex-col gap-4 mt-8"
      >
        <Form.Item
          name="phrase"
          className="text-blue"
          rules={[
            {
              required: true,
              message: '',
            },
            ({}) => ({
              validator(_, value) {
                setSeedIsValid(controller.wallet.importPhrase(value));

                if (controller.wallet.importPhrase(value)) {
                  return Promise.resolve();
                }

                return Promise.reject(
                  <p className="text-red fixed h-12">
                    Seed phrase is not valid
                  </p>
                );
              },
            }),
          ]}
        >
          <Input
            placeholder="Paste your wallet seed phrase"
            className="mb-2 text-xs w-72 h-24 rounded-md text-center bg-brand-navydarker border border-brand-navymedium text-brand-white outline-none focus:border-brand-navylight"
          />
        </Form.Item>

        <span className="font-light text-brand-royalBlue text-xs mx-6 mt-12 pb-12 text-center">
          Importing your wallet seed automatically import a wallet associated with this seed phrase.
        </span>

        <div className="absolute bottom-12">
          <PrimaryButton
            type="submit"
            disabled={!seedIsValid}
            id="import-btn"
          >
            Import
          </PrimaryButton>
        </div>
      </Form>
    </Layout>
  );
};

export default ImportPhrase;
