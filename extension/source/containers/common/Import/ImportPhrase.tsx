import React, { FC } from 'react';
import {Layout} from 'containers/common/Layout';
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
        className="flex items-center flex-col gap-4 mt-8 "
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
            className="text-xs w-72 h-28 rounded p-2 pl-4 bg-brand-navydarker border border-brand-navymedium text-brand-royalBluemedium outline-none focus:border-brand-navylight"
          />
        </Form.Item>

        <span className="font-light text-brand-royalBluemedium text-xs mx-12 mt-2">
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
