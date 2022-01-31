import React, { useState } from 'react';
import { Form, Input } from 'antd';
import { useController, useUtils } from 'hooks/index';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';
import { SecondaryButton, InfoCard, CopyCard } from 'components/index';

const PhraseView = () => {
  const [phrase, setPhrase] = useState<string>(
    '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****'
  );

  const { useCopyClipboard, navigate } = useUtils();
  const controller = useController();
  const [copied, copyText] = useCopyClipboard();

  const handleCopySeed = () => {
    copyText(phrase);
  };

  return (
    <AuthViewLayout title="WALLET SEED PHRASE" id="seed-phrase-title">
      <p className="text-white text-sm py-3 px-10">
        Please input your wallet password
      </p>

      <div className="flex justify-center items-center flex-col">
        <Form
          className="flex justify-center items-center flex-col gap-8 text-center my-6 w-full max-w-xs"
          name="phraseview"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            className="w-full"
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  const seed = controller.wallet.getPhrase(value);

                  if (seed) {
                    setPhrase(seed);

                    return Promise.resolve();
                  }

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              className="seed-phrase-password-input"
              placeholder="Enter your password"
              id="phraseview_password"
            />
          </Form.Item>
        </Form>

        <CopyCard
          className="my-4"
          onClick={() =>
            phrase !==
              '**** ******* ****** ****** ****** ******** *** ***** ****** ***** *****' &&
            handleCopySeed()
          }
          label="Seed Phrase: (click to copy)"
        >
          <p className="text-xs mt-3" id="user-phrase">
            {phrase}
          </p>
        </CopyCard>

        <InfoCard>
          <p>
            <b className="text-warning-info">WARNING:</b> Keep your seed phrase
            secret! Anyone with your seed phrase can access any account
            connected to this wallet and steal your assets
          </p>
        </InfoCard>

        <div className="absolute bottom-12">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            {copied ? 'Copied' : 'Close'}
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default PhraseView;
