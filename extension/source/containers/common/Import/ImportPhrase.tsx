import React, { FC } from 'react';
import Layout from 'containers/common/Layout';
import { Button } from 'components/index';;
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
    <Layout onlySection title="Import wallet" >
      <Form
        name="import"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <span className="font-light text-brand-graylight text-xs">Paste your wallet seed phrase below:</span>
        <Form.Item
          name="phrase"
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
            placeholder="import phrase"
            className="text-center text-xs w-72 h-28 rounded p-2 pl-4 bg-brand-navydarker border border-brand-navymedium text-brand-graylight outline-none focus:border-brand-navylight"
          />
        </Form.Item>

        <span className="font-light text-brand-royalBluemedium text-xs mx-4 mt-9">
          Importing your wallet seed automatically import a wallet associated with this seed phrase.
        </span>


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
