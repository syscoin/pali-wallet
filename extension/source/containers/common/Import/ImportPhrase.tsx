import React, { FC } from 'react';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
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
    <Layout title="Let's import your wallet" normalHeader importSeed>
      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <span>Paste your wallet seed phrase below:</span>
        <Form.Item
          name="phrase"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({}) => ({
              validator(_, value) {
                if (controller.wallet.importPhrase(value)) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
          <Input placeholder="import phrase" />
        </Form.Item>

        <Button
          type="submit"
          className="absolute bottom-12 tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light border border-brand-royalBlue hover:bg-brand-royalBlue hover:text-brand-navy transition-all duration-300"
        >
          Next
        </Button>
      </Form>
    </Layout>
  );
};

export default ImportPhrase;
