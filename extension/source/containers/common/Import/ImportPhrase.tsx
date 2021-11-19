import React, { FC } from 'react';
import { Layout } from 'containers/common/Layout';
import { useController } from 'hooks/index';
import { Button } from 'components/index';
import { Form, Input } from 'antd';

interface IImportPhrase {
  onRegister: () => void;
}

const ImportPhrase: FC<IImportPhrase> = ({ onRegister }) => {
  const controller = useController();

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
              message: ''
            },
            ({ }) => ({
              validator(_, value) {
                if (controller.wallet.importPhrase(value)) {
                  return Promise.resolve();
                }

                return Promise.reject('Seed phrase is not valid');
              },
            }),
          ]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 5 }}
            placeholder="Paste your wallet seed phrase"
            className="text-xs w-72 h-32 rounded-md p-2 pl-4 bg-brand-navydarker border border-brand-navymedium text-brand-royalBlue outline-none focus:border-brand-navylight"
          />
        </Form.Item>

        <span className="font-light text-brand-royalBlue text-xs mx-12 mt-8 pb-12 text-center">
          Importing your wallet seed automatically import a wallet associated with this seed phrase.
        </span>

        <Button
          className="absolute bottom-12"
          type="submit"
        >
          Import
        </Button>
      </Form>
    </Layout>
  );
};

export default ImportPhrase;