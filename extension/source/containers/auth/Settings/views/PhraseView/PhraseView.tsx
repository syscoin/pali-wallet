import React, { useState } from 'react';
import { Button, Card, Form, Input } from 'antd';
import { useController, useUtils } from 'hooks/index';
import { Header } from 'containers/common/Header';
import { changeBackgroundLinear, changeBackground } from '../../../../../constants'
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Icon } from 'components/Icon';
import { WarningCard } from 'containers/common/Layout/WarningCard';
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
    <>
      <Header normalHeader />
      <div className="flex justify-center items-center flex-col min-w-full">
        <AuthViewLayout title="WALLET SEED PHRASE">Please input your wallet password and press enter</AuthViewLayout>
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center pt-4"
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

        <div className="flex items-center justify-center pt-4">
          <Card className="w-full rounded text-brand-white" style={{ width: 320, border: '1px', background: '#4d76b8' }}>
           <div className="p-4">
              <div className="flex text-brand-white">
                  <p className="text-base">Seed Phrase: (click to copy)</p>
                  <Icon name="copy" className="pl-20 inline-flex self-center text-base pr-1" />
               </div>
               <div className="text-base pt-1" onClick={handleCopySeed}>
                 {phrase}
              </div>
           </div>
          </Card>
        </div>
        <WarningCard>Keep your seed phrase secret! Anyone with your seed
                phrase can access any account connected to this wallet and steal your
                assets. 
        </WarningCard>

        <div className="p-0.5 bg-primary rounded-full ">
          <Button
            onMouseEnter={changeBackgroundLinear}
            onMouseLeave={changeBackground}
            className="bg-brand-navy tracking-normal text-base py-2.5 px-12 cursor-pointer rounded-full text-brand-white hover:backgroundImage"
          >
            Close
          </Button>
        </div>

      </div>
    </>
  );
};

export default PhraseView;
