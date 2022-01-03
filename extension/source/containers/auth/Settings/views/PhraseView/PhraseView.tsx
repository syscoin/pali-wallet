import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { useController, useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { Icon, SecondaryButton, IconButton } from 'components/index';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const { useCopyClipboard, history } = useUtils();
  const controller = useController();
  const [copied, copyText] = useCopyClipboard();

  const handleCopySeed = () => {
    copyText(phrase)
  };

  return (
    <AuthViewLayout title="WALLET SEED PHRASE">
      <p className="text-white text-sm py-3 px-10">
        Please input your wallet password
      </p>

      <div className="flex justify-center items-center flex-col">
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center pt-4"
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            rules={[
              {
                required: true,
                message: '',
              },
              ({ }) => ({
                validator(_, value) {
                  const seed = controller.wallet.getPhrase(value);

                  if (seed) {
                    setPhrase(seed);

                    return Promise.resolve();
                  }

                  return Promise.reject('');
                },
              }),
            ]}
          >
            <Input.Password
              className="phrase-input rounded-full py-3 px-4 w-72 bg-brand-navyborder border border-brand-royalBlue text-sm outline-none"
              placeholder="Enter your password"
            />
          </Form.Item>
        </Form>

        <div
          className="flex flex-col justify-center items-center gap-3 bg-brand-navydarker border border-dashed border-brand-royalBlue mx-6 my-8 p-4 text-xs rounded-lg transition-all duration-200 hover:bg-brand-navydark cursor-pointer"
          onClick={() => phrase !== '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****' && handleCopySeed()}
        >
          <div className="flex justify-between items-center w-full">
            <p>Seed Phrase: (click to copy)</p>

            <IconButton
              onClick={handleCopySeed}
            >
              <Icon name="copy" className="text-brand-white" />
            </IconButton>
          </div>

          <p className="text-xs mt-3">{phrase}</p>
        </div>

        <p className="bg-brand-navydark border border-dashed border-brand-deepPink100 mx-6 p-4 text-xs rounded-lg">
          <b>WARNING:</b> Keep your seed phrase secret! Anyone with your seed phrase can access any account connected to this wallet and steal your assets
        </p>

        <div className="absolute bottom-12">
          <SecondaryButton
            type="button"
            onClick={() => history.push('/home')}
          >
            {copied ? 'Copied' : 'Close'}
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default PhraseView;
