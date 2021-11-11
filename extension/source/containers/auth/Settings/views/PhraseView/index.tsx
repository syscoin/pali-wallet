import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { useController, useUtils } from 'hooks/index';
import ViewLayout from '../Layout';

const PhraseView = () => {
  const [checked, setChecked] = useState<boolean>(false);
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const { alert } = useUtils();
  const controller = useController();
  const onSubmit = (data: any) => {
    const res = controller.wallet.getPhrase(data.password);
    if (res) {
      setPhrase(res);
      setChecked(true);

      return;
    }

    alert.removeAll();
    alert.error('Error: Invalid password');
  };

  const handleCopySeed = () => {
    if (!checked) return;
    // copyText(phrase);
  };

  return (
    <ViewLayout title="WALLET SEED PHRASE">
      <div className="bg-brand-deepPink w-popup fixed h-popup">
        <span>Please input your wallet password and press enter:</span>
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center"
          name="basic"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          initialValues={{ remember: true }}
          onFinish={onSubmit}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            rules={[
              {
                required: true,
                message: ''
              },
              ({ }) => ({
                validator(_, value) {
                  if (controller.wallet.getPhrase(value)) {
                    return Promise.resolve();
                  }

                  return Promise.reject('');
                },
              }),
            ]}
          >
            <Input.Password placeholder="Enter your password" />
          </Form.Item>
        </Form>

        <span>Click to copy your seed phrase:</span>
        <div onClick={handleCopySeed}>
          {phrase}
        </div>
        <span>
          <b>Warning:</b> Keep your seed phrase secret! Anyone with your seed
          phrase can access any account connected to this wallet and steal your
          assets.
        </span>
      </div>
    </ViewLayout>
  );
};

export default PhraseView;
